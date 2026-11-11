# P6 收口 · E 验收扫尾清单（2026-11-12，PM 执行归档）

> T6-16 卡文①「E 验收扫尾」执行留痕。全部命令于 batch-6 合并终审 PASSED＋4 MINOR PM 补修之后、tag p6-done 之前执行。

## 三端全量

| 命令 | 结果 |
|---|---|
| `pnpm -r --if-present typecheck` | 5 包（shared/admin/server/client/sdk）全 Done，exit=0 |
| `pnpm -r --if-present build` | 全 Done；admin 最大 chunk 951.10kB（vendor-antd，<1MB 判据维持） |
| `pnpm -r --if-present test` | sdk ts 27/27＋server 12 文件（93 passed/5 skipped，dist 排除后收集） |
| `pnpm -F ./sdk run test:py` | 12/12 全部通过 |
| `pnpm -F ./sdk run test:iso` | isomorphism ok |
| `pnpm -F ./client exec vitest run --no-file-parallelism` | **159 文件/1524 例全绿，exit=0**（串行终态判据） |

## 脚本族

| 命令 | 结果 |
|---|---|
| `node scripts/canvas-e2e.mjs` | 22 场景全绿 |
| `node scripts/admin-smoke.mjs <base>`（无参=六登录场景） | 六场景全绿 |
| `node scripts/admin-smoke.mjs <base> users / reviews / package / dashboard` | a~g / a~e / a~g / a~d 全绿 |
| check-versions / check-settings-keys / check-ipc-surface / check-builtin-seed / check-shared-consts / check-shared-exports / check-storage-ops / check-sdk-deps / check-server-error-codes / check-review-transitions | 10/10 ok |

## 遗留复跑项收口（卡文①枚举）

- P3 T3-04 §6.2f 运行态门 / T4-05 §6.2 集成段（T4-18 补跑）＝随全量串行绿覆盖 ✓
- T6-09 §6.2~§6.3 联跑＝契约 spec（含 PM 补 M-1 真再导入/M-3 干净目录 config·manifest·nodes 复验）✓
- C-10 §6.3 集成冒烟＝assembly/run-taskcenter-smoke.spec（双流程心跳独立＋终止<200ms 虚拟时钟）✓
- T6-11 lane 内存告警 mock 解除复跑＝通道已端到端可达，真形定向两支 ✓（T6-16 A1）
- T6-13 像素阈值＝golden hash 基线制（sky 套件随全量绿）✓

## 环境依赖登记

- server 套件依赖 dev-pg SSH 隧道（127.0.0.1:15432 → 43.160.219.44 隔离容器 constella-dev-pg，密钥 BatchMode）；隧道为会话级无仓库内守护，断连表现为 13 failed/69 skipped（Can't reach database server）——重建命令：`ssh -N -L 15432:127.0.0.1:15432 deploy@43.160.219.44`。
- client 并行全量下 sandbox-chain 真宿主 ws 用例偶发抖动＝既有登记（单文件/串行全绿）；本清单串行跑零漂移。
