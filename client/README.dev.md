# @constella/client 开发说明（T0-08 工程初始化基线）

Electron 桌面客户端 workspace（`docs/03-模块设计.md` TDD-C-M1）。三目录：`src/main`（主进程壳 + AppRuntime 组合根位）、`src/preload`（contextBridge 占位）、`src/renderer`（最小占位，P3 波 C-01 替换为 CanvasModule）。

## 安装口径（重要）

本包依赖在仓库根统一安装（pnpm workspace）：

```bash
pnpm install                                    # 根目录执行
node node_modules/electron/install.js           # 必须手动执行：electron npm 包无 postinstall、二进制懒下载
pnpm -F ./client exec electron --version        # 验收：输出 v45.2.3
```

- **为什么需要第二步**：electron 的 npm 包不含平台二进制，安装脚本 `install.js` 才去下载 Electron 运行时；pnpm 12 默认拦截依赖构建脚本，因此不能指望 install 时自动完成（本包也未设 postinstall，避免统一安装期隐式拉网络）。
- 便捷入口：`pnpm -F ./client run install:electron`（等价于上面第二条）。
- **国内网络**：先设镜像再执行安装脚本：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node node_modules/electron/install.js
```

- CI/工程化侧同口径（T0-10）：install 后显式跑 `install.js`（或设 `ELECTRON_MIRROR`）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm -F ./client run dev` | 构建三端产物后冷启动 Electron（`esbuild.mjs` → `vite build` → `electron .`）。热更新 dev server 接线随 P3 波（renderer 依赖到位后） |
| `pnpm -F ./client run build` | 全量构建：main/preload → `dist/main`、`dist/preload`（esbuild，CJS）；renderer → `dist/renderer`（vite，ESM） |
| `pnpm -F ./client run typecheck` | `tsc --noEmit`（tsconfig 继承仓库根 `tsconfig.base.json`，include 收窄仅本包） |
| `pnpm -F ./client run start` | 直接启动已构建产物（`electron .`，main = `dist/main/index.js`） |
| `pnpm -F ./client run notices` | 重新生成 `THIRD-PARTY-NOTICES.md`（依赖增补后必须重跑，S-9） |
| `node scripts/check-versions.mjs` | 仓库根执行；版本锁断言（electron 45.2.3 / esbuild 0.28.2 / TS 5.9.3） |

## 版本锁（S-1 / S-5 口径）

| 依赖 | 锁定版本 | 来源 |
|---|---|---|
| electron | 45.2.3 | S-1 锁（Chromium 156 / Node 24.22.2） |
| esbuild | 0.28.2 | S-5 锁（C-M1 §3 TsExecutor 唯一转译器） |
| typescript | 5.9.3 | S-1 口径（与 admin 7.0.2 双口径 ⚠ 已登记 05 卡，统一随决策卡） |
| vite | 8.3.6 | TDD-C-M1 §3 未锁 client 侧 vite；取 npm 当前稳定版，恰与 S-1 spike 锁及 admin S-8 锁一致（monorepo 单版去重）。⚠ 待 P3 波 C-01 复核 |
| @types/node | 24.19.2 | electron.d.ts 顶部 `/// <reference types="node" />` 所需；24.x 匹配 Electron 45 内置 Node 24 |

断言脚本：`scripts/check-versions.mjs`（仓库根，T0-08 交付）；P3 波 T3-01 增补 renderer 断言面。

## 构建与加载链路

- renderer 由 **vite** 构建（`base: './'` 相对产物），main 进程经 **`app://` 特权标准协议 + `protocol.handle`** 返回 `dist/renderer` 静态资源（S-1 结论③：file:// 直载 ESM 产物被 CORS 拦截；全程 `webSecurity` 恒 true，无 file:// 直载）。
- main/preload 由 **esbuild** 打包为 CJS（沙箱 preload 只能 CJS；`packages: 'external'` 只打本地源码）。

## 约束注记

- **renderer 框架依赖（react / @xyflow/react / zustand / zundo）本波不装**，随 P3 波 C-01 首卡引入（届时 vite.config.ts 增补插件、check-versions 增补断言）。
- `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 顶层键（T0-08 要点④，electron/esbuild/better-sqlite3 白名单）不在本卡修改范围内，由 PM 统一落位（better-sqlite3 13.0.3 随 P1 波 install）。
- 分发义务（S-9）：Electron 安装包须随附 `THIRD-PARTY-NOTICES.md`；依赖增补后重跑 `pnpm -F ./client run notices`。
