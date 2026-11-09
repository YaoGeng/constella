// AppRuntime——main 进程组合根（T4-13 / TDD-C-M1 §2「main 内部：AppRuntime=组合根」＋§3 AppRuntime 行）。
//
// 职责（§3 组件行）：主窗创建（electron 45.2.3，S-1 锁）、protocol.handle 自定义协议注册
// （S-1 ③——T0-08 最小壳收口为完整注册）、close 拦截→app:confirmClose（m→r 问 renderer dirty→
// 原生 dialog.showMessageBox 确认）、window-all-closed 覆盖（S-3 坑②兜底——查看窗全关不退 app）、
// 非白名单导航转 openExternal（02 §12.3）、AppRuntime 域通道四组 handler、启动/退出双序编排
// （§3 生命周期段全序；五服务构造注入位=T4-15~T4-20 逐卡接入，只立注入位不预实装）＋
// ExamplePreloader 挂载步接线（StorageService.init 内 C-08 域注入回调装配位=迁移完成后、
// 种子流程写入前——M4 裁决 2/#11；缺省空实现收口为装配点，C-08 本体随 P5 波）。
//
// 装配：main/index.ts（真实 electron）；测试注入 mock electron 面（electron-api.ts 契约）。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS, type ConfirmCloseRes } from '@constella/shared/ipc';
import type {
  BrowserWindowLike,
  ElectronApi,
  WebContentsLike,
} from './electron-api';
import type { MainServiceSlots } from './service-slots';
import { ViewerWindowManager } from './viewer-windows';
import {
  createIpcMainInvokeRegistry,
  parseConfirmCloseReply,
  registerAppRuntimeChannels,
  type InvokeRegistry,
} from './domain-channels';

/** app:// 特权协议 scheme（S-1 ③：renderer ESM 产物加载——file:// 直载被 CORS 拦） */
const APP_SCHEME = 'app';
/** confirmClose renderer 无应答兜底超时（缺省 2s——超时按 dirty 安全侧处理） */
const DEFAULT_CONFIRM_CLOSE_TIMEOUT_MS = 2000;

/** ExamplePreloader 挂载步缺省空实现（T1-03 缺省收口为装配点；C-08 本体随 P5 波接线） */
function noopPreloadExamples(): void {
  /* 装配点：C-08 ExamplePreloader（P5）注入后替换 */
}

/** AppRuntime 构造依赖 */
export interface AppRuntimeDeps {
  /** electron 表面（生产=真实 electron〔index.ts 装配〕；测试=mock） */
  electron: ElectronApi;
  /** renderer 构建产物目录（app:// 协议服务根；vite build → dist/renderer） */
  rendererDir: string;
  /** preload 产物路径（主窗 webPreferences.preload） */
  preloadPath: string;
  /** 五服务构造注入位（T4-15~T4-20 逐卡接入；缺省=该服务启动/退出步跳过） */
  services?: MainServiceSlots;
  /** ExamplePreloader 挂载步（C-08 域注入回调；缺省空实现收口为装配点） */
  preloadExamples?: () => void | Promise<void>;
  /** confirmClose renderer 无应答兜底超时 ms（缺省 2000） */
  confirmCloseTimeoutMs?: number;
  /** r→m invoke 注册面（缺省=ipcMain.handle 半段；T4-14 IpcGateway.register 接管位） */
  invokeRegistry?: InvokeRegistry;
}

export class AppRuntime {
  /** 查看窗原语（openViewer/置顶/✕ 只关窗——T4-18 消费面） */
  readonly viewers: ViewerWindowManager;

  private mainWindow: BrowserWindowLike | null = null;
  private startupDone = false;
  private shutdownDone = false;
  /** 主窗确认关闭/退出序进行中（close 事件直通，不再拦截） */
  private tearingDown = false;

  constructor(private readonly deps: AppRuntimeDeps) {
    this.viewers = new ViewerWindowManager(deps.electron.BrowserWindow);
  }

