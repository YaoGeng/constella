# S-5 · ts 执行链：esbuild 转译 + ELECTRON_RUN_AS_NODE（2026-11-08）

判据（02 §15.3 封版原文）：「@constella/sdk ts 版 run(ctx)｜**import SDK 的脚本执行并回传 {data}**」——**PASS**。

## 判据逐条

| # | 验证点 | 结果 |
|---|---|---|
| 1 | SDK stub + `import {run}` 值导入脚本（s1）回传 `{data:{n:42}}`，exit 0 | PASS |
| 2 | 契约主形态（s2，demo L1032-1040：PARAMS←ctx.params 覆盖 + async/await + ctx.log/sleep）回传 `{data:{score:40}}`，log 行完整 | PASS |
| 3 | 外部相对 import（s3：`./lib/helper.ts` + `./lib/items.json` + `node:crypto`）打包执行正确 | PASS |
| 4 | 错误抛出（s4）：stdout error 终帧 `{type:'error',name,message,stack}` + exit 1，stderr 为空 | PASS |
| 5 | `{branch}` 路由交付 + `ctx.emit` 命令式分支（s5）：emit 行 + `{branch:'done',doubled:14}` | PASS |
| 6 | NodeOut 形状违规（s6）：`code:'OUT_INVALID'` 错误终帧 + exit 1，不静默成功 | PASS |
| 7 | 运行矩阵：**A** 宿主与子进程均 electron-as-node（02 §3.5 忠实链）、**B** 全普通 node、**C** 宿主 node + 子进程 electron | 三矩阵各 6/6 PASS，行为同构 |
| 8 | env 白名单实测：子进程仅 `PATH/SYSTEMROOT/TEMP + CONSTELLA_CTX/RUN_ID + ELECTRON_RUN_AS_NODE`（§12.1）即可跑通 | PASS |

## 锁定版本与转译记录

- electron **45.2.3**（`ELECTRON_RUN_AS_NODE=1` 内嵌 **Node v24.22.2**）；esbuild **0.28.2**；typescript **7.0.2**（仅 typecheck，运行链路不含 tsc）；pnpm 12.11.2 / Windows。
- esbuild 配置：`bundle:true, platform:'node', format:'cjs', target:'node24', sourcemap:'linked'`，入口=生成 entry（`import {boot} from '@constella/sdk/bootstrap'; boot(m.run)`），单场景构建 **9–67ms**、产物 **3.2–3.7KB**（含 SDK+bootstrap）、0 警告；ESM 产物探针（`format:'esm'`+.mjs）在 RUN_AS_NODE 下同样通过（Node 24.22.2）。
- 行为差异：RUN_AS_NODE 与普通 node 同构（协议帧逐字节一致语义）；差异仅 runtime 版本（24.22.2 vs 24.6.0）与 `process.versions.electron` 字段。**漏注 ELECTRON_RUN_AS_NODE 时（P1 探针实测）脚本按 Electron main 语义执行、可产出 result 但进程不退出**，须看门狗强杀兜底。

## 错误通道约定建议（C-M1/SandboxExecutor 与 K-01 直接输入）

1. **stdout JSON 行协议**（对齐 §8.4/§14）：`{type:'log',msg}` ← ctx.log；`{type:'emit',branch,payload}` ← ctx.emit；终帧恰一且为末行——成功 `{type:'result',out,runtime}`（exit 0），失败 `{type:'error',name,message,code,stack}`。
2. **exit code**：0=成功；**1=脚本自身错误**（run 抛出/拒绝、NodeOut 形状违规 OUT_INVALID）；**2=装配错误**（ENTRY_NO_RUN / CTX_MISSING / CTX_INVALID_JSON，重试无意义）；超时强杀按 N6 处理（taskkill /T /F）。stderr 不承载协议（视为基础设施噪声，仍需采集入日志）。
3. ctx 注入：`CONSTELLA_CTX`（JSON）env 传递即可；宿主 spawn 必须显式设 `ELECTRON_RUN_AS_NODE:'1'` 并保留退出看门狗（见 P1）。
4. 建议 C-M1 接 source-map-support（sourcemap:'linked' 已产出 .map，当前堆栈仍指向 bundle 行号）。

## 复现命令

```bash
cd spikes/s5-tsrun
pnpm install && node node_modules/electron/install.js   # electron 45.2.3 包无 postinstall，须手动装二进制（ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
pnpm typecheck
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/run-spike.mjs --child electron  # Run A（判据）
node scripts/run-spike.mjs --child node    # Run B 对照；--child electron 为 Run C
```

## 结论

esbuild 转译（cjs/node24）+ `process.execPath` ELECTRON_RUN_AS_NODE 链路在 Electron 45.2.3（内嵌 Node 24.22.2）上完全稳定，三运行矩阵 6 场景全过、构建毫秒级、最小 env 白名单可行，**可支撑 V1.0 ts 强节点，风险 N4 建议关闭**；错误通道按上述 stdout JSON 行 + exit 0/1/2 约定冻结给 C-M1/K-01。未覆盖项：ctx 能力运行时绑定（browser/llm/net/file/vault，属 C-M1 范围）与超时强杀语义（S-4 范围）。
