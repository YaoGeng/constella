// Constella client — Electron main 进程入口（T0-08 最小壳 → T4-13 收口为 AppRuntime 完整装配）。
//
// 职责＝组合根装配（TDD-C-M1 §2「main 内部：AppRuntime=组合根」）：唯一 electron import 面，
// 其余生命周期/窗口/协议/域通道全部委托 AppRuntime（runtime/app-runtime.ts）：
//   - app:// 特权协议注册＋protocol.handle 静态产物服务（S-1 ③：file:// 直载 Vite ESM 产物被
//     CORS 拦截，须自定义标准协议承载；全程 webSecurity 恒 true）；
//   - 主窗创建/加载、close 拦截→app:confirmClose、window-all-closed 覆盖（S-3 坑②兜底）、
//     非白名单导航转 openExternal、查看窗原语（T4-18 消费）；
//   - AppRuntime 域四组通道（app:version/env:systemInfo/dialog:*/shell:*）；
//   - 启动/退出双序骨架（§3 生命周期段全序）。五服务（SecretVault/SandboxExecutor/
//     CdpSessionManager/CronScheduler/StorageService）构造注入位已立（T4-15~T4-20 逐卡接入，
//     本装配暂缺省跳过）；ExamplePreloader 挂载步缺省空实现收口为装配点（C-08 本体随 P5 波）。
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import path from 'node:path';
import { AppRuntime } from './runtime/app-runtime';
import type { DialogLike, ElectronApi } from './runtime/electron-api';

// electron 真实 Dialog → AppRuntime 可注入面适配：owner 窗缺省时走无窗重载
// （运行时窗口对象即真实 BrowserWindow，边界处窄 cast 安全——AppRuntime 只消费 Like 子集）。
const dialogAdapter: DialogLike = {
  showMessageBox: (win, options) =>
    win !== undefined
      ? dialog.showMessageBox(win as never, options as never)
      : dialog.showMessageBox(options as never),
  showOpenDialog: (win, options) =>
    win !== undefined
      ? dialog.showOpenDialog(win as never, options as never)
      : dialog.showOpenDialog(options as never),
  showSaveDialog: (win, options) =>
    win !== undefined
      ? dialog.showSaveDialog(win as never, options as never)
      : dialog.showSaveDialog(options as never),
};

const electronApi: ElectronApi = {
  app,
  BrowserWindow,
  protocol,
  net,
  dialog: dialogAdapter,
  shell,
  ipcMain,
};

const runtime = new AppRuntime({
  electron: electronApi,
  rendererDir: path.join(__dirname, '..', 'renderer'),
  preloadPath: path.join(__dirname, '..', 'preload', 'index.js'),
});

void runtime.startup().catch((err: unknown) => {
  console.error('[constella-main] AppRuntime 启动失败:', err);
  app.quit();
});
