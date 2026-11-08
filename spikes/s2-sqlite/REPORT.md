# S-2 Spike 报告：better-sqlite3 × Electron 45 main + node:sqlite 对照组（2026-11-08）

环境：Windows 11 x64 / Git Bash，node v24.6.0（仅用于装包），pnpm 12.11.2。测试口径：`ELECTRON_RUN_AS_NODE=1 <electron.exe> suite.cjs`（Electron 45.2.3 内嵌 Node 24.22.2、modules ABI 150、napi 10；该模式 `process.versions.electron` 仍为 45.2.3）；另以真 main 进程（processType=browser、无窗口）冒烟复核两组加载+CRUD+回滚，均通过。原始数据：`results/suite-*.json`、`results/main-smoke.json`。

## 判据（02-TDD §15.3：「CRUD + 事务 + 5MB 档读写通过；锁版本」）逐条结论

**better-sqlite3 组（13.0.3，12/12 PASS，两轮复跑）**
| 判据 | 结论 |
|---|---|
| ① 安装路径 | **prebuild 直接可用**：npm 包内自带 `prebuilds/win32-x64.node` 等 8 平台 N-API 单文件（包体 11.4MB），**无 install 脚本、无 prebuild-install 下载、无需 electron-rebuild/VS Build Tools、全程零编译**；ABI 150 下 require 即用。electron 二进制 23s 懒下载（45.x npm 包已无 postinstall，`node install.js`，走 npmmirror） |
| ② CRUD | PASS：insert/select（含 NULL、空 BLOB、4KB 内 BLOB 往返）/update/delete，`run()` 返回 `{changes,lastInsertRowid}`，同语句对象复用 50 次正常 |
| ③ 显式事务 | PASS：BEGIN+2 插入+COMMIT 落库；**失败回滚**：事务内先插合法行再撞 UNIQUE 主键→抛错→ROLLBACK→连同先前的合法行一并消失。附加：`db.transaction()` API 包裹抛错自动回滚亦通过 |
| ④ WAL | PASS：`journal_mode=WAL` 生效、close/reopen 后仍为 wal（写入文件头持久化）、可切回 delete；WAL 写入出现 -wal sidecar |
| ⑤ 5MB 档 | PASS：1024 行 × 5120B = 5MiB 确定性 BLOB 单事务写入+全量读回逐行 sha256 校验+integrity_check=ok。WAL 写 82–89ms（56–61 MB/s）、读+校验 26ms（~190 MB/s）；DELETE 模式写 53–57ms（补充项） |

**node:sqlite 对照组（内置，同判据 ②~⑤，12/12 PASS，两轮复跑）**
| 判据 | 结论 |
|---|---|
| ② CRUD | PASS：语义与返回形状同 better-sqlite3（`{changes,lastInsertRowid}`）；差异：BLOB 返回 `Uint8Array` 而非 `Buffer`（空 BLOB 返回空 Uint8Array） |
| ③ 事务 | PASS：同款失败回滚用例通过；差异：**无事务包装 API**，需手写 BEGIN/COMMIT/ROLLBACK（本组即如此跑） |
| ④ WAL | PASS：开关、重开持久化同 better-sqlite3，-wal sidecar 同为 5.6MB |
| ⑤ 5MB 档 | PASS：WAL 写 77–79ms（63–65 MB/s）、读+校验 30ms（162–170 MB/s）；与 better-sqlite3 **同量级**，差异在两轮波动范围内。Node 24.22.2 下加载**已无实验性警告** |

## 锁定版本

electron 45.2.3（Chromium 156.0.8078.80 / Node 24.22.2 / ABI 150 / napi 10）｜better-sqlite3 **13.0.3**（N-API，内嵌 sqlite **3.53.4**）｜node:sqlite = Electron 内嵌 Node 24.22.2 自带内置模块（`process.versions.sqlite` **3.53.4**，导出 DatabaseSync/StatementSync/Session/backup/constants；API 口径=Node 24 版 node:sqlite）——两组底层 SQLite 引擎同版 3.53.4，性能对照公平。

## 安装路径结论

**prebuild 可用（免 rebuild）**。better-sqlite3 13.x 分发方式已变：prebuild 随 npm tarball 内置（按 platform-arch 选文件、N-API 跨 ABI），不依赖 GitHub releases 下载，也不存在「Node ABI ≠ Electron ABI 需重编」问题。pnpm install 共 4.6s。附注（工具链实况）：pnpm 12 不再读 package.json 的 `pnpm` 字段（onlyBuiltDependencies 需写 pnpm-workspace.yaml 顶层键）；electron 45.x 无 postinstall、二进制懒下载。electron-rebuild/VS Build Tools 路径未触发也无需触发。

## 复现命令（从零）

```bash
cd spikes/s2-sqlite
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install        # 4.6s，含 better-sqlite3 11.4MB 包
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js  # 23s，electron 二进制
pnpm test    # = test:bs3 + test:node-sqlite + smoke:main（双组全判据 + 真 main 冒烟，结果落 results/）
```

## 结论

**V1.0 客户端存储锁定 better-sqlite3 13.0.3 + Electron 45.2.3**：判据全过且裕量大（5MiB 单事务写 ~60 MB/s、读回校验 ~190 MB/s），`db.transaction()` 的抛错自动回滚正好覆盖「保存=落盘+打版本」的原子性需求，BLOB/Buffer 直达；风险 N2（prebuild 可用性）**解除**。node:sqlite 对照组同判据全过、性能同量级、零原生依赖零构建、Node 24 下已无实验警告——**可直接顶上**的成熟备选，若未来 better-sqlite3 出现分发/打包问题可无缝切换（代价：自管事务包装、BLOB 走 Uint8Array）。两组底层同为 sqlite 3.53.4，schema 与数据文件互通。
