// Constella client — Electron main 进程最小壳（T0-08 / TDD-C-M1 §3 AppRuntime 行）。
//
// 本文件只做三件事（最小壳口径，完整生命周期随 P1 波）：
//   1) 注册 app:// 特权标准协议并经 protocol.handle 返回 dist/renderer ESM 产物
//      —— S-1 结论③：file:// 直载 Vite ESM 产物会被 CORS 拦截，须自定义标准协议承载，
//      全程 webSecurity 恒 true（不关闭任何安全策略、无 file:// 直载）；
//   2) 创建主窗，以 app://./index.html 加载 renderer（index.html 内资源为相对路径，
//      在 standard 特权协议下正确解析，base './' 由 vite.config.ts 固定）；
//   3) 退出兜底（window-all-closed → quit）。
//
// AppRuntime 组合根位（C-M1 §3，完整生命周期随 P1 波）：
//   P1 波在此按启动序装配五服务（StorageService.init → SecretVault.init →
//   CdpSessionManager.init → 主窗加载 → CronScheduler.start → SandboxExecutor.sweepOrphans），
//   并接管 24 通道 handler 注册、close 拦截（app:confirmClose）、window-all-closed 覆盖
//   （dock 主窗存活语义，S-3 坑②）、非白名单导航转 openExternal（02 §12.3）等完整生命周期。

import { app, BrowserWindow, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** renderer 构建产物目录（vite build → client/dist/renderer）。 */
const rendererDir = path.join(__dirname, '..', 'renderer');

// app:// 特权协议：standard（页面内相对路径可解析）+ secure（HTTPS 同源语义，CSP 可生效）；
// supportFetchAPI/stream 供 renderer 内 fetch 与流式资源（S-1 spike 中 spike:// 同款特权口径）。
// 必须在 app ready 之前调用（模块顶层执行即满足）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // webSecurity 恒 true：renderer 只经 app:// 协议加载，禁止 file:// 直载（S-1 ③ 安全基线）
      webSecurity: true,
    },
  });
  mainWindow.loadURL('app://./index.html').catch((err: unknown) => {
    console.error('[constella-main] renderer 加载失败:', err);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // app:// → dist/renderer 静态资源；MIME 由 net.fetch(file://) 走 Chromium 扩展名映射保证（S-1 验证口径）
  protocol.handle('app', (request: Request): Promise<Response> => {
    const u = new URL(request.url);
    let rel = decodeURIComponent(u.pathname || '/index.html');
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.normalize(path.join(rendererDir, rel.startsWith('/') ? rel.slice(1) : rel));
    // 目录逃逸防护：解析后必须仍落在 rendererDir 内（win32 大小写不敏感，双侧 lowercase 比对）
    const base = rendererDir.endsWith(path.sep) ? rendererDir : rendererDir + path.sep;
    if (!filePath.toLowerCase().startsWith(base.toLowerCase())) {
      throw new Error(`app:// out-of-scope path rejected: ${rel}`);
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// 最小退出兜底；P1 波由 AppRuntime 接管（window-all-closed 覆盖语义，S-3 坑②）
app.on('window-all-closed', () => {
  app.quit();
});
