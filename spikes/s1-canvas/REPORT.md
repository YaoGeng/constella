# S-1 Spike 报告：Electron 45 + React 19 + @xyflow/react v12（2026-11-08）

环境：Windows 11 x64（144Hz 显示器，GPU 硬件加速开启），Electron 45.2.3（Chromium 156.0.8078.80 / Node 24.22.2）。
工程：`spikes/s1-canvas/`（独立 mini-project），contextIsolation=true / nodeIntegration=false / sandbox=true，preload 用 contextBridge。
原始数据：`results/bench-2026-11-08T08-39-16.json`、`results/undo-2026-11-08T08-39-57.json`（由 `--spike-scenario` 自动化跑出）。

## 判据（02-TDD §15.3 原文）逐条结论

**判据 1：「200 节点/500 边拖拽 ≥30fps」— PASS**
图规模实测 200 节点/500 边（全部为自定义 node 类型 + 自定义 edge 类型，MiniMap 常开，snapToGrid 16px 常开）。脚本化真实拖拽（合成 MouseEvent 驱动 d3-drag 完整链路，Lissajous 轨迹 8s，已验证节点实际位移、每秒 fps 序列）：

| 场景（8s） | avg fps | 每秒 fps 序列 | 最差秒 | 最差单帧 | p95 帧时 | >50ms 帧 |
|---|---|---|---|---|---|---|
| idle 4s | 144 | 144,144,144,144 | 143.9 | 7.3ms | 7.2ms | 0 |
| 拖枢纽节点 n0（度 65，小幅） | 107.2 | 129,108,78.5,122,98,95,123,104 | 78.5 | 34.7ms | 20.8ms | 0 |
| 拖枢纽节点 n0（大幅+auto-pan） | 68.1 | 82,56,52,92,54,65,90,53 | 52.0 | 34.8ms | 21.0ms | 0 |
| 拖叶子节点 n47（度 4，大幅+auto-pan） | 61.8 | 73,62,52,55,58,64,69,63 | 51.9 | 27.9ms | 20.9ms | 0 |

三个拖拽场景 avg 与最差秒均 ≥51.9fps，远超 30fps 判据。拖拽有效性证据：rfDrag 事件 285/910/1834 次、节点位移 853/6503/16637px、终点坐标均为 16 的倍数（snapToGrid 生效）。

**判据 2：「undo/redo 正确」— PASS（含「Zundo 60 步」）**
在 200 节点/500 边基线上执行 100 个离散操作（40 加节点/30 移动/30 连边），zundo 历史深度 101（limit 200，≥60）。逐一 undo 100 次并逐步与确定性快照比对：100/100 一致，最终回到基线；逐一 redo 100 次：100/100 一致，回到终态。

**验证内容清单**：自定义节点（Handle+标签）、自定义边（贝塞尔+选中态）、MiniMap（pannable/zoomable）、snapToGrid（16px）全部实装且被 200/500 场景实际使用；shadcn 按 Tailwind v4 流程 `init -y -d -b radix` + `add button` 成功（registry 可达，生成 `src/components/ui/button.tsx`，toolbar 按钮即该组件）。typecheck（tsc 5.9.3）与 vite build 均零错误。

## 锁定版本

electron 45.2.3（Chromium 156.0.8078.80）｜react / react-dom 19.3.1｜@xyflow/react 12.12.1（@xyflow/system 0.0.84，d3-drag 3.0.1）｜tailwindcss 4.3.5 + @tailwindcss/vite 4.3.5｜shadcn CLI 4.23.0（radix-nova / neutral，附带 radix-ui 1.8.1、cn 0.5.2、cva 0.7.1、lucide-react 1.70.0、tw-animate-css 1.4.0）｜zustand 5.1.0｜zundo 2.3.0｜vite 8.3.6 + @vitejs/plugin-react 6.2.1 + typescript 5.9.3

## 复现命令（从零）

```bash
cd spikes/s1-canvas
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
pnpm exec shadcn init -y -d -b radix && pnpm exec shadcn add button -y -o   # 已执行；重置时使用
pnpm typecheck && pnpm build
pnpm run scenario:undo   # undo/redo 正确性 -> results/undo-*.json 后自动退出
pnpm run scenario:bench  # idle+3 种拖拽 fps -> results/bench-*.json 后自动退出
pnpm start               # 交互模式：按钮生成 200/500、手动拖拽、undo/redo、MiniMap
```
fps 测量口径：renderer 内 rAF 帧间隔采样，与脚本化拖拽并发执行；输出每秒 fps 序列/均值/最差秒/最差单帧/p95。

## 结论

**组合可冻结进 V1.0**：判据全过且裕量大（拖拽最差秒 51.9fps vs 判据 30fps），undo/redo 在真实规模下逐步校验完全正确。发现的问题与规避：1) @xyflow/react v12 底层 d3-drag 3.0.1 只监听 mousedown/mousemove/mouseup，E2E 自动化派发 PointerEvent 无效，须派发带 `view:window` 的 MouseEvent（Playwright 真实输入不受影响）；2) file:// 加载 Vite ESM 产物会被 CORS 拦截，需 `protocol.handle` 注册自定义标准协议（本 spike 用 spike://），无需关闭 webSecurity，产品化沿用；3) zundo 集成必须用 partialize 剥离 measured/selected 等易变字段并自定义 equality，否则 React Flow 的尺寸测量 set 会污染历史栈并清空 redo；4) 本 spike 位于根 pnpm workspace（pnpm-workspace.yaml 已含 spikes/*），install 会在根 pnpm-lock.yaml 增加 importer 记录（根 package.json 未改动）。
