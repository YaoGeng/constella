// Constella client — main/preload 构建脚本（T0-08；esbuild 0.28.2，S-5 锁）。
//
// 产物：
//   - dist/main/index.js    —— main 进程入口（= package.json "main" 字段）
//   - dist/preload/index.js —— sandboxed renderer 的 preload（Electron 沙箱下只能是 CJS）
//
// 口径：
//   - format 'cjs'：main 用 CJS 最稳（无 "type":"module"）；沙箱 preload 强制 CJS
//   - target 'node24'：Electron 45 内置 Node 24.22.2（S-1）
//   - packages 'external'：node_modules（electron 等）一律外部化，只打包本地源码
//   - sourcemap 'linked'：外置 .map + sourceMappingURL 注释（S-5 同口径）
//   - minify false：主进程代码保持可调试
//
// 运行：node esbuild.mjs（任意 cwd 均可，路径按 import.meta.url 定位）
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  sourcemap: 'linked',
  minify: false,
  logLevel: 'info',
};

try {
  await build({
    ...shared,
    entryPoints: [here('src/main/index.ts')],
    outfile: here('dist/main/index.js'),
  });
  await build({
    ...shared,
    entryPoints: [here('src/preload/index.ts')],
    outfile: here('dist/preload/index.js'),
  });
} catch (err) {
  console.error('[client-build] esbuild 失败:', err);
  process.exit(1);
}
