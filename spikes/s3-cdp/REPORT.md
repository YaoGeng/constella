# S-3 Spike 报告：BrowserWindow partition + webContents.debugger（2026-11-08）

环境：Windows 11 x64 / Git Bash / pnpm 12.11.2；Electron 45.2.3（Chromium 156.0.8078.80 / Node 24.22.2，与 S-1 同锁）。工程 `spikes/s3-cdp/`（独立工程、本地 pnpm-lock.yaml，根 pnpm-lock.yaml 未动）。窗口全部隐藏（show:false，contextIsolation:true / nodeIntegration:false / sandbox:true / backgroundThrottling:false，disableHardwareAcceleration），CDP 全程走 webContents.debugger，无外部 Chrome。原始数据：`results/test.json`（19/19 PASS）、`results/verify.json`（4/4 PASS）、`results/main-*.log`。

## 判据（02 §15.3：「双 partition cookie 隔离；extract 可用」）逐条结论

**判据 1「双 partition cookie 隔离」— PASS**：`persist:s3-a` / `persist:s3-b` 两个隐藏窗口经 CDP `Network.setCookie` 各写同名 cookie（s3probe=a-value / b-value）：`Network.getCookies` 各只见己值；页面侧 `document.cookie` 各含己值、互不可见；`session.cookies` API 交叉验证同样隔离；窗口 destroy 后同 partition 重建仍读到己值；进程退出后新进程（`--phase=verify`）经 session API 与 CDP 均仍读到（真实落盘）。磁盘 `userData/Partitions/` 生成 `s3-a`、`s3-b` 目录。附加验证：C-04 形态 partition 名 `persist:f-001·lane-主`（含 `·` 与中文）可用，磁盘目录名 URL 编码为 `f-001%C2%B7lane-%E4%B8%BB`。

**判据 2「CDP attach」— PASS**：`attach('1.3')` 成功，`Page.enable` / `Runtime.enable` 正常 resolve。过程记录：attach 仅接受 1.2 / 1.3，0.1 / 1.4 / 2.0 报 "Requested protocol version is not supported"；二次 attach 报 "Debugger is already attached to the target"，detach 后可重新 attach；`Browser.getVersion` 经 webContents.debugger 可用 → protocolVersion "1.3"、product Chrome/156.0.8078.80。

**判据 3「导航/点击/提取」— PASS**：内置 node http server 最小页（按钮 + 状态文本，点击后 DOM 变化）。`Page.navigate` 返回 frameId 且等到 loadEventFired；隐藏窗口内 `Input.dispatchMouseEvent`（mousePressed+mouseReleased 于 getBoundingClientRect 中心）两击生效：before-click → after-click-1 → after-click-2；提取用 `Runtime.evaluate`（returnByValue）断言点击前后文本，备选路径 `DOM.getDocument`+`querySelector`+`getOuterHTML` 同样可用（取到 `<span id="status">after-click-2</span>`）。

## 锁定版本

electron 45.2.3（Chromium 156.0.8078.80 / Node 24.22.2）｜pnpm 12.11.2｜零其他运行时依赖（测试页为内置 node:http 服务）

## 复现命令（从零）

```bash
cd spikes/s3-cdp
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
cd node_modules/electron && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js && cd ../..  # electron@45 npm 包无 postinstall script，二进制须手动拉取
pnpm run spike   # = --phase=test（19 checks → results/test.json + state.json）&& --phase=verify（新进程 4 checks → results/verify.json）；退出码 0=全过
```

## 结论

**组合可支撑 C-04 卡设计**：partition=`persist:<flowId>·<laneLabel>` 的 lane 隔离（cookie 双向互不可见 + 落盘跨进程仍在）与 webContents.debugger 的导航/点击/提取三操作全部验证通过，隐藏窗口即可承载 lane 自动化。发现与规避：1) 向从未加载内容的窗口直接发 CDP 命令不可靠（"target closed while handling command"，个别时序下挂起）——attach 后必须先导航，cdp.open 天然满足；2) **destroy 掉全部窗口触发默认 window-all-closed→app.quit，此后任何新窗口导航一律 ERR_FAILED(-2)**，极易误诊为 partition/CDP 问题——destroyRun 收尾销毁 lane 窗口时须保证 dock 主窗口存活，或显式覆盖 window-all-closed；3) `Network.setCookie` 不带 expires 生成会话 cookie、不落盘，跨进程即失，须显式 expires 才持久；4) `Page.loadEventFired` 仅在 `Page.enable` 后派发，导航等待需先 enable Page 并辅以 readyState 轮询兜底；5) 工程链变化：pnpm 12 已移除 onlyBuiltDependencies（改用 pnpm-workspace.yaml 的 allowBuilds 映射），且 Electron 45 npm 包不再携带 postinstall script（registry 元数据 scripts 为空），二进制须手动 `node install.js` 拉取——S-1 的复现命令在 pnpm 12 下同样需追加此步。
