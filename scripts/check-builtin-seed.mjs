// 内置清单三方一致断言（T1-11 交付；C-05 §6.3）。
//
// 用法：node scripts/check-builtin-seed.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-builtin-seed ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 三方（C-05 §6.3 原文：种子 JSON type 集合 ≡ X-01 BUILTIN_TYPE_IDS ≡ 01 A-4.01 清单）：
//   1. 种子侧＝client/src/main/storage/migrate/seed-data.ts——BUILTIN_DEF_SPECS 逐 type 规格键集
//      ＋派生形态断言（BUILTIN_DEFINITIONS 由 BUILTIN_TYPE_IDS.map 构造、Record<BuiltinTypeId,…>
//      编译期穷尽），seeds-runner 将其 INSERT 进 node_definitions（02 §13.2）
//   2. shared 侧＝shared/src/constants/builtin-types.ts BUILTIN_TYPE_IDS 值集
//   3. 文档侧＝01 PRD-A4-01 清单（L256，12 type 冻结；与 check-shared-consts.mjs 期望集同源维护）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

const failures = [];

/** 从 TS 源码抽取 `export const X = […] as const;` 元组块内的全部单引号字符串 */
function extractConstStrings(src, constName) {
  const m = src.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\]\\s*as const[^;]*;`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * 从 seed-data.ts 抽取 BUILTIN_DEF_SPECS 顶层键（12 type 规格键集）。
 * 形：`const BUILTIN_DEF_SPECS: Record<BuiltinTypeId, DefSpec> = { '<type>': {…}, delay: {…}, … };`
 * 顶层键＝两空格缩进后接 `{` 的属性行（嵌套 meta/ports 等为四空格缩进）——键可带单引号或不带。
 */
function extractSeedSpecKeys(src) {
  const block = src.match(
    /const BUILTIN_DEF_SPECS: Record<BuiltinTypeId, DefSpec> = \{([\s\S]*?)\n\};/,
  );
  if (!block) return null;
  return [...block[1].matchAll(/^ {2}(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*\{/gm)].map(
    (m) => m[1] ?? m[2],
  );
}

function diff(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length) failures.push(`${label}：存在重复项`);
  const missing = [...expectedSet].filter((x) => !actualSet.has(x));
  const extra = [...actualSet].filter((x) => !expectedSet.has(x));
  if (missing.length) failures.push(`${label}：缺 ${missing.join(', ')}`);
  if (extra.length) failures.push(`${label}：多 ${extra.join(', ')}`);
  return missing.length === 0 && extra.length === 0 && actualSet.size === actual.length;
}

// ————————————— 期望集（01 PRD-A4-01（L256）内置 12 type 清单冻结；V1.1 out.* 五类型随 B2 升版） —————————————

const EXPECTED_BUILTIN_TYPE_IDS = [
  'trigger.manual',
  'trigger.cron',
  'cdp.open',
  'cdp.extract',
  'cdp.click',
  'http.request',
  'ai.llm',
  'data.transform',
  'logic.branch',
  'delay',
  'file.write',
  'human.review',
];

// ————————————— 2. shared 侧：BUILTIN_TYPE_IDS 值集 —————————————

const builtinSrc = read('shared/src/constants/builtin-types.ts');
const sharedIds = extractConstStrings(builtinSrc, 'BUILTIN_TYPE_IDS');
if (!sharedIds) {
  failures.push('builtin-types.ts：无法定位 BUILTIN_TYPE_IDS 声明块');
} else {
  const ok = diff('shared BUILTIN_TYPE_IDS ↔ 01 A-4.01（12 type）', sharedIds, EXPECTED_BUILTIN_TYPE_IDS);
  if (ok) console.log(`[ok] shared BUILTIN_TYPE_IDS ↔ 01 PRD-A4-01 逐项一致（${sharedIds.length} type）`);
}

// ————————————— 1. 种子侧：BUILTIN_DEF_SPECS 键集 ＋ 派生形态 —————————————

const seedSrc = read('client/src/main/storage/migrate/seed-data.ts');
const seedKeys = extractSeedSpecKeys(seedSrc);
if (!seedKeys) {
  failures.push('seed-data.ts：无法定位 BUILTIN_DEF_SPECS 声明块（Record<BuiltinTypeId, DefSpec>）');
} else {
  const ok = diff('种子 BUILTIN_DEF_SPECS 键集 ↔ 01 A-4.01（12 type）', seedKeys, EXPECTED_BUILTIN_TYPE_IDS);
  if (ok) console.log(`[ok] 种子 12 定义规格键集 ↔ 01 PRD-A4-01 逐项一致（${seedKeys.length} type）`);
}

// 派生形态断言：BUILTIN_DEFINITIONS（seeds-runner 入库的 12 定义）由 BUILTIN_TYPE_IDS.map 构造
// ——种子 type 集由此恒等于 shared 清单；Record<BuiltinTypeId, DefSpec> 保编译期穷尽（缺一即 TS 错）。
const derivesFromShared = /export const BUILTIN_DEFINITIONS[^=]*=\s*BUILTIN_TYPE_IDS.map/.test(seedSrc);
if (!derivesFromShared) {
  failures.push('seed-data.ts：BUILTIN_DEFINITIONS 非 BUILTIN_TYPE_IDS.map 派生（种子 type 集与 shared 清单脱钩）');
} else {
  console.log('[ok] 种子 BUILTIN_DEFINITIONS ＝ BUILTIN_TYPE_IDS.map 派生（type 集 ≡ shared 清单，构造期锁定）');
}
const exhaustiveRecord = /Record<BuiltinTypeId, DefSpec>/.test(seedSrc);
if (!exhaustiveRecord) {
  failures.push('seed-data.ts：BUILTIN_DEF_SPECS 缺 Record<BuiltinTypeId, DefSpec> 穷尽标注（编译期对账面丢失）');
} else {
  console.log('[ok] Record<BuiltinTypeId, DefSpec> 穷尽标注在位（缺任一 type 规格即编译失败）');
}

// ————————————— 汇总 —————————————

if (failures.length) {
  console.error('\ncheck-builtin-seed FAIL：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-builtin-seed ok');
