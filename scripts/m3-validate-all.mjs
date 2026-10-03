// M3 最终校验：industry/sources.json 全部信源过 assertSupportedConfig
import { readFileSync } from "node:fs";
import { assertSupportedConfig } from "../packages/backend/src/sources/config-keys.ts";

const d = JSON.parse(readFileSync("industry/sources.json", "utf8"));
const bad = [];
for (const s of d.sources) {
  try { assertSupportedConfig(s.kind, s.config); }
  catch (e) { bad.push(`${s.id}: ${e.message}`); }
}
console.log(`sources=${d.sources.length}  bad=${bad.length}`);
bad.forEach((b) => console.log("  " + b));
process.exit(bad.length ? 1 : 0);