// M2 验证：sources 池通过 assertSupportedConfig + SeedSource 字段校验（与 M1 相同逻辑）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLLECTED = ["_aihot", "allowUrlPrefixes", "denyUrlPrefixes", "ingestNoiseFilter", "itemUrlPrefixRewrite", "sortByPublishedAt", "detail", "fetchPublicContent"];
const KEYS = {
  rss: [...COLLECTED, "feedUrl", "summaryIsBody", "preserveUrlFragment", "allowCategories", "denyCategories"],
  web_list: [...COLLECTED, "url", "baseUrl", "parseMode", "adapter", "cacheToleranceSeconds", "linksStartLine", "preserveUrlFragment", "itemSelector", "linkSelector", "titleSelector", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset"],
  json_list: [...COLLECTED, "url", "mode", "method", "headers", "bodyJson", "jsonKey", "windowVar", "itemsPath", "itemsObjectValues", "titlePaths", "summaryPaths", "summaryIsBody", "authorPaths", "publishedAtPath", "publishedAtUnit", "externalIdPath", "urlTemplate", "urlTemplateFallback", "rawDropKeys", "requireBoolean", "minNumeric"],
  x_search: ["_aihot", "ingestNoiseFilter", "itemUrlPrefixRewrite", "query", "searchType"],
  mp_account: ["wxid", "ghid", "nickname"],
  external: [],
};
const NESTED = { _aihot: ["initialBackfillLimit", "initialBackfillMonths"], ingestNoiseFilter: ["dropMarkers", "dropMarkersTitleOnly", "keepIfMatches"], itemUrlPrefixRewrite: ["from", "to"], requireBoolean: ["path", "equals"], minNumeric: ["path", "min"], detail: ["maxFetches", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset", "publishedAtAuthoritative", "upgradeDatePrecision", "titleSelector", "titleRegex", "titleAuthoritative", "summarySelector"] };
const VALUES = { adapter: ["mimo_home"], parseMode: ["html", "markdown", "docusaurus_changelog"] };
function unsupported(kind, config) {
  const allowed = new Set(KEYS[kind] ?? []);
  const out = [];
  for (const [k, v] of Object.entries(config ?? {})) {
    if (!allowed.has(k)) out.push(k);
    else if (VALUES[k] && !VALUES[k].includes(String(v))) out.push(`${k}=${v}`);
    else if (NESTED[k] && v && typeof v === "object") for (const s of Object.keys(v)) if (!NESTED[k].includes(s)) out.push(`${k}.${s}`);
  }
  return out;
}

const pool = JSON.parse(fs.readFileSync(path.join(root, "scripts/m2-merged.json"), "utf8")).sources;
const ROW = new Set(["id", "name", "kind", "config", "tier", "first_party", "owner_entity_id", "participation_mode", "interval_minutes", "tags", "site_fulltext", "syndicate_fulltext", "enabled"]);
let bad = 0;
for (const s of pool) {
  const u = unsupported(s.kind, s.config);
  if (u.length) { console.log("REJECT", s.id, "->", u.join(", ")); bad++; }
  for (const k of Object.keys(s)) if (!ROW.has(k)) { console.log("EXTRA-ROW-FIELD", s.id, k); bad++; }
  if (!["T1", "T1_5", "T2", "EXCLUDE_MP"].includes(s.tier)) { console.log("BAD-TIER", s.id, s.tier); bad++; }
  if (!["editorial", "hot_signal", "isolated"].includes(s.participation_mode)) { console.log("BAD-MODE", s.id); bad++; }
}
console.log(bad === 0 ? `✅ ${pool.length} 条全部通过 assertSupportedConfig + SeedSource 校验` : `${bad} 处问题`);
