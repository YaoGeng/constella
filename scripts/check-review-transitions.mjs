// review 状态机迁移表静态断言（T2-08 交付；口径 = TDD-S-03 §6.3——迁移表与 §1 mermaid 图一致且无其他出边）。
//
// 用法：node scripts/check-review-transitions.mjs（仓库根；任意 cwd 均可）
//   成功：打印迁移表与 `check-review-transitions ok`，exit 0
//   失败：打印差异，exit 1
//
// 期望集（03 S-03 §1 状态机图逐边抄录）：
//   PENDING  → APPROVED, REJECTED（approve / reject+reason）
//   APPROVED → OFFLINE（offline+reason）
//   REJECTED → （无 review 出边；回 PENDING 由 S-02 再发布置位，非本域动作）
//   OFFLINE  → （V1 终态，无重新上架端点）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 期望迁移表（§1 图冻结；键集=PackageStatus 全集，值=合法目标全集，空数组=终态）
const EXPECTED = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['OFFLINE'],
  REJECTED: [],
  OFFLINE: [],
};

const src = readFileSync(
  path.join(repoRoot, 'server/src/routes/review/state-machine.ts'),
  'utf8',
);

const blockMatch = src.match(/export const REVIEW_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\}\s*;/);
if (!blockMatch) {
  console.error('[fail] 未找到 REVIEW_TRANSITIONS 字面量（server/src/routes/review/state-machine.ts）');
  process.exit(1);
}

// 解析 `{ KEY: ['A','B'], ... }` 逐键值
const actual = {};
for (const line of blockMatch[1].split('\n')) {
  const m = line.match(/^\s*([A-Z]+)\s*:\s*\[([^\]]*)\]\s*,?\s*$/);
  if (!m) continue;
  actual[m[1]] = [...m[2].matchAll(/['"]([A-Z]+)['"]/g)].map((x) => x[1]);
}

const failures = [];
const keys = new Set([...Object.keys(EXPECTED), ...Object.keys(actual)]);

// 键集=PackageStatus 全集（多键=其他出边来源，少键=状态缺失）
const expectedKeys = Object.keys(EXPECTED);
const actualKeys = Object.keys(actual);
const extraKeys = actualKeys.filter((k) => !expectedKeys.includes(k));
const missingKeys = expectedKeys.filter((k) => !(k in actual));
if (extraKeys.length) failures.push(`多出状态键（其他出边来源）：${extraKeys.join(', ')}`);
if (missingKeys.length) failures.push(`缺状态键：${missingKeys.join(', ')}`);

for (const key of expectedKeys) {
  if (!(key in actual)) continue;
  const exp = EXPECTED[key];
  const act = actual[key];
  const same =
    exp.length === act.length && exp.every((v, i) => act[i] === v);
  if (!same) {
    failures.push(`${key}：期望 [${exp.join(', ')}] 实际 [${act.join(', ')}]`);
  }
}

if (failures.length > 0) {
  console.error(`[fail] check-review-transitions：${failures.length} 项与 03 S-03 §1 图不一致`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

for (const [from, tos] of Object.entries(actual)) {
  console.log(`[ok] ${from} → ${tos.length ? tos.join('/') : '（终态，无出边）'}`);
}
console.log('check-review-transitions ok');
