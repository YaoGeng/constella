// 示例资产 10 zip 生成脚本（T5-08 / TDD-C-08 §3 示例资产段；T6-18 增 xhs.comment.post 9→10）。
//
// 用法：node scripts/gen-examples.mjs [outDir]（缺省=client/assets/examples）
//   产物：<type>.zip ×10——由 src/main/zip/example-assets.ts（单一事实源）经 main/zip
//   ZipWriter 产出（store 档＋CRC32/伪目录自校验＋ZIP_EPOCH 确定性——同输入同字节，
//   content_hash 跨机稳定＝ExamplePreloader 二启零 delta 的幂等前提）。
//
// 为何经 esbuild 打包 TS 源再执行：example-assets.ts 及其依赖（ZipWriter/jszip）为 TS 模块
// （bundler 式无扩展名解析——node 原生 type-strip 不可直载）；本脚本用 devDep esbuild
// （S-5 锁 0.28.2）打临时 bundle 到 client/dist/tools/（node_modules 解析可达）后 dynamic
// import 调用——与 esbuild.mjs 同一 bundleShared 口径（@constella/shared exports 指 TS 源）。
//
// 二进制 zip 入库取舍（卡面 ⚠ 二选一——本卡采「入库」）：dev/test/头跑冒烟/P6 打包均直接
// 消费 committed 产物，零构建前置；漂移防护=example-preloader.spec 以同一数据源重产字节
// 逐枚 SHA-256 比对（zip 被手改即断言失败）。
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);

const sharedSrc = here('../../shared/src');

/** @constella/shared/<subpath> → shared/src/<subpath>.ts（esbuild.mjs bundleShared 同口径） */
const bundleShared = {
  name: 'bundle-shared',
  setup(b) {
    b.onResolve({ filter: /^@constella\/shared(\/.+)?$/ }, (args) => {
      const sub = args.path.slice('@constella/shared'.length);
      const base = path.join(sharedSrc, sub);
      if (existsSync(`${base}.ts`)) return { path: `${base}.ts` };
      if (existsSync(path.join(base, 'index.ts'))) return { path: path.join(base, 'index.ts') };
      return { path: `${base}.ts` };
    });
  },
};

const outDir = process.argv[2] !== undefined ? path.resolve(process.argv[2]) : here('../assets/examples');
const bundleOut = here('../dist/tools/gen-examples.bundle.mjs');

await build({
  stdin: {
    // 打包 example-assets（数据源＋writeExampleZips）——脚本侧只做调用与路径接线
    contents: "export { writeExampleZips, EXAMPLE_COUNT } from '../src/main/zip/example-assets.ts';",
    resolveDir: here('.'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  minify: false,
  logLevel: 'warning',
  plugins: [bundleShared],
  outfile: bundleOut,
});

const { writeExampleZips, EXAMPLE_COUNT } = await import(pathToFileURL(bundleOut).href);
const { written, dir } = await writeExampleZips(outDir);
if (written !== EXAMPLE_COUNT || EXAMPLE_COUNT !== 10) {
  console.error(`[gen-examples] 产物数 ${written} ≠ 10（EXAMPLE_COUNT=${EXAMPLE_COUNT}）`);
  process.exit(1);
}
console.log(`[gen-examples] ok：${written} 枚示例 zip → ${dir}`);
