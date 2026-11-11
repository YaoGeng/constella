// Constella server — vitest 测试配置（T6-16 收口；batch-3 登记④处置）。
//
// 为什么需要本文件：vitest 5 起 defaultExclude 收窄为 ["**/node_modules/**", "**/.git/**"]
// （`**/dist/**` 已不在默认排除表——vitest/dist/chunks/defaults 实测），而 server tsconfig 把
// *.test.ts 一并编入 dist（dist/src/**.test.js）——无配置直跑 `vitest run` 会双跑 src＋dist
// 副本（实测 24 文件＝12 src＋12 dist），两副本共库并发互扰产生漂移失败。
//
// 处置取 vitest exclude 而非 tsconfig exclude **/*.test.ts：后者会把测试文件挤出 `tsc -p
// tsconfig.json` 编译面——`tsc --noEmit`（typecheck script）对测试的类型检查将静默丢失，
// 且 build 产物含测试本属可修可不修的面；exclude dist 面最小、零 build/typecheck 影响。
//
// exclude 为整体替换语义（不与内置默认合并）——node_modules/.git 必须显式保留。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  },
});