  /** 启动序（§3 生命周期段全序）：registerSchemes → whenReady → protocol.handle → storage.init → vault.init → cdp.init → 主窗加载 → cron.start → sweepOrphans */
  async startup(): Promise<void> {
    if (this.startupDone) throw new Error('AppRuntime.startup 已调用（单次语义）');
    this.startupDone = true;
    const { app, protocol } = this.deps.electron;

    // 1) app:// 特权协议声明（必须在 app ready 之前——S-1 ③；standard+secure+fetch+stream）
    protocol.registerSchemesAsPrivileged([
      {
        scheme: APP_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
      },
    ]);
    this.wireAppEvents();
    // 2) ready
    await app.whenReady();
    // 3) protocol.handle 完整注册（T0-08 最小壳收口；目录逃逸防护见 serveRendererAsset）
    protocol.handle(APP_SCHEME, (request: Request): Promise<Response> => {
      return this.serveRendererAsset(request.url);
    });
    // 3a) AppRuntime 域四组通道（ipcMain.handle 半段；T4-14 IpcGateway.register 接管位）
    registerAppRuntimeChannels(
      {
        app,
        dialog: this.deps.electron.dialog,
        shell: this.deps.electron.shell,
        ownerWindow: () => this.mainWindow ?? undefined,
        laneMemory: () => this.deps.services?.cdp?.laneMemory?.() ?? [],
      },
      this.deps.invokeRegistry ?? createIpcMainInvokeRegistry(this.deps.electron.ipcMain),
    );
    // 4) StorageService.init（C-06 open 装配序；preloadExamples=迁移完成后、种子流程写入前的
    //    ExamplePreloader 挂载步——恒传回调（缺省空实现），永不 undefined）
    await this.deps.services?.storage?.init({
      preloadExamples: this.deps.preloadExamples ?? noopPreloadExamples,
    });
    // 5) SecretVault.init（T4-15：safeStorage 可用性探测）
    await this.deps.services?.vault?.init();
    // 6) CdpSessionManager.init（T4-18：PortPool 预热）
    await this.deps.services?.cdp?.init();
    // 7) 主窗加载 renderer
    this.createMainWindow();
    // 8) CronScheduler.start（T4-19：读 flows/nodes 提取 trigger.cron＋missed 检测）
    await this.deps.services?.cron?.start();
    // 9) SandboxExecutor.sweepOrphans（T4-16/17：runId 标记＋启动清扫）
    await this.deps.services?.sandbox?.sweepOrphans();
  }

  /** 退出序（§3 生命周期段）：CronScheduler.stop → SandboxExecutor.dispose → Cdp 销毁全部 lane 窗 → StorageService.close；幂等 */
  async shutdown(): Promise<void> {
    if (this.shutdownDone) return;
    this.shutdownDone = true;
    this.tearingDown = true;
    await this.deps.services?.cron?.stop(); // 刷 lastAliveAt
    await this.deps.services?.sandbox?.dispose(); // 在跑树 killTree＋复查
    await this.deps.services?.cdp?.destroyAllLaneWindows(); // 此阶段才允许窗口全空（S-3 坑②）
    this.deps.services?.storage?.close(); // WAL checkpoint
  }

  // ————————————————————————————————————————————
  // 主窗（创建/加载/close 拦截）
  // ————————————————————————————————————————————

