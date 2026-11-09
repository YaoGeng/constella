// mock electron 测试基建（T4-13；卡面口径：electron 用 mock app 断言——真 electron 头跑归 T4-18/T4-20）。
//
// 覆盖 AppRuntime 消费的 electron 表面（electron-api.ts 契约）：app/BrowserWindow/protocol/net/
// dialog/shell/ipcMain。事件用极简 emitter；BrowserWindow.close() 还原真实语义——先派发 'close'
// 事件（preventDefault 可中止），未被拦才 destroy（destroy 派发 'closed'）。
// 各 mock 可选注入 log: string[] 供启动/退出双序断言（与 service slot mock 共用同一数组）。
import type {
  AppLike,
  BrowserWindowConstructor,
  BrowserWindowLike,
  DialogLike,
  ElectronApi,
  FileFilterLike,
  IpcMainLike,
  MessageBoxResult,
  NetLike,
  PreventableEvent,
  ProtocolLike,
  ShellLike,
  ShowMessageBoxOptions,
  WebContentsLike,
} from '../electron-api';

/** 极简事件发射器（on/once/removeListener/emit） */
class Emitter {
  private readonly listeners = new Map<string, Array<(...args: never[]) => void>>();
  private readonly onceListeners = new Map<string, Array<(...args: never[]) => void>>();

  on(event: string, listener: (...args: never[]) => void): void {
    this.add(this.listeners, event, listener);
  }

  once(event: string, listener: (...args: never[]) => void): void {
    this.add(this.onceListeners, event, listener);
  }

  removeListener(event: string, listener: (...args: never[]) => void): void {
    this.drop(this.listeners, event, listener);
    this.drop(this.onceListeners, event, listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) (l as (...a: unknown[]) => void)(...args);
    const once = this.onceListeners.get(event) ?? [];
    this.onceListeners.set(event, []);
    for (const l of once) (l as (...a: unknown[]) => void)(...args);
  }

  listenerCount(event: string): number {
    return (this.listeners.get(event) ?? []).length + (this.onceListeners.get(event) ?? []).length;
  }

  private add(
    target: Map<string, Array<(...args: never[]) => void>>,
    event: string,
    listener: (...args: never[]) => void,
  ): void {
    const list = target.get(event) ?? [];
    list.push(listener);
    target.set(event, list);
  }

  private drop(
    target: Map<string, Array<(...args: never[]) => void>>,
    event: string,
    listener: (...args: never[]) => void,
  ): void {
    const list = target.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }
}

/** 带 prevented 标记的可拦截事件 */
function preventable(): PreventableEvent & { prevented: boolean } {
  return {
    prevented: false,
    preventDefault(): void {
      this.prevented = true;
    },
  };
}

/** m→r 推送记录项 */
export interface SentMessage {
  channel: string;
  args: unknown[];
}

export class MockWebContents implements WebContentsLike {
  readonly sent: SentMessage[] = [];
  url = '';
  private readonly emitter = new Emitter();
  private openHandler?: (details: { url: string }) => { action: 'allow' | 'deny' };

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, args });
  }

  on(event: string, listener: (event: PreventableEvent, url: string) => void): void {
    this.emitter.on(event, listener as (...args: never[]) => void);
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.openHandler = handler;
  }

  getURL(): string {
    return this.url;
  }

  /** 测试助手：派发 will-navigate，返回是否被拦截（preventDefault） */
  emitWillNavigate(url: string): boolean {
    const e = preventable();
    this.emitter.emit('will-navigate', e, url);
    return e.prevented;
  }

  /** 测试助手：执行 window.open 拦截器（返回 action） */
  callWindowOpenHandler(url: string): { action: 'allow' | 'deny' } {
    if (!this.openHandler) throw new Error('mock: setWindowOpenHandler 未注册');
    return this.openHandler({ url });
  }
}

export class MockBrowserWindow implements BrowserWindowLike {
  readonly options: Record<string, unknown> | undefined;
  readonly webContents = new MockWebContents();
  readonly loadUrls: string[] = [];
  focusCount = 0;
  moveTopCount = 0;
  private readonly emitter = new Emitter();
  private readonly log: string[];
  private destroyed = false;

