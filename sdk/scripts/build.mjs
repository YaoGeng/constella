// @constella/sdk dist 构建（T4-12 打包分发；K-01 §3 packaging 行＋§6.4）。
//
// 产物（dist/，经 `files` 字段进 pack tarball；publishConfig.exports 指向此处）：
//   dist/index.js|index.d.ts      —— "." subpath：类型面＋identity 参考实现
//   dist/bootstrap.js|bootstrap.d.ts —— "./bootstrap" subpath：子进程 trampoline
//   dist/caps.js|caps.d.ts        —— 被 . 引用的内部模块（随双 subpath 一并装载）
//   dist/net.js|net.d.ts          —— net 绑定客户端（T5-12b；被 bootstrap 引用的内部模块）
//
// 口径：
//   - JS/类型发射=tsc 5.9（typescript devDep；module ESNext＋package type=module → ESM 产物，
//     node ≥24 直跑）；rewriteRelativeImportExtensions 把 src 内显式 .ts 相对导入改写为 .js；
//   - d.ts 补改写：tsc 5.9 的 rewriteRelativeImportExtensions 只作用于 JS 发射，声明文件仍保留
//     `./caps.ts` ——本脚本对 dist/*.d.ts 的相对导入统一改写为 `.js`（ts 解析 .js→.d.ts 的
//     标准映射，bundler/nodenext 均可达）；外部导入（@constella/shared/dsl）不动；
//   - prepack 钩子驱动（pnpm pack --dry-run 亦执行 prepack，实测 pnpm 12.11.2）——
//     验收命令链 `pnpm -F ./sdk pack --dry-run` 无独立 build 步骤，靠本钩子自足。
//
// 运行：node scripts/build.mjs（或 `pnpm -F ./sdk run build`；任意 cwd 均可，路径按 import.meta.url 定位）
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SDK_ROOT, 'dist');
const TSC = path.join(SDK_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// ---------- 1. 清理＋tsc 发射 ----------
rmSync(DIST, { recursive: true, force: true });
const tsc = spawnSync(process.execPath, [TSC, '-p', path.join(SDK_ROOT, 'tsconfig.build.json')], {
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  console.error('[sdk-build] tsc 发射失败');
  process.exit(tsc.status ?? 1);
}

// ---------- 2. d.ts 相对导入扩展名改写（.ts → .js；见文件头口径注记） ----------
const DTS_REWRITE_RE = /(from\s+')(\.\.?\/[^']+)\.ts(')/g;
let rewritten = 0;
for (const f of readdirSync(DIST).filter((f) => f.endsWith('.d.ts'))) {
  const p = path.join(DIST, f);
  const src = readFileSync(p, 'utf8');
  const out = src.replace(DTS_REWRITE_RE, '$1$2.js$3');
  if (out !== src) {
    writeFileSync(p, out);
    rewritten += 1;
  }
}

// ---------- 3. 产物核验（§6.4：dts 与双 subpath 目标文件必须在位） ----------
const REQUIRED = ['index.js', 'index.d.ts', 'bootstrap.js', 'bootstrap.d.ts', 'caps.js', 'caps.d.ts', 'net.js', 'net.d.ts'];
const missing = REQUIRED.filter((f) => !readdirSync(DIST).includes(f));
if (missing.length) {
  console.error(`[sdk-build] dist 产物缺失: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`[sdk-build] dist 构建完成（${REQUIRED.length} 文件；d.ts 扩展名改写 ${rewritten} 文件）`);
