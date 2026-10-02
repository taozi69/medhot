// Dynamic OpenAI-compatible LLM API pool.
//
// A deployment can point the default model at any number of OpenAI-compatible
// /chat/completions endpoints without code changes:
//
//   LLM_API_1_KEY=...
//   LLM_API_1_BASE_URL=...
//   LLM_API_1_MODEL=...
//   LLM_API_1_MAX_CONCURRENCY=1
//   LLM_API_2_KEY=...
//   ...
//
// Slot numbers need not be consecutive; a slot missing any of KEY / BASE_URL /
// MODEL is skipped. Endpoints can also be managed live from the admin (settings
// key `llm_pool_apis`, see admin/llm-apis.ts); the two sources are merged, with
// environment slots first. Requests are spread round-robin across healthy
// endpoints. An endpoint that returns 429 / 5xx / connection errors is marked
// failed and cools down for LLM_POOL_COOLDOWN_MS (default 60s) before it is
// considered again. Per-endpoint concurrency (LLM_API_N_MAX_CONCURRENCY, default
// 1) and a global concurrency cap (LLM_GLOBAL_MAX_CONCURRENCY, default 20) are
// both enforced.
//
// With no LLM_API_* variables and no admin entries the pool reports no endpoints,
// and callers fall back to the single LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
// endpoint, so existing deployments keep working unchanged.

export interface PoolApi {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxConcurrency: number;
  activeRequests: number;
  failureCount: number;
  cooldownUntil: number;
  lastUsed: number;
  /** Where the entry came from: an LLM_API_N_* slot or the admin-managed settings. */
  source: "env" | "admin";
  label?: string;
}

