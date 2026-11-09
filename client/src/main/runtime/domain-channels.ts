// AppRuntime 域通道四组 handler（T4-13 / TDD-C-M1 §1 矩阵 app:*/env:*/dialog:*/shell:* 行）。
//
// 语义冻结（§1 矩阵）：
//   app:version      r→m  process.versions 聚合（B-9）——无业务错误
//   env:systemInfo   r→m  os/cpu/mem＋runtimeVersions＋lanes 内存数组（M4 #7：单 lane ≤150MB
//                        预算告警数据源——聚合自 CdpSessionManager 会话窗口，T4-18 接线）
//   dialog:openFile/saveFile  r→m  用户取消 in-band {path:null}（非 reject）
//   shell:openExternal  r→m  仅 http/https；非法→SHELL-INVALID-URL（协议白名单=C-M1 冻结安全增强）
//
// 注册面：InvokeRegistry（缺省=ipcMain.handle 半段）——T4-14 IpcGateway.register/serializeError
// 接管位（payload Zod 校验〔源型=X-01〕与 21 通道全集注册归 T4-14；本卡 handler 只做轻量形状防御）。
import os from 'node:os';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  type AppVersionRes,
  type ConfirmCloseRes,
  type IpcChannel,
  type IpcErrorCode,
  type LaneMemory,
  type OpenFileRes,
  type SaveFileRes,
  type SystemInfoRes,
} from '@constella/shared/ipc';
import type { AppLike, BrowserWindowLike, DialogLike, IpcMainLike, ShellLike } from './electron-api';

/** r→m invoke 注册面（缺省=ipcMain.handle 半段；T4-14 IpcGateway.register 接管位） */
export interface InvokeRegistry {
  handle(channel: IpcChannel, handler: (payload: unknown) => unknown | Promise<unknown>): void;
}

/** env:systemInfo lanes 内存数据源（CdpSessionManager 会话窗口 processMemoryInfo 聚合——T4-18 接线） */
export type LaneMemorySource = () => LaneMemory[] | Promise<LaneMemory[]>;

/** 域通道依赖面 */
export interface DomainChannelDeps {
  app: Pick<AppLike, 'getVersion'>;
  dialog: DialogLike;
  shell: ShellLike;
  /** 对话框 owner 窗（主窗存活时取主窗） */
  ownerWindow: () => BrowserWindowLike | undefined;
  laneMemory: LaneMemorySource;
}

/** 域通道业务错误（code＋message；经注册面 reject——铁律：裸 Error/堆栈不穿 contextBridge） */
export class DomainChannelError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainChannelError';
  }
}

/**
 * 错误序列化先驱（T4-14 IpcGateway.serializeError 接管位）：域错误→{code,message}；
 * 未知错误→INTERNAL（02 §6.1 通用码）。
 */
