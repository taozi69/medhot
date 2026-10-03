// 检查精选阈值（industry/selection.ts）与测试断言（tests/analyze.test.ts）是否一致。
//
// 为什么需要它：阈值改了但测试没跟上，CI 会红，而失败信息是一堆 120s 超时和调用序列错，
// 看不出真正原因是「测试断言还写着旧门槛」。这个脚本直接在本地把不一致点出来。
//
// 用法：node scripts/check-threshold-consistency.mjs
// 退出码 0 = 一致，1 = 有冲突（打印每一项）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELECTION_FILE = "industry/selection.ts";
const TEST_FILE = "tests/analyze.test.ts";
const SCORE_FILE = "tests/analyze.test.ts";

const problems = [];
const checked = [];

// ── 1. 从 selection.ts 读出真实阈值 ──────────────────────────────────────────
const selectionSrc = readFileSync(path.join(ROOT, SELECTION_FILE), "utf8");

const thresholds = {};
const thresholdsBlock = selectionSrc.match(/thresholds:\s*\{([^}]*)\}/);
if (!thresholdsBlock) {
  problems.push(`${SELECTION_FILE}: 找不到 thresholds 字面量（脚本需要更新）`);
} else {
  for (const m of thresholdsBlock[1].matchAll(/([A-Z_][A-Z_0-9]*)\s*:\s*(\d+)/g)) {
    thresholds[m[1]] = Number(m[2]);
  }
}

const floorMatch = selectionSrc.match(/understandFloor:\s*(\d+)/);
const floor = floorMatch ? Number(floorMatch[1]) : null;
if (floor === null) problems.push(`${SELECTION_FILE}: 找不到 understandFloor`);

const testSrc = readFileSync(path.join(ROOT, TEST_FILE), "utf8");

// ── 2. tierThreshold("T1") 断言 ──────────────────────────────────────────────
const tierAssert = testSrc.match(/tierThreshold\("(\w+)"\)\s*,\s*(\d+)/);
if (!tierAssert) {
  problems.push(`${TEST_FILE}: 找不到 tierThreshold(...) 断言（脚本需要更新）`);
} else {
  const [, tier, asserted] = tierAssert;
  const actual = thresholds[tier];
  if (actual === undefined) {
    problems.push(`${TEST_FILE}: 断言了 tierThreshold("${tier}")，但 ${SELECTION_FILE} 里没有 ${tier} 门槛`);
  } else if (actual !== Number(asserted)) {
    problems.push(
      `${TEST_FILE} 第 ${lineOf(testSrc, tierAssert[0])} 行：断言 tierThreshold("${tier}") === ${asserted}，` +
        `实际 ${SELECTION_FILE} 里是 ${actual}`,
    );
  } else {
    checked.push(`tierThreshold("${tier}") = ${actual}`);
  }
}

// ── 3. 测试里出现的 "N + M = S >= 2 × T" / "< 2 × T" 注释式说明 ──────────────
// 这些注释编码了阈值，改门槛后会变成假话（曾导致 CI 排查走弯路）。
for (const m of testSrc.matchAll(/2\s*×\s*(\d+)/g)) {
  const used = Number(m[1]);
  const isT1 = used === thresholds.T1;
  if (!isT1) {
    problems.push(
      `${TEST_FILE} 第 ${lineOf(testSrc, m[0])} 行：注释里写「2 × ${used}」，` +
        `但 T1 门槛是 ${thresholds.T1}（应为 2 × ${thresholds.T1} = ${thresholds.T1 * 2}）`,
    );
  } else {
    checked.push(`注释里的 2 × ${used} = ${used * 2} 与 T1 门槛一致`);
  }
}

// ── 4. 每个 scoreAnswers 用例是否落在预期区间 ────────────────────────────────
// 精选 = 两次之和 >= 2×门槛；写作底线（near-selected）= [2×floor, 2×门槛)
const scoreBlock = testSrc.match(/scoreAnswers[^=]*=\s*\{([^}]*)\}/);
if (!scoreBlock) {
  problems.push(`${TEST_FILE}: 找不到 scoreAnswers（脚本需要更新）`);
} else if (floor !== null && thresholds.T1 !== undefined) {
  const selectedLine = 2 * thresholds.T1;
  const floorLine = 2 * floor;
  const cases = [...scoreBlock[1].matchAll(/([\w\u4e00-\u9fa5]+)\s*:\s*\[(\d+)\s*,\s*(\d+)\]/g)].map(
    (m) => ({ name: m[1], sum: Number(m[2]) + Number(m[3]) }),
  );
  for (const c of cases) {
    const band = c.sum >= selectedLine ? "精选" : c.sum >= floorLine ? "near-selected(精选写法)" : "翻译";
    checked.push(`用例 ${c.name}: ${c.sum} 分 → ${band}`);
  }
  // 关键区间必须有用例覆盖，否则改阈值后测试会静默失去意义。
  const hasSelected = cases.some((c) => c.sum >= selectedLine);
  const hasNear = cases.some((c) => c.sum >= floorLine && c.sum < selectedLine);
  const hasBelow = cases.some((c) => c.sum < floorLine);
  if (!hasSelected) problems.push(`测试用例里没有任何一条落在精选区间（>= ${selectedLine}），改了阈值后测试失去意义`);
  if (!hasNear) problems.push(`测试用例里没有任何一条落在 near-selected 区间（${floorLine}~${selectedLine - 1}），改阈值后该区间无人覆盖`);
  if (!hasBelow) problems.push(`测试用例里没有任何一条落在翻译区间（< ${floorLine}），改阈值后该区间无人覆盖`);
}

// ── 5. 阈值相关注释是否还写着旧值 ────────────────────────────────────────────
const staleNote = testSrc.match(/The M2 thresholds \(T1:\s*(\d+),\s*floor:\s*(\d+)\)/);
if (staleNote) {
  const [, noteT1, noteFloor] = staleNote;
  if (Number(noteT1) !== thresholds.T1 || Number(noteFloor) !== floor) {
    problems.push(
      `${TEST_FILE} 第 ${lineOf(testSrc, staleNote[0])} 行：注释写「T1: ${noteT1}, floor: ${noteFloor}」，` +
        `实际是「T1: ${thresholds.T1}, floor: ${floor}」`,
    );
  } else {
    checked.push(`阈值说明注释与实际一致（T1: ${noteT1}, floor: ${noteFloor}）`);
  }
}

function lineOf(src, needle) {
  return src.slice(0, src.indexOf(needle)).split("\n").length;
}

// ── 输出 ─────────────────────────────────────────────────────────────────────
console.log(`实际阈值：T1=${thresholds.T1} T1_5=${thresholds.T1_5} T2=${thresholds.T2} floor=${floor}`);
console.log(`精选线 = ${2 * thresholds.T1}  写作底线 = ${2 * floor}\n`);

if (problems.length === 0) {
  console.log(`✅ 一致（检查了 ${checked.length} 项）`);
  for (const c of checked) console.log(`   · ${c}`);
  process.exit(0);
}

console.log(`❌ 发现 ${problems.length} 处不一致：\n`);
for (const p of problems) console.log(`   ✖ ${p}`);
console.log("\n改阈值时请同步更新 tests/analyze.test.ts 的断言与注释（见 docs/selection.md）。");
process.exit(1);
