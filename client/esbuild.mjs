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
//     ——例外：workspace 链接包 @constella/shared 经 bundleShared 重写为相对路径随包
//     打包（T4-04 修复：shared 无编译产物〔exports 指 TS 源〕，external 化后 main CJS
//     require 在运行时进 ESM/TS 图解析 './xxx' 无扩展名即失败——自 main 侧引入 shared
//     运行时值起 e2e 宿主无法启动；shared 只含类型与常量，bundle 体积可忽略）
//   - sourcemap 'linked'：外置 .map + sourceMappingURL 注释（S-5 同口径）
//   - minify false：主进程代码保持可调试
//
// 运行：node esbuild.mjs（任意 cwd 均可，路径按 import.meta.url 定位）
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const sharedSrc = here('../shared/src');

/** @constella/shared/<subpath> → ../shared/src/<subpath>.ts（目录→index.ts；裸包名→src/index.ts） */
const bundleShared = {
  name: 'bundle-shared',
  setup(b) {
    b.onResolve({ filter: /^@constella\/shared(\/.+)?$/ }, (args) => {
      const sub = args.path.slice('@constella/shared'.length);
      const base = path.join(sharedSrc, sub);
      if (existsSync(`${base}.ts`)) return { path: `${base}.ts` };
      if (existsSync(path.join(base, 'index.ts'))) return { path: path.join(base, 'index.ts') };
      return { path: `${base}.ts` }; // 缺失留给 esbuild 报可读错误
    });
  },
};

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
  plugins: [bundleShared],
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
