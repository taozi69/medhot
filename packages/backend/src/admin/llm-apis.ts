// LLM API Pool entries managed from the admin. Stored as one JSON document in the settings
// table (key `llm_pool_apis`) so both the api and the worker pick changes up without a
// restart; the pool provider merges them with the LLM_API_N_* environment slots. API keys
// are stored server-side only and never returned in full — every list/detail view shows a
// masked form, and PATCH without an apiKey keeps the stored one.
import { randomUUID } from "node:crypto";
import { sql } from "../db.ts";
import { audit } from "./auth.ts";
import { invalidatePoolCache } from "../providers/llm-pool.ts";

const SETTINGS_KEY = "llm_pool_apis";
const MAX_APIS = 50;

export interface LlmApiRecord {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxConcurrency: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PoolSettings {
  apis: LlmApiRecord[];
}

/** Masked form shown in every admin view; the full key never leaves the server. */
function maskKey(key: string): string {
  if (key.length < 8) return "***";
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

function publicView(record: LlmApiRecord) {
  const { apiKey, ...rest } = record;
  return { ...rest, apiKeyMasked: maskKey(apiKey), hasKey: apiKey.length > 0 };
}

async function loadSettings(): Promise<PoolSettings> {
  const [row] = await sql<{ value: PoolSettings }[]>`SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
  return row?.value?.apis ? row.value : { apis: [] };
}

async function saveSettings(value: PoolSettings, actor: string): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${SETTINGS_KEY}, ${sql.json(value as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL 必须是 http(s) 地址");
  return url.toString().replace(/\/+$/, "");
}

function validate(input: { name?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown; maxConcurrency?: unknown }) {
  const name = String(input.name ?? "").trim();
  const baseUrl = String(input.baseUrl ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  const model = String(input.model ?? "").trim();
  const maxConcurrency = Number.parseInt(String(input.maxConcurrency ?? "1"), 10);
  if (!baseUrl) throw new Error("Base URL 必填，例如 https://api.deepseek.com/v1");
  if (!model) throw new Error("模型名必填，例如 deepseek-chat");
  return {
    name: name || model,
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    model,
    maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency >= 1 && maxConcurrency <= 64 ? maxConcurrency : 1,
  };
}

/** List all pool entries: admin-managed ones plus the LLM_API_N_* environment slots. */
export async function listLlmApis() {
  const { apis } = await loadSettings();
  const env = Object.keys(process.env)
    .map((k) => /^LLM_API_(\d+)_KEY$/.exec(k))
    .filter(Boolean)
    .map((m) => {
      const n = m![1]!;
      const key = process.env[`LLM_API_${n}_KEY`]!.trim();
      const baseUrl = process.env[`LLM_API_${n}_BASE_URL`]?.trim() ?? "";
      const model = process.env[`LLM_API_${n}_MODEL`]?.trim() ?? "";
      const maxConcurrency = Number.parseInt(process.env[`LLM_API_${n}_MAX_CONCURRENCY`] ?? "", 10);
      return {
        id: `env-${n}`,
        slot: Number(n),
        baseUrl,
        model,
        maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency >= 1 ? maxConcurrency : 1,
        apiKeyMasked: key ? maskKey(key) : "（未设置）",
        ready: !!(baseUrl && key && model),
      };
    })
    .sort((a, b) => a.slot - b.slot);
  return { apis: apis.map(publicView), envApis: env, cooldownMs: undefined };
}

export async function createLlmApi(input: { name?: string; baseUrl: string; apiKey: string; model: string; maxConcurrency?: number; note?: string }, actor: string) {
  const clean = validate(input);
  if (!clean.apiKey) throw new Error("API Key 必填（也可以留空槽位后通过环境变量提供）");
  const settings = await loadSettings();
  if (settings.apis.length >= MAX_APIS) throw new Error(`最多 ${MAX_APIS} 个 API 端点`);
  const now = new Date().toISOString();
  const record: LlmApiRecord = {
    id: randomUUID().slice(0, 8),
    createdAt: now,
    updatedAt: now,
    ...clean,
    enabled: true,
  };
  settings.apis.push(record);
  await saveSettings(settings, actor);
  invalidatePoolCache();
  await audit(actor, "llm-pool.create", `llm-api:${record.id}`, input.note ?? null, null, {
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    maxConcurrency: record.maxConcurrency,
    apiKey: maskKey(record.apiKey),
  });
  return publicView(record);
}

export async function updateLlmApi(id: string, patch: { name?: string; baseUrl?: string; apiKey?: string; model?: string; maxConcurrency?: number; enabled?: boolean; note?: string }, actor: string) {
  const settings = await loadSettings();
  const record = settings.apis.find((r) => r.id === id);
  if (!record) return null;
  const before = { name: record.name, baseUrl: record.baseUrl, model: record.model, maxConcurrency: record.maxConcurrency, enabled: record.enabled, apiKey: maskKey(record.apiKey) };
  const merged = validate({
    name: patch.name ?? record.name,
    baseUrl: patch.baseUrl ?? record.baseUrl,
    model: patch.model ?? record.model,
    maxConcurrency: patch.maxConcurrency ?? record.maxConcurrency,
  });
  record.name = merged.name;
  record.baseUrl = merged.baseUrl;
  record.model = merged.model;
  record.maxConcurrency = merged.maxConcurrency;
  // An absent or blank apiKey keeps the stored one.
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) record.apiKey = patch.apiKey.trim();
  if (typeof patch.enabled === "boolean") record.enabled = patch.enabled;
  record.updatedAt = new Date().toISOString();
  await saveSettings(settings, actor);
  invalidatePoolCache();
  await audit(actor, "llm-pool.update", `llm-api:${id}`, patch.note ?? null, before, {
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    maxConcurrency: record.maxConcurrency,
    enabled: record.enabled,
    apiKey: maskKey(record.apiKey),
  });
  return publicView(record);
}

export async function deleteLlmApi(id: string, reason: string, actor: string) {
  const settings = await loadSettings();
  const record = settings.apis.find((r) => r.id === id);
  if (!record) return null;
  settings.apis = settings.apis.filter((r) => r.id !== id);
  await saveSettings(settings, actor);
  invalidatePoolCache();
  await audit(actor, "llm-pool.delete", `llm-api:${id}`, reason, { name: record.name, baseUrl: record.baseUrl, model: record.model }, null);
  return { id };
}

/** One tiny live request against the endpoint; the key stays on the server. */
export async function testLlmApi(input: { id?: string; baseUrl?: string; apiKey?: string; model?: string }): Promise<{ ok: boolean; latencyMs: number; model?: string; detail?: string }> {
  let baseUrl = input.baseUrl?.trim();
  let apiKey = input.apiKey?.trim();
  let model = input.model?.trim();
  if (input.id) {
    const { apis } = await loadSettings();
    const record = apis.find((r) => r.id === input.id);
    if (!record) throw new Error("找不到这个 API 端点");
    baseUrl = baseUrl || record.baseUrl;
    apiKey = apiKey || record.apiKey;
    model = model || record.model;
  }
  if (!baseUrl || !apiKey || !model) return { ok: false, latencyMs: 0, detail: "Base URL / API Key / 模型 三项都需要填写" };
  const started = Date.now();
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 }),
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, latencyMs, detail: `HTTP ${res.status}：${text.slice(0, 300)}` };
    }
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
    return { ok: true, latencyMs, model: json.model ?? model, detail: json.choices?.[0]?.message?.content?.slice(0, 120) ?? "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: Date.now() - started, detail: message.slice(0, 300) };
  }
}
