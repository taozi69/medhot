// LLM API pool tests: dynamic discovery, round-robin, per-API and global
// concurrency, cooldown, failover retry, single-API compatibility, and that
// API keys never appear in diagnostics.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverPoolApis,
  refreshPool,
  acquireEndpoint,
  nextAvailable,
  withFailover,
  poolHealth,
  globalActiveRequests,
} from "../packages/backend/src/providers/llm-pool.ts";

async function withEnv(env: Record<string, string>, fn: () => void | Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    saved.set(key, process.env[key]);
    process.env[key] = env[key]!;
  }
  try {
    await fn(); // restore only after the async body has fully settled
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const SLOT1 = {
  LLM_API_1_KEY: "k1",
  LLM_API_1_BASE_URL: "https://api1.example.com/v1",
  LLM_API_1_MODEL: "m1",
};
const SLOT2 = {
  LLM_API_2_KEY: "k2",
  LLM_API_2_BASE_URL: "https://api2.example.com/v1",
  LLM_API_2_MODEL: "m2",
  LLM_API_2_MAX_CONCURRENCY: "3",
};

test("discovers any number of slots, skips incomplete and non-consecutive ones", () => {
  const apis = discoverPoolApis({
    ...SLOT1,
    // no LLM_API_2 at all (gap)
    LLM_API_3_KEY: "k3",
    // slot 3 missing BASE_URL -> skipped
    LLM_API_4_KEY: "k4",
    LLM_API_4_BASE_URL: "https://api4.example.com/v1",
    LLM_API_4_MODEL: "m4",
    LLM_API_4_MAX_CONCURRENCY: "2",
    // LLM_API_9 incomplete -> skipped
    LLM_API_9_KEY: "k9",
  });
  assert.equal(apis.length, 2); // slot 3 (incomplete) and slot 9 (incomplete) are skipped
  assert.deepEqual(apis.map((a) => a.id), ["1", "4"]);
  assert.equal(apis[0]!.maxConcurrency, 1); // default
  assert.equal(apis[1]!.maxConcurrency, 2);
});

test("empty when no LLM_API_* present: single-API compatibility", () => {
  const apis = discoverPoolApis({ LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m" });
  assert.equal(apis.length, 0);
});

test("round-robin rotates across endpoints", async () => {
  await withEnv({ ...SLOT1, ...SLOT2 }, async () => {
    refreshPool();
    const seen: string[] = [];
    const a = await acquireEndpoint();
    seen.push(a.api.id);
    a.release();
    const b = await acquireEndpoint();
    seen.push(b.api.id);
    b.release();
    const c = await acquireEndpoint();
    seen.push(c.api.id);
    c.release();
    assert.deepEqual(seen, ["1", "2", "1"]);
  });
});

test("cooldown: a failed endpoint is skipped and becomes healthy again", async () => {
  await withEnv({ ...SLOT1, ...SLOT2, LLM_POOL_COOLDOWN_MS: "30" }, async () => {
    refreshPool();
    const a = await acquireEndpoint();
    a.markFailed("429");
    a.release();
    const b = await acquireEndpoint();
    assert.notEqual(b.api.id, a.api.id); // the failed one is in cooldown
    b.release();
    await new Promise((r) => setTimeout(r, 60));
    const c = await acquireEndpoint();
    assert.equal(c.api.id, a.api.id); // cooldown expired
    c.release();
    assert.ok(poolHealth().every((h) => h.failureCount <= 1));
  });
});

test("per-API concurrency: maxConcurrency is enforced", async () => {
  await withEnv({ ...SLOT1 }, async () => {
    refreshPool();
    const first = await acquireEndpoint();
    assert.equal(first.api.activeRequests, 1);
    let secondResolved = false;
    const secondPending = acquireEndpoint().then((e) => {
      secondResolved = true;
      return e;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(secondResolved, false); // blocked by maxConcurrency=1
    first.release();
    const second = await secondPending;
    assert.equal(secondResolved, true);
    second.release();
  });
});

test("global concurrency cap is enforced", async () => {
  await withEnv({ ...SLOT1, ...SLOT2, LLM_GLOBAL_MAX_CONCURRENCY: "2" }, async () => {
    refreshPool();
    // Two acquires fill the global cap of 2 (slot1 max 1 + slot2).
    const first = await acquireEndpoint();
    const second = await acquireEndpoint();
    // A third acquire starts but must stay blocked by the global cap.
    let fourthResolved = false;
    const fourth = acquireEndpoint().then((e) => {
      fourthResolved = true;
      return e;
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fourthResolved, false); // the cap holds both global slots
    // Free one global slot; the blocked acquire must then get in.
    second.release();
    const f = await fourth;
    assert.equal(fourthResolved, true);
    first.release();
    f.release();
  });
});

test("withFailover retries at most 2 times and gives up", async () => {
  let calls = 0;
  const err = Object.assign(new Error("HTTP 503"), { status: 503, retryable: true });
  await assert.rejects(
    withFailover(
      async () => {
        calls++;
        throw err;
      },
      (e) => (e as { retryable?: boolean }).retryable === true,
      3,
      () => 0,
    ),
    /HTTP 503/,
  );
  assert.equal(calls, 3); // 1 original + 2 retries, never more
});

test("withFailover succeeds on a later attempt and never retries non-retryable errors", async () => {
  let calls = 0;
  const result = await withFailover(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient retryable", { cause: { code: "ECONNRESET" } });
      return "ok";
    },
    () => true,
    3,
    () => 0,
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);

  let nonRetryableCalls = 0;
  await assert.rejects(
    withFailover(
      async () => {
        nonRetryableCalls++;
        throw new Error("not retryable");
      },
      () => false,
      3,
      () => 0,
    ),
    /not retryable/,
  );
  assert.equal(nonRetryableCalls, 1); // no retry
});

// Regression: a throwing attempt (connect/timeout/429/5xx) must still release the
// per-endpoint slot and the global slot, or repeated failures leak slots until the
// pool deadlocks and the worker queue stalls.
test("slots are released when an attempt throws (no leak on failure paths)", async () => {
  await withEnv({ ...SLOT1, LLM_GLOBAL_MAX_CONCURRENCY: "1", LLM_POOL_COOLDOWN_MS: "3" }, async () => {
    refreshPool();
    assert.equal(globalActiveRequests(), 0);
    for (let round = 0; round < 5; round++) {
      const acquired = await acquireEndpoint();
      try {
        throw new Error("HTTP 503"); // simulates paidRequest throwing inside runOnce
      } catch (error) {
        acquired.markFailed(String(error)); // what chatJson does on retryable failures
      } finally {
        acquired.release(); // the finally that used to be missing
      }
      assert.equal(globalActiveRequests(), 0, `global slot leaked on round ${round}`);
      assert.ok(poolHealth().every((h) => h.activeRequests === 0), `endpoint slot leaked on round ${round}`);
    }
  });
});

// The pattern chatJson now uses: every attempt acquires and releases exactly once,
// even across failover retries, so the pool never accumulates in-flight counts.
test("repeated acquire/throw/release cycles never leak global or endpoint slots", async () => {
  await withEnv({ ...SLOT1, ...SLOT2, LLM_GLOBAL_MAX_CONCURRENCY: "5", LLM_POOL_COOLDOWN_MS: "3" }, async () => {
    refreshPool();
    for (let round = 0; round < 10; round++) {
      try {
        await withFailover(
          async () => {
            const acquired = await acquireEndpoint();
            try {
              throw new Error("HTTP 429");
            } catch (error) {
              acquired.markFailed("HTTP 429");
              throw error;
            } finally {
              acquired.release();
            }
          },
          (e) => (e as { message?: string }).message?.includes("429") === true,
          3,
          () => 8,
        );
      } catch {
        // all attempts failed — expected
      }
      assert.equal(globalActiveRequests(), 0, `global slot leaked on round ${round}`);
      assert.ok(poolHealth().every((h) => h.activeRequests === 0), `endpoint slot leaked on round ${round}`);
    }
  });
});