  constructor(options?: Record<string, unknown>, log: string[] = []) {
    this.options = options;
    this.log = log;
  }

  on(event: string, listener: (event: PreventableEvent) => void): void {
    this.emitter.on(event, listener as (...args: never[]) => void);
  }

  once(event: string, listener: (event: PreventableEvent) => void): void {
    this.emitter.once(event, listener as (...args: never[]) => void);
  }

  async loadURL(url: string): Promise<void> {
    this.loadUrls.push(url);
    this.log.push(`window.loadURL:${url}`);
    this.webContents.url = url;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emitter.emit('closed');
  }

  close(): void {
    if (this.destroyed) return;
    const e = preventable();
    this.emitter.emit('close', e);
    if (!e.prevented) this.destroy();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  focus(): void {
    this.focusCount++;
  }

  moveTop(): void {
    this.moveTopCount++;
  }
}

export class MockApp implements AppLike {
  version = '0.0.0-mock';
  userDataPath = 'C:\\mock-userData';
  quitCount = 0;
  private readonly emitter = new Emitter();
  private readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  on(event: string, listener: (event: PreventableEvent, ...args: unknown[]) => void): void {
    this.emitter.on(event, listener as (...args: never[]) => void);
  }

  whenReady(): Promise<void> {
    this.log.push('app.whenReady');
    return Promise.resolve();
  }

  getVersion(): string {
    return this.version;
  }

  getPath(name: 'userData' | string): string {
    return name === 'userData' ? this.userDataPath : `C:\\mock-userData\\${name}`;
  }

  quit(): void {
    this.quitCount++;
  }

  /** 测试助手：派发 app 事件（返回事件对象查 prevented） */
  emitApp(event: string, ...args: unknown[]): PreventableEvent & { prevented: boolean } {
    const e = preventable();
    this.emitter.emit(event, e, ...args);
    return e;
  }

  /** 测试助手：查询已注册监听数（window-all-closed 覆盖断言） */
  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }
}

export class MockProtocol implements ProtocolLike {
  readonly privilegedSchemes: Array<{ scheme: string; privileges: Record<string, boolean> }> = [];
  readonly handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
  private readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  registerSchemesAsPrivileged(
    schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>,
  ): void {
    this.privilegedSchemes.push(...schemes);
    this.log.push('protocol.registerSchemesAsPrivileged');
  }

  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void {
    this.handlers.set(scheme, handler);
    this.log.push(`protocol.handle:${scheme}`);
  }

  /** 测试助手：以给定 URL 派发协议 handler */
  dispatch(scheme: string, url: string): Promise<Response> {
    const handler = this.handlers.get(scheme);
    if (!handler) throw new Error(`mock: protocol.handle('${scheme}') 未注册`);
    return Promise.resolve(handler(new Request(url)));
  }
}

export class MockNet implements NetLike {
  readonly fetched: string[] = [];
  fetchImpl?: (url: string) => Promise<Response>;

  async fetch(url: string): Promise<Response> {
    this.fetched.push(url);
    return this.fetchImpl ? this.fetchImpl(url) : new Response('mock-app-asset');
  }
}

