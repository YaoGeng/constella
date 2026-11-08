// server 错误码一致性断言（T2-07 交付；口径 = TDD-S-02 §6.5）。
//
// 用法：node scripts/check-server-error-codes.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：打印 [ok] 分项与 `check-server-error-codes ok`，exit 0
//   失败：打印孤码/缺口清单，exit 1
//
// 断言面：
//   1. server/src 内出现的错误码字面量（全大写-连字形，如 AUTH-*/MARKET-*/REVIEW-*/NOT-FOUND）
//      ⊆ shared ERROR_CODES ∪ 卡内冻结码（FROZEN_EXTRA，本批为空）——无孤码；
//   2. market 业务码全覆盖：shared ERROR_CODES 中 MARKET-* 每项都在 server/src 有使用
//      （S-02 §6.5「market 码全覆盖」）；
//   3. 兜底：server 消费的每个业务码（AUTH-/MARKET-/REVIEW-/ADMIN- 前缀）均存在于 shared 总表。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

// —— 允许集：shared ERROR_CODES 值 + 卡内冻结码（当前为空——如后续卡冻结新码，登记于此）——
const FROZEN_EXTRA = [];
const SHARED_CONSTS = read('shared/src/constants/error-codes.ts');
const errorCodesBlock = SHARED_CONSTS.match(/export const ERROR_CODES = \{[\s\S]*?\}/);
if (!errorCodesBlock) {
  console.error('[fail] 无法解析 shared/src/constants/error-codes.ts 的 ERROR_CODES 块');
  process.exit(1);
}
// 取对象「值」字面量（键为 UPPER_SNAKE，值为错误码——含无连字符的 UNAUTHORIZED/FORBIDDEN/INTERNAL）
const ALLOWED = new Set([...errorCodesBlock[0].matchAll(/:\s*'([A-Z][A-Z0-9-]*)'/g)].map((m) => m[1]));
for (const extra of FROZEN_EXTRA) ALLOWED.add(extra);
if (ALLOWED.size < 10) {
  console.error(`[fail] ERROR_CODES 解析异常（仅 ${ALLOWED.size} 项，期望 15 项级别）——检查解析正则`);
  process.exit(1);
}

// —— 扫描面：server/src 全部 .ts（含测试；generated/node_modules 不在 src 内）——
function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const srcDir = path.join(repoRoot, 'server', 'src');
const files = listTsFiles(srcDir);

const CODE_LITERAL = /['"]([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)['"]/g;
const usedByCode = new Map(); // code -> [file:line]
for (const file of files) {
  const rel = path.relative(repoRoot, file).replaceAll('\\', '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(CODE_LITERAL)) {
      const code = m[1];
      if (!usedByCode.has(code)) usedByCode.set(code, []);
      usedByCode.get(code).push(`${rel}:${idx + 1}`);
    }
  });
}

const failures = [];

// 1) 无孤码：server 用到的每个字面量 ∈ 允许集（白名单外的大写-连字串也一并暴露，防漏网）
for (const [code, locs] of [...usedByCode].sort()) {
  if (!ALLOWED.has(code)) {
    failures.push(`孤码 ${code}（shared ERROR_CODES ∪ 冻结码外）：${locs.slice(0, 3).join(' ')}`);
  }
}

// 2) market 码全覆盖
const marketCodes = [...ALLOWED].filter((c) => c.startsWith('MARKET-'));
for (const code of marketCodes) {
  if (!usedByCode.has(code)) {
    failures.push(`market 码未被 server 使用：${code}`);
  }
}

// 3) 业务码兜底（前缀断言并入 1）——汇总输出
const businessUsed = [...usedByCode.keys()].filter((c) =>
  /^(AUTH|MARKET|REVIEW|ADMIN)-/.test(c) && ALLOWED.has(c),
);

if (failures.length > 0) {
  console.error(`[fail] check-server-error-codes：${failures.length} 项不一致`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log(`[ok] server/src（${files.length} 文件）错误码字面量 ${usedByCode.size} 项 ⊆ shared ERROR_CODES(${ALLOWED.size}) ∪ 冻结码(${FROZEN_EXTRA.length})，无孤码`);
console.log(`[ok] market 码全覆盖：${marketCodes.join(', ')}`);
console.log(`[ok] 业务码在用：${businessUsed.sort().join(', ')}`);
console.log('check-server-error-codes ok');
