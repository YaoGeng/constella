// AppRuntime 可注入 electron 面契约（T4-13 / TDD-C-M1 §3 AppRuntime 行）。
//
// 生产装配=main/index.ts 传入真实 electron API；测试传入 mock（testing/mock-electron.ts，
// 卡面口径：electron 用 mock app 断言，真 electron 头跑归 T4-18/T4-20）。
// 红线：本文件只声明 AppRuntime 消费的 electron 表面（app/protocol/net/dialog/shell/ipcMain/
// BrowserWindow），不 re-export electron 模块——main 侧 electron import 收口在 index.ts（P-3）。

/** 窗口/app 事件对象（close/before-quit 拦截用 preventDefault 面） */
export interface PreventableEvent {
  preventDefault(): void;
}

/** m→r 推送与导航拦截所需的主窗 webContents 面 */
export interface WebContentsLike {
  /** m→r 推送（app:confirmClose 问询；run:scriptEvent/cron:fired sender 面=T4-14） */
  send(channel: string, ...args: unknown[]): void;
  /** 导航事件（'will-navigate'：非白名单导航拦截，02 §12.3） */
  on(event: string, listener: (event: PreventableEvent, url: string) => void): void;
  /** window.open / target=_blank 拦截（Electron 安全基线：deny＋http/https 转外开） */
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void;
  /** 当前页面 URL（confirmClose 超时兜底时 renderer 未加载的判据之一） */
  getURL(): string;
}

/** 主窗/查看窗宿主面（close 拦截只挂主窗；查看窗 ✕ 只关窗=A-8.2） */
export interface BrowserWindowLike {
  on(event: string, listener: (event: PreventableEvent) => void): void;
  once(event: string, listener: (event: PreventableEvent) => void): void;
  loadURL(url: string): Promise<void>;
  /** 绕过 close 事件直接销毁（confirmClose 确认丢弃后的实际关窗径） */
  destroy(): void;
  close(): void;
  isDestroyed(): boolean;
  /** 查看窗置顶（openViewer 复用已开窗时唤回前台） */
  focus(): void;
  moveTop(): void;
  readonly webContents: WebContentsLike;
}

/** BrowserWindow 构造面（查看窗原语与主窗创建共用） */
export interface BrowserWindowConstructor {
  new (options?: Record<string, unknown>): BrowserWindowLike;
  /** activate 重建判据（macOS；win32 下不触发） */
  getAllWindows?(): BrowserWindowLike[];
}

export interface AppLike {
  /** 启动序首步等待（§3 生命周期段） */
  whenReady(): Promise<void>;
  on(event: string, listener: (event: PreventableEvent, ...args: unknown[]) => void): void;
  getVersion(): string;
  getPath(name: 'userData' | string): string;
  quit(): void;
}

/** app:// 特权协议注册面（S-1 ③：renderer ESM 产物加载——file:// 直载被 CORS 拦） */
export interface ProtocolLike {
  /** 必须在 app ready 之前调用（startup 首步） */
  registerSchemesAsPrivileged(
    schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>,
  ): void;
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
}

/** net.fetch 面（app:// → file:// 静态资源映射；MIME 由 Chromium 扩展名映射保证） */
export interface NetLike {
  fetch(url: string): Promise<Response>;
}

/** dialog.showMessageBox 确认结果（confirmClose 原生确认，02 §3.3） */
export interface MessageBoxResult {
  /** buttons 下标（0=确认丢弃；1=取消） */
  response: number;
  checkboxChecked: boolean;
}

export interface ShowMessageBoxOptions {
  type?: 'none' | 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  noLink?: boolean;
}

export interface FileFilterLike {
  name?: string;
  extensions: string[];
}

export interface DialogLike {
  showMessageBox(
    win: BrowserWindowLike | undefined,
    options: ShowMessageBoxOptions,
  ): Promise<MessageBoxResult>;
  showOpenDialog(
    win: BrowserWindowLike | undefined,
    options: {
      properties?: string[];
      filters?: FileFilterLike[];
    },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    win: BrowserWindowLike | undefined,
    options: { defaultPath?: string },
  ): Promise<{ canceled: boolean; filePath?: string }>;
}

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

export interface IpcMainLike {
  /** r→m invoke 注册面（AppRuntime 域四组通道；T4-14 IpcGateway.register 接管位） */
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  /** app:confirmClose renderer 应答回收（同通道名回程腿——24 通道面冻结不加新通道） */
  once(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  /** confirmClose 超时兜底后回收挂起的 once 监听 */
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

/** AppRuntime 消费的 electron 表面全集（生产=真实 electron，测试=mock） */
export interface ElectronApi {
  app: AppLike;
  BrowserWindow: BrowserWindowConstructor;
  protocol: ProtocolLike;
  net: NetLike;
  dialog: DialogLike;
  shell: ShellLike;
  ipcMain: IpcMainLike;
}