export class MockDialog implements DialogLike {
  readonly messageBoxCalls: Array<{ win: BrowserWindowLike | undefined; opts: ShowMessageBoxOptions }> = [];
  readonly openCalls: Array<{
    win: BrowserWindowLike | undefined;
    opts: { properties?: string[]; filters?: FileFilterLike[] };
  }> = [];
  readonly saveCalls: Array<{ win: BrowserWindowLike | undefined; opts: { defaultPath?: string } }> = [];
  showMessageBoxImpl?: (win: BrowserWindowLike | undefined, opts: ShowMessageBoxOptions) => Promise<MessageBoxResult>;
  showOpenDialogImpl?: (
    win: BrowserWindowLike | undefined,
    opts: { properties?: string[]; filters?: FileFilterLike[] },
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialogImpl?: (
    win: BrowserWindowLike | undefined,
    opts: { defaultPath?: string },
  ) => Promise<{ canceled: boolean; filePath?: string }>;

  async showMessageBox(
    win: BrowserWindowLike | undefined,
    options: ShowMessageBoxOptions,
  ): Promise<MessageBoxResult> {
    this.messageBoxCalls.push({ win, opts: options });
    return this.showMessageBoxImpl
      ? this.showMessageBoxImpl(win, options)
      : { response: 0, checkboxChecked: false };
  }

  async showOpenDialog(
    win: BrowserWindowLike | undefined,
    options: { properties?: string[]; filters?: FileFilterLike[] },
  ): Promise<{ canceled: boolean; filePaths: string[] }> {
    this.openCalls.push({ win, opts: options });
    return this.showOpenDialogImpl
      ? this.showOpenDialogImpl(win, options)
      : { canceled: true, filePaths: [] };
  }

  async showSaveDialog(
    win: BrowserWindowLike | undefined,
    options: { defaultPath?: string },
  ): Promise<{ canceled: boolean; filePath?: string }> {
    this.saveCalls.push({ win, opts: options });
    return this.showSaveDialogImpl ? this.showSaveDialogImpl(win, options) : { canceled: true };
  }
}

export class MockShell implements ShellLike {
  readonly opened: string[] = [];
  openExternalImpl?: (url: string) => Promise<void>;

  async openExternal(url: string): Promise<void> {
    this.opened.push(url);
    return this.openExternalImpl ? this.openExternalImpl(url) : undefined;
  }
}

export class MockIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  private readonly emitter = new Emitter();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    if (this.handlers.has(channel)) throw new Error(`mock: ipcMain.handle 重复注册 ${channel}`);
    this.handlers.set(channel, listener);
  }

  once(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
    this.emitter.once(channel, listener as (...args: never[]) => void);
  }

  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
    this.emitter.removeListener(channel, listener as (...args: never[]) => void);
  }

  /** 测试助手：模拟 ipcRenderer.invoke 往返（handler reject 原样抛出） */
  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`mock: ipcMain.handle('${channel}') 未注册`);
    return handler({}, payload);
  }

  /** 测试助手：模拟 ipcRenderer.send（触发 main 侧 on/once 监听——confirmClose 应答回程腿） */
  rendererSend(channel: string, ...args: unknown[]): void {
    this.emitter.emit(channel, {}, ...args);
  }
}

export interface MockElectron {
  api: ElectronApi;
  log: string[];
  app: MockApp;
  protocol: MockProtocol;
  net: MockNet;
  dialog: MockDialog;
  shell: MockShell;
  ipcMain: MockIpcMain;
  /** 全部已创建窗口（创建序） */
  createdWindows: MockBrowserWindow[];
  BrowserWindow: BrowserWindowConstructor;
}

/** 组装一套互相关联的 mock electron（log 供双序断言共享） */
export function createMockElectron(log: string[] = []): MockElectron {
  const app = new MockApp(log);
  const protocol = new MockProtocol(log);
  const net = new MockNet();
  const dialog = new MockDialog();
  const shell = new MockShell();
  const ipcMain = new MockIpcMain();
  const createdWindows: MockBrowserWindow[] = [];

  // BrowserWindow 工厂：记录创建序＋驱动 getAllWindows（activate 重建判据）
  class MockBrowserWindowCtor extends MockBrowserWindow implements BrowserWindowLike {
    constructor(options?: Record<string, unknown>) {
      super(options, log);
      createdWindows.push(this);
      log.push('window.create');
    }

    static getAllWindows(): BrowserWindowLike[] {
      return createdWindows.filter((w) => !w.isDestroyed());
    }
  }
  const BrowserWindow: BrowserWindowConstructor = MockBrowserWindowCtor;

  return {
    api: { app, BrowserWindow, protocol, net, dialog, shell, ipcMain },
    log,
    app,
    protocol,
    net,
    dialog,
    shell,
    ipcMain,
    createdWindows,
    BrowserWindow,
  };
}