export function serializeDomainError(err: unknown): { code: string; message: string } {
  if (err instanceof DomainChannelError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}

/** ipcMain.handle 半段缺省注册面（T4-14 IpcGateway.register 落位后整体替换） */
export function createIpcMainInvokeRegistry(ipcMain: IpcMainLike): InvokeRegistry {
  return {
    handle(channel: IpcChannel, handler: (payload: unknown) => unknown | Promise<unknown>): void {
      ipcMain.handle(channel, async (_event: unknown, payload?: unknown) => {
        try {
          return await handler(payload);
        } catch (err) {
          throw serializeDomainError(err);
        }
      });
    },
  };
}

// ————————————————————————————————————————————
// app:version（process.versions 聚合，B-9）
// ————————————————————————————————————————————

/** @types/node 未声明 electron/chrome 键（真实 Electron main 恒在）——按运行时版本表读取 */
const RUNTIME_VERSIONS = process.versions as Record<string, string | undefined>;

function handleAppVersion(deps: DomainChannelDeps): AppVersionRes {
  return {
    app: deps.app.getVersion(),
    electron: RUNTIME_VERSIONS.electron as string,
    chrome: RUNTIME_VERSIONS.chrome as string,
    node: RUNTIME_VERSIONS.node as string,
    platform: process.platform,
  };
}

// ————————————————————————————————————————————
// env:systemInfo（B-9＋lanes 内存数组聚合，M4 #7）
// ————————————————————————————————————————————

async function handleEnvSystemInfo(deps: DomainChannelDeps): Promise<SystemInfoRes> {
  return {
    os: os.platform(),
    cpuCores: os.cpus().length,
    memTotal: os.totalmem(),
    runtimeVersions: {
      electron: RUNTIME_VERSIONS.electron as string,
      chrome: RUNTIME_VERSIONS.chrome as string,
      node: RUNTIME_VERSIONS.node as string,
    },
    lanes: await deps.laneMemory(),
  };
}

// ————————————————————————————————————————————
// dialog:openFile / saveFile（用户取消 in-band {path:null}）
// ————————————————————————————————————————————

/** 轻量形状防御（正式 Zod 校验源型=X-01 归 T4-14）：仅取可识别字段，其余忽略 */
function asRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function parseFilters(payload: unknown): Array<{ name?: string; extensions: string[] }> | undefined {
  const raw = asRecord(payload).filters;
  if (!Array.isArray(raw)) return undefined;
  const filters: Array<{ name?: string; extensions: string[] }> = [];
  for (const f of raw) {
    const rec = asRecord(f);
    if (Array.isArray(rec.extensions)) {
      filters.push({
        ...(typeof rec.name === 'string' ? { name: rec.name } : {}),
        extensions: rec.extensions.filter((e): e is string => typeof e === 'string'),
      });
    }
  }
  return filters;
}

async function handleDialogOpenFile(deps: DomainChannelDeps, payload: unknown): Promise<OpenFileRes> {
  const res = await deps.dialog.showOpenDialog(deps.ownerWindow(), {
    properties: ['openFile'],
    ...(parseFilters(payload) ? { filters: parseFilters(payload) } : {}),
  });
  const first = res.filePaths[0];
  if (res.canceled || first === undefined) return { path: null };
  return { path: first };
}

async function handleDialogSaveFile(deps: DomainChannelDeps, payload: unknown): Promise<SaveFileRes> {
  const defaultName = asRecord(payload).defaultName;
  const res = await deps.dialog.showSaveDialog(
    deps.ownerWindow(),
    typeof defaultName === 'string' ? { defaultPath: defaultName } : {},
  );
  if (res.canceled || res.filePath === undefined || res.filePath === '') return { path: null };
  return { path: res.filePath };
}

// ————————————————————————————————————————————
// shell:openExternal（仅 http/https；非法→SHELL-INVALID-URL）
// ————————————————————————————————————————————

function invalidShellUrl(url: string): DomainChannelError {
  return new DomainChannelError(
    IPC_ERROR_CODES.SHELL_INVALID_URL,
    `拒绝打开非 http/https 链接: ${url}`,
  );
}

async function handleShellOpenExternal(deps: DomainChannelDeps, payload: unknown): Promise<void> {
  const raw = asRecord(payload).url;
  if (typeof raw !== 'string') throw invalidShellUrl(String(raw));
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidShellUrl(raw);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw invalidShellUrl(raw);
  await deps.shell.openExternal(parsed.toString());
}

// ————————————————————————————————————————————
// 注册（AppRuntime.startup 调用）
// ————————————————————————————————————————————

/** 注册 AppRuntime 域四组通道（app:version／env:systemInfo／dialog:openFile·saveFile／shell:openExternal） */
export function registerAppRuntimeChannels(deps: DomainChannelDeps, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.appVersion, () => handleAppVersion(deps));
  registry.handle(IPC_CHANNELS.envSystemInfo, () => handleEnvSystemInfo(deps));
  registry.handle(IPC_CHANNELS.dialogOpenFile, (payload) => handleDialogOpenFile(deps, payload));
  registry.handle(IPC_CHANNELS.dialogSaveFile, (payload) => handleDialogSaveFile(deps, payload));
  registry.handle(IPC_CHANNELS.shellOpenExternal, (payload) => handleShellOpenExternal(deps, payload));
}

/** confirmClose 应答解析（dirty 缺省安全侧=true） */
export function parseConfirmCloseReply(payload: unknown): ConfirmCloseRes {
  const dirty = asRecord(payload).dirty;
  return { dirty: typeof dirty === 'boolean' ? dirty : true };
}
