// Constella client — vitest 测试配置（P1 波 T1-01 交付；TDD-C-06 §6.1/§6.2 验收命令的宿主）。
//
// 为什么需要本文件（而非复用 vite.config.ts）：
//   vite.config.ts 固定 root=src/renderer（renderer 构建入口）——vitest 若沿用它，测试发现根被
//   收窄到 renderer 子树，main 侧套件（src/main/storage/**，§6.1「node 直跑」）将不可见。
//   vitest.config 优先于 vite.config，故在此把测试根复位到 client 包根。
//
// @constella/shared 解析口径：shared 的 package.json exports 已含 `import`/`default` 条件
// （PM 修订 2026-11-09，指向 TS 源——client 两半段均经编译器消费〔esbuild main / vite renderer / vitest〕，
// server 仅 type-import 编译期擦除）——原测试期 resolve.alias 已移除，走真实包解析。
//
// globals=false：测试一律显式 `import { describe, it, expect, vi } from 'vitest'`，
// 保持 `tsc --noEmit` 对测试文件零配置通过（client tsconfig types 仅 ["node"]）。
//
// P3 扩面（T3-01，2026-11-09 留痕）：include 增 `.tsx`——C-01 组件测试随 P3 波进入；
// 全局 environment 仍为 node，组件测试文件头部以 `// @vitest-environment jsdom`
// docblock 声明局部 DOM 环境（devDep jsdom@31.0.0 随本卡锁入），现有 node 侧套件零影响。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