export interface AcquiredEndpoint {
  readonly api: PoolApi;
  /** Records a provider failure and starts the cooldown; safe to call once per attempt. */
  markFailed(reason: string): void;
  /** Releases the endpoint's slot and the global slot; idempotent. */
  release(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function cooldownMs(): number {
  const parsed = Number.parseInt(process.env.LLM_POOL_COOLDOWN_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function globalLimit(): number {
  const parsed = Number.parseInt(process.env.LLM_GLOBAL_MAX_CONCURRENCY ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

/** Scans the environment for LLM_API_<n>_* slots. Returns them sorted by slot number. */
export function discoverPoolApis(env: NodeJS.ProcessEnv = process.env): PoolApi[] {
  const slots = new Map<number, { baseUrl?: string; apiKey?: string; model?: string }>();
  for (const key of Object.keys(env)) {
    let match = /^LLM_API_(\d+)_KEY$/.exec(key);
    if (match) {
      const n = Number(match[1]);
      const slot = slots.get(n) ?? {};
      slot.apiKey = env[key]?.trim();
      slots.set(n, slot);
      continue;
    }
    match = /^LLM_API_(\d+)_BASE_URL$/.exec(key);
    if (match) {
      const n = Number(match[1]);
      const slot = slots.get(n) ?? {};
      slot.baseUrl = env[key]?.trim();
      slots.set(n, slot);
      continue;
    }
    match = /^LLM_API_(\d+)_MODEL$/.exec(key);
    if (match) {
      const n = Number(match[1]);
      const slot = slots.get(n) ?? {};
      slot.model = env[key]?.trim();
      slots.set(n, slot);
    }
  }

  const apis: PoolApi[] = [];
  for (const n of [...slots.keys()].sort((a, b) => a - b)) {
    const slot = slots.get(n)!;
    // A slot is usable only when all three required fields are present.
    if (!slot.baseUrl || !slot.apiKey || !slot.model) continue;
    const maxConcurrency = Number.parseInt(env[`LLM_API_${n}_MAX_CONCURRENCY`] ?? "", 10);
    apis.push({
      id: String(n),
      baseUrl: slot.baseUrl,
      apiKey: slot.apiKey,
      model: slot.model,
      maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency >= 1 ? maxConcurrency : 1,
      activeRequests: 0,
      failureCount: 0,
      cooldownUntil: 0,
      lastUsed: 0,
      source: "env",
    });
  }
  return apis;
}

interface AdminApiRecord {
  id: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxConcurrency?: number;
  enabled?: boolean;
}

/** Admin-managed endpoints (settings key `llm_pool_apis`); failures degrade to env-only. */
async function adminPoolApis(): Promise<PoolApi[]> {
  try {
    const { sql } = await import("../db.ts");
    const rows = await sql<{ value: { apis?: AdminApiRecord[] } | null }[]>`SELECT value FROM settings WHERE key = 'llm_pool_apis'`;
    const records = rows[0]?.value?.apis ?? [];
    return records
      .filter((r) => r.enabled !== false && r.baseUrl?.trim() && r.apiKey?.trim() && r.model?.trim())
      .map((r) => ({
        id: `admin-${r.id}`,
        baseUrl: r.baseUrl!.trim(),
        apiKey: r.apiKey!.trim(),
        model: r.model!.trim(),
        maxConcurrency: Number.isFinite(r.maxConcurrency) && (r.maxConcurrency ?? 0) >= 1 ? r.maxConcurrency! : 1,
        activeRequests: 0,
        failureCount: 0,
        cooldownUntil: 0,
        lastUsed: 0,
        source: "admin" as const,
        label: r.name?.trim() || undefined,
      }));
  } catch {
    // The settings table may not exist yet (first migrate) or the DB may be restarting;
    // the pool keeps working with whatever the environment provides.
    return [];
  }
}

let pool: PoolApi[] | null = null;
let poolLoadedAt = 0;
const POOL_TTL_MS = 5_000;

/** Re-scans the environment and returns the active pool. Exported for tests. */
export function refreshPool(): PoolApi[] {
  pool = discoverPoolApis();
  cursor = 0; // a fresh scan restarts the rotation
  poolLoadedAt = Date.now();
  return pool;
}

/** Drops the cached pool so the next poolApis() call re-reads env + admin settings. */
export function invalidatePoolCache(): void {
  pool = null;
  poolLoadedAt = 0;
}

/**
 * The active pool: environment slots plus admin-managed endpoints, re-read at most
 * once per TTL so config changes from the admin reach every process without a restart.
 */
export async function poolApisAsync(): Promise<PoolApi[]> {
  if (pool === null || Date.now() - poolLoadedAt > POOL_TTL_MS) {
    const admin = await adminPoolApis();
    pool = [...discoverPoolApis(), ...admin];
    cursor = 0;
    poolLoadedAt = Date.now();
  }
  return pool;
}

/** The cached pool without the settings re-read; lazily discovered once. */
export function poolApis(): PoolApi[] {
  if (pool === null) pool = discoverPoolApis();
  return pool;
}

let globalActive = 0;
const globalWaiters: Array<() => void> = [];

async function acquireGlobal(): Promise<void> {
  if (globalActive < globalLimit()) {
    globalActive++;
    return;
  }
  // A releaseGlobal hands this waiter a slot by incrementing the count itself;
  // incrementing here too would leak slots and eventually deadlock the pool.
  await new Promise<void>((resolve) => globalWaiters.push(resolve));
}

function releaseGlobal(): void {
  globalActive--;
  const next = globalWaiters.shift();
  if (next) {
    globalActive++;
    next();
  }
}

let cursor = 0;

/** Round-robin over healthy endpoints with capacity, starting after the last pick. */
export function nextAvailable(now: number = Date.now()): PoolApi | null {
  const list = poolApis();
  if (list.length === 0) return null;
  for (let i = 0; i < list.length; i++) {
    const idx = (cursor + i) % list.length;
    const api = list[idx]!;
    if (api.cooldownUntil <= now && api.activeRequests < api.maxConcurrency) {
      cursor = (idx + 1) % list.length;
      return api;
    }
  }
  return null;
}

/** Waits for a global slot, then for a healthy endpoint with capacity. */
export async function acquireEndpoint(): Promise<AcquiredEndpoint> {
  await acquireGlobal();
  const waitUntil = Date.now() + 30_000;
  try {
    for (;;) {
      const api = nextAvailable();
      if (api) {
        api.activeRequests++;
        api.lastUsed = Date.now();
        let released = false;
        return {
          api,
          markFailed(reason: string) {
            void reason;
            api.failureCount++;
            api.cooldownUntil = Date.now() + cooldownMs();
          },
          release() {
            if (released) return;
            released = true;
            api.activeRequests--;
            releaseGlobal();
          },
        };
      }
      if (Date.now() > waitUntil) {
        throw new Error("No LLM API available (all endpoints busy or in cooldown)");
      }
      await sleep(200);
    }
  } catch (error) {
    releaseGlobal();
    throw error;
  }
}

/** Read-only global in-flight request count; useful for diagnostics and tests. */
export function globalActiveRequests(): number {
  return globalActive;
}

/** Read-only health snapshot for the admin; never contains API keys. */
export function poolHealth(): Array<{
  id: string;
  source: string;
  label?: string;
  baseUrl: string;
  model: string;
  activeRequests: number;
  maxConcurrency: number;
  failureCount: number;
  cooldownUntil: number;
  lastUsed: number;
  healthy: boolean;
}> {
  const now = Date.now();
  return poolApis().map((api) => ({
    id: api.id,
    source: api.source,
    label: api.label,
    baseUrl: api.baseUrl,
    model: api.model,
    activeRequests: api.activeRequests,
    maxConcurrency: api.maxConcurrency,
    failureCount: api.failureCount,
    cooldownUntil: api.cooldownUntil,
    lastUsed: api.lastUsed,
    healthy: api.cooldownUntil <= now,
  }));
}

/**
 * Runs `run` at most `maxAttempts` times. A thrown error only triggers a retry
 * when `isRetryable(error)` returns true; otherwise it is rethrown immediately.
 * Defaults to 3 attempts (one original + two retries) with 1s/2s backoff.
 */
export async function withFailover<T>(
  run: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  maxAttempts = 3,
  backoffMs: (attempt: number) => number = (attempt) => (attempt + 1) * 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
      if (attempt < maxAttempts - 1) await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}