  private createMainWindow(): void {
    if (this.mainWindow !== null && !this.mainWindow.isDestroyed()) return;
    const win = new this.deps.electron.BrowserWindow({
      width: 1600,
      height: 1000,
      webPreferences: {
        preload: this.deps.preloadPath,
        // 安全基线恒定（02 §3.1）：renderer 只经 app:// 协议加载，禁 file:// 直载（S-1 ③）
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.mainWindow = win;
    // close 拦截 → app:confirmClose（dirty 两分支：确认丢弃/不 dirty 直关）
    win.on('close', (event) => {
      if (this.tearingDown || this.shutdownDone) return; // 退出序中的关窗直通
      event.preventDefault();
      void this.handleCloseRequest(win);
    });
    win.on('closed', () => {
      if (this.mainWindow === win) this.mainWindow = null;
    });
    this.wireNavigationGuard(win.webContents);
    // 主窗经 app:// 协议加载 renderer（index.html 资源相对路径在 standard 特权协议下正确解析，
    // base './' 由 vite 固定；无 file:// 直载——T3-01 security-baseline 断言守恒字面量）
    void win.loadURL('app://./index.html').catch((err: unknown) => {
      console.error('[constella-main] renderer 加载失败:', err);
    });
  }

  /** close 决策：问 renderer dirty → dirty 时原生确认；确认丢弃/不 dirty → 关窗＋退出 */
  private async handleCloseRequest(win: BrowserWindowLike): Promise<void> {
    let dirty: boolean;
    try {
      dirty = (await this.askRendererDirty(win)).dirty;
    } catch {
      dirty = true; // 问询异常按 dirty 安全侧
    }
    if (dirty) {
      const choice = await this.deps.electron.dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Constella',
        message: '当前流程有未保存的修改',
        detail: '关闭窗口将丢弃未保存的修改。',
        buttons: ['丢弃并关闭', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0) return; // 取消：保窗
    }
    this.tearingDown = true;
    win.destroy(); // 绕过 close 拦截实际关窗（'closed' 随后派发）
    this.deps.electron.app.quit(); // 触发 before-quit → 退出序
  }

  /** m→r 问 renderer dirty（app:confirmClose 带响应）：推送后等同通道回程腿；超时按 dirty 安全侧 */
  private askRendererDirty(win: BrowserWindowLike): Promise<ConfirmCloseRes> {
    const { ipcMain } = this.deps.electron;
    const channel = IPC_CHANNELS.appConfirmClose;
    const timeoutMs = this.deps.confirmCloseTimeoutMs ?? DEFAULT_CONFIRM_CLOSE_TIMEOUT_MS;
    return new Promise<ConfirmCloseRes>((resolve) => {
      const onReply = (_event: unknown, payload: unknown): void => {
        cleanup();
        resolve(parseConfirmCloseReply(payload));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ dirty: true }); // renderer 无应答（未加载/未注册）兜底：按 dirty 安全侧
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        ipcMain.removeListener(channel, onReply);
      };
      ipcMain.once(channel, onReply);
      win.webContents.send(channel); // m→r 问询（payload={}）
    });
  }

  // ————————————————————————————————————————————
  // 导航拦截（02 §12.3：主窗非白名单导航转外部浏览器）
  // ————————————————————————————————————————————

  private wireNavigationGuard(wc: WebContentsLike): void {
    wc.on('will-navigate', (event, url) => {
      if (navigationAllowed(url)) return; // 白名单：自有 app:// 协议
      event.preventDefault();
      openExternalIfWeb(this.deps.electron.shell, url); // 仅 http/https 转外开，其余仅阻断
    });
    // window.open / target=_blank：一律拒绝开新窗（查看窗只经 openViewer 原语），http/https 转外开
    wc.setWindowOpenHandler((details) => {
      openExternalIfWeb(this.deps.electron.shell, details.url);
      return { action: 'deny' };
    });
  }

  // ————————————————————————————————————————————
  // app:// 协议服务（S-1 ③ 完整注册——rendererDir 静态产物＋目录逃逸防护）
  // ————————————————————————————————————————————

  private async serveRendererAsset(url: string): Promise<Response> {
    const u = new URL(url);
    let rel = decodeURIComponent(u.pathname || '/index.html');
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.normalize(
      path.join(this.deps.rendererDir, rel.startsWith('/') ? rel.slice(1) : rel),
    );
    // 目录逃逸防护：解析后必须仍落在 rendererDir 内（win32 大小写不敏感，双侧 lowercase 比对）
    const base = this.deps.rendererDir.endsWith(path.sep)
      ? this.deps.rendererDir
      : this.deps.rendererDir + path.sep;
    if (!filePath.toLowerCase().startsWith(base.toLowerCase())) {
      throw new Error(`app:// out-of-scope path rejected: ${rel}`);
    }
    // MIME 由 net.fetch(file://) 走 Chromium 扩展名映射保证（S-1 验证口径）
    return this.deps.electron.net.fetch(pathToFileURL(filePath).toString());
  }

  // ————————————————————————————————————————————
  // app 级事件（window-all-closed 覆盖/before-quit/activate）
  // ————————————————————————————————————————————

  private wireAppEvents(): void {
    const { app, BrowserWindow } = this.deps.electron;
    // S-3 坑②兜底：显式覆盖 window-all-closed——查看窗全关（乃至窗口数归零）不退 app；
    // 退出由主窗确认关（handleCloseRequest）或显式 quit（factoryReset relaunch 等，T4-20）驱动。
    // T4-18 §6.2b（destroyRun 后新建窗口导航成功）回归依赖本覆盖。
    app.on('window-all-closed', () => {
      /* no-op：覆盖 Electron 默认 quit */
    });
    // 退出序挂点：before-quit 拦截 → shutdown 全序 → 补 quit 直通
    app.on('before-quit', (event) => {
      if (this.shutdownDone) return;
      event.preventDefault();
      void this.shutdown().then(() => {
        app.quit();
      });
    });
    // macOS activate：无窗口时重建主窗（win32 不触发；T0-08 壳行为保留）
    app.on('activate', () => {
      const all = BrowserWindow.getAllWindows?.() ?? [];
      if (this.mainWindow === null && all.length === 0) this.createMainWindow();
    });
  }
}

/** 导航白名单：自有 app:// 协议（standard 特权协议下页面内相对路径解析） */
function navigationAllowed(url: string): boolean {
  try {
    return new URL(url).protocol === `${APP_SCHEME}:`;
  } catch {
    return false;
  }
}

/** 仅 http/https 转外开（其余协议静默阻断——02 §3.1「外部链接一律 shell.openExternal」＋协议白名单） */
function openExternalIfWeb(shell: ElectronApi['shell'], url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    void shell.openExternal(parsed.toString()).catch((err: unknown) => {
      console.error('[constella-main] openExternal 失败:', err);
    });
  }
}
