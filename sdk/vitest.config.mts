// @constella/sdk —— vitest 测试配置（T4-10；TDD-K-01 §6.1 验收命令
// `pnpm -F ./sdk exec vitest run contract` 的宿主）。
//
// environment=node、globals=false：与 client 包同口径——测试一律显式
// `import { describe, it, expect } from 'vitest'`，`tsc --noEmit`（§6.3）零配置通过
// （tsconfig types 仅 ["node"]）。
//
// 契约测试形态（S-5 基的直跑变体）：test/contract.test.ts 生成 entry 后 spawn
// `node <entry>` 子进程直跑 fixtures＋bootstrap（node ≥23.6 原生 type-stripping，
// 不经 esbuild——esbuild 可打包回归归 T4-12 §6.5）；因此 src 内相对 import 一律
// 带显式 .ts 扩展名、JSON import 带 `with { type: 'json' }` 属性。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
});
