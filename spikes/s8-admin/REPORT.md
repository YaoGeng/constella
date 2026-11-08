# S-8 Spike 报告：admin 端 antd 6 + Vite + React 19 空壳

- 日期：2026-11-08 · 工程：`spikes/s8-admin/`（独立 Vite 工程，pnpm）· node v24.6.0 / pnpm 12.11.2
- 判据原文（docs/02-TDD-技术设计文档.md §15.3 L886）：**「S-8 | admin：antd 6 + Vite + React 19 | 表格/表单/路由 | 空壳看板页跑通」**

## 判据核对

| 验证点 | 结果 | 证据 |
|---|---|---|
| 表格 | PASS | Table 20 行假数据、pageSize=10：无头 Edge（系统 Edge，playwright-core）实测第 1/2 页各 10 行，dev 与生产构建均过 |
| 表单 | PASS | 登录表单与公告表单四类规则（required / min 长度 / email 格式 / 自定义 validator 1-100）全部按预期出错误文案（如「邮箱格式不正确」「配额必须在 1-100 之间」）；合法提交后 antd message 成功提示展示 |
| 路由 | PASS | `/login` ↔ `/` 双向跳转（Form 提交 navigate、按钮 useNavigate）、`*` → `/` 重定向；curl `/` 与 `/login` 均 200（SPA fallback 正常） |
| 空壳看板页跑通 | PASS | `pnpm build` exit 0（`tsc --noEmit` 类型检查 + vite build，3102 模块，dist/index.html + JS 产物）；dev(5173)/preview(4173) curl 200；无头 Edge 全流程（渲染→校验→翻页→跳转→提交）通过 |

## 锁定版本

react 19.3.1 / react-dom 19.3.1 / **antd 6.7.0**（= TDD §2.1 参考版本 6.7.0）/ react-router 7.18.5 / vite 8.3.6（rolldown 内核）/ @vitejs/plugin-react 6.2.1 / typescript 7.0.2 / @ant-design/icons 6.3.4

## 复现命令

```bash
cd spikes/s8-admin
pnpm install --ignore-workspace   # spike 内独立 pnpm-lock.yaml
pnpm build                        # tsc --noEmit -p tsconfig.json && vite build
pnpm dev                          # http://127.0.0.1:5173（/ 与 /login）
pnpm preview                      # 生产构建 http://127.0.0.1:4173
node scripts/browser-check.mjs http://127.0.0.1:5173   # 无头 Edge 自动验收（需系统 Edge）
```

## React 19 × antd 6 告警记录（dev StrictMode 与生产构建均实测）

- 唯一 antd 告警：`Warning: [antd: Statistic] valueStyle is deprecated. Please use styles.content instead.`——改用 `styles={{ content: ... }}` 后复测消失。
- 无 React 19 兼容性告警（无 findDOMNode / legacy context / act 等告警），无 pageerror，无渲染异常。
- 非问题项：/favicon.ico 404（未提供图标）；React DevTools 安装提示（info）；Chromium 密码框 autocomplete 建议（verbose）。
- vite 提示单 chunk 1.08MB（gzip 345KB）：antd 全量引入所致，spike 不做拆包，正式工程建议按需引入/代码分割。

## 已知事项（pnpm workspace 侵入）

`spikes/*` 被根 pnpm-workspace.yaml 收录，spike 内 `pnpm install/run` 会把 importer 追加进根 `pnpm-lock.yaml`（`--ignore-workspace` 与 `.npmrc ignore-workspace=true` 均无法完全阻止 pnpm 12 run 前置校验的写入）。本次 S-1/S-6/S-7/S-8 多 spike 并行，根锁为共享写热点，未能恢复原状；建议入库前由维护者统一裁定（正式 `admin/` 包在 workspace 内属正常机制；如需隔离 spike，可将 `spikes/*` 移出 packages 列表）。

## 结论

antd 6.7.0 + React 19.3.1 + Vite 8.3.6 + react-router 7.18.5 + TypeScript 7.0.2 组合在 S-8 全部判据（表格/表单/路由/空壳看板跑通）实测通过，React 19 下 antd 6 无兼容性告警或异常（唯一弃用告警已按 v6 API 修正），**该组合可冻结进 V1.0**，与 TDD §2.1 冻结约束（React 19+ / antd 6+ / Vite，antd 6.7.0）一致。
