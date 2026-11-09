# THIRD-PARTY-NOTICES — @constella/sdk（ts 包）

S-9 分发义务声明位（TDD-K-01 §6.7；`scripts/check-sdk-deps.mjs` 为本声明的红线守护）。

## 结论：当前零第三方依赖

- 运行时依赖：**无**（`package.json` `dependencies = {}` 红线；ts 运行时依赖=零，
  node 内建除外——K-01 §2）。`dist/` 产物不含任何第三方代码。
- 类型引用：`@constella/shared/dsl` 仅出现在 `.d.ts` 类型面（NodeOut re-export，
  K-01 §2 裁决方向），不进入运行时产物、不属于分发义务。
- 开发依赖（vitest/typescript/esbuild 等 devDependencies）不随本包分发，无义务项。

## 义务

依赖增补时（K-01 §8③ npm 公开发布＝V2 届时评估）：在此登记逐包许可证与全文，
并同步 client 侧 `client/scripts/gen-notices.mjs` 的取证口径（安装态 LICENSE 优先）。
