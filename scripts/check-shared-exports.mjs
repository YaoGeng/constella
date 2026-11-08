// @constella/shared exports ↔ src 子域一致性断言（T0-12 交付；口径 = TDD-X-01 §6.3）。
//
// 用法：node scripts/check-shared-exports.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-shared-exports ok`，exit 0
//   失败：打印全部差异项，exit 1
//
// 断言面：
//   1. shared/package.json exports 键集合 ≡ 六 subpath（./dsl ./manifest ./dto ./ipc ./constants ./settings）
//   2. 每 subpath 的 types 条件指向 ./src/<域>/index.ts 且该文件存在
//   3. 每域 index.ts 至少含一条导出语句（export type/interface/const/class/function/`export *`）且非占位
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = path.join(repoRoot, 'shared');

const EXPECTED_SUBPATHS = ['./dsl', './manifest', './dto', './ipc', './constants', './settings'];

const failures = [];

// —— 1. exports 键集合 ≡ 六 subpath ——
let pkg;
try {
  pkg = JSON.parse(readFileSync(path.join(sharedDir, 'package.json'), 'utf8'));
} catch (err) {
  console.error(`[fail] 无法读取 shared/package.json：${err.message}`);
  process.exit(1);
}
const exportKeys = Object.keys(pkg.exports ?? {});
const missingSubpaths = EXPECTED_SUBPATHS.filter((k) => !exportKeys.includes(k));
const extraSubpaths = exportKeys.filter((k) => !EXPECTED_SUBPATHS.includes(k));
if (missingSubpaths.length) failures.push(`exports 缺少 subpath：${missingSubpaths.join(', ')}`);
if (extraSubpaths.length) failures.push(`exports 多出 subpath：${extraSubpaths.join(', ')}`);
if (!failures.length) console.log(`[ok] exports 六 subpath 齐全（${exportKeys.length}/6）`);

// —— 2+3. 每 subpath → src 子域 index.ts 存在且导出非空 ——
const EXPORT_STMT_RE = /^\s*export\s+(?:type\s+\{|interface\s+|const\s+|class\s+|function\s+|\*)/m;
for (const subpath of EXPECTED_SUBPATHS) {
  const domain = subpath.slice(2); // './dsl' -> 'dsl'
  const entry = pkg.exports?.[subpath]?.types;
  const expectedEntry = `./src/${domain}/index.ts`;
  if (entry !== expectedEntry) {
    failures.push(`exports['${subpath}'].types = ${JSON.stringify(entry)}，期望 ${JSON.stringify(expectedEntry)}`);
    continue;
  }
  const indexFile = path.join(sharedDir, 'src', domain, 'index.ts');
  if (!existsSync(indexFile) || !statSync(indexFile).isFile()) {
    failures.push(`src/${domain}/index.ts 不存在`);
    continue;
  }
  const src = readFileSync(indexFile, 'utf8');
  if (!EXPORT_STMT_RE.test(src)) {
    failures.push(`src/${domain}/index.ts 无导出语句（占位/空文件）`);
    continue;
  }
  const exportCount = (src.match(/^export\s/gm) ?? []).length;
  console.log(`[ok] ${subpath} -> src/${domain}/index.ts（${exportCount} 条 export 语句）`);
}

if (failures.length) {
  console.error('\ncheck-shared-exports FAIL：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-shared-exports ok');
