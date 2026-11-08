// Constella 版本锁断言脚本（T0-08 交付；口径 = TDD-C-M1 §6.7）。
//
// 用法：node scripts/check-versions.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-versions ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 断言面 = 下方 ASSERTIONS 数组（可扩展；比较为严格相等——精确锁版，`^`/`~` 前缀一律判失败）：
//   - P0（本卡 T0-08）：client devDependencies —— electron 45.2.3（S-1 锁）/ esbuild 0.28.2（S-5 锁）/ typescript 5.9.3（S-1 口径）
//   - P3（T3-01 / C-01 首卡增补 renderer 断言面，届时向数组追加即可）：
//       { pkg: './client', dep: 'react',           version: '19.3.1',    scope: 'dependencies' },
//       { pkg: './client', dep: '@xyflow/react',   version: '12.12.1',   scope: 'dependencies' },
//       { pkg: './client', dep: 'zustand',         version: '5.1.0',     scope: 'dependencies' },
//       { pkg: './client', dep: 'zundo',           version: '2.3.0',     scope: 'dependencies' },
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @type {Array<{
 *   pkg: string;            // 相对仓库根的 workspace 目录
 *   dep: string;            // 依赖名
 *   version: string;        // 期望精确版本（严格相等）
 *   scope: 'dependencies' | 'devDependencies';
 * }>}
 */
const ASSERTIONS = [
  { pkg: './client', dep: 'electron', version: '45.2.3', scope: 'devDependencies' },
  { pkg: './client', dep: 'esbuild', version: '0.28.2', scope: 'devDependencies' },
  { pkg: './client', dep: 'typescript', version: '5.9.3', scope: 'devDependencies' },
];

const failures = [];
for (const a of ASSERTIONS) {
  const label = `${a.pkg} ${a.scope}.${a.dep}`;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(repoRoot, a.pkg, 'package.json'), 'utf8'));
  } catch (err) {
    failures.push(`[fail] ${label}: package.json 不可读或非法 JSON（${err instanceof Error ? err.message : String(err)}）`);
    continue;
  }
  const actual = (manifest[a.scope] ?? {})[a.dep];
  if (actual === undefined) {
    failures.push(`[fail] ${label}: 缺失（期望 ${a.version}）`);
  } else if (actual !== a.version) {
    failures.push(`[fail] ${label}: 实际 ${actual} ≠ 期望 ${a.version}`);
  } else {
    console.log(`[ok] ${label} = ${actual}`);
  }
}

if (failures.length > 0) {
  console.error(`check-versions FAILED（${failures.length} 项差异）:`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('check-versions ok');
