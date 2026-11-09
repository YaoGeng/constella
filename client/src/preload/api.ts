// preload 白名单面（T4-14 / TDD-C-M1 §1 preload 面＋§3 IpcGateway 行「preload contextBridge 半段」）。
//
// contextBridge 暴露 `window.constella`，白名单键 ≡ X-01 IPC_CHANNELS ≡ 02 §3.4 全集
// （24 通道＝21 r→m invoke＋3 m→r 推送；三方一致性=scripts/check-ipc-surface.mjs 静态断言＋
// main/ipc/preload-transport.spec.ts 运行时断言）。无 Node 泄漏（02 §3.1 安全基线）——本文件
// 只 **type-only** import @constella/shared（通道全名以字面量内联，见下）与零 electron/node:
// import（electron import 收口在 index.ts 装配层）。
//
// 错误恢复（§1 铁律 renderer 半段——「无 `Error invoking remote method` 前缀泄漏」）：
// Electron 45.2.3 实证 ipcRenderer.invoke 的 reject 恒为 `Error invoking remote method '<ch>': `
// 前缀 Error（main 侧 reject 值经 String 摊平——IpcGateway 已编码 JSON 形，见 main/ipc/
// serialize-error.ts）；本面统一 normalizeIpcRejection 剥前缀恢复 {code,message}。
// ⚠ 装配约束（T4-14 实证）：本文件只做 **type-only** import——sandboxed preload 的产物不得
// require workspace 包（esbuild packages:'external' 会外置 @constella/shared，且其 exports
// 指向 TS 源——运行期 require 不可达）。通道全名以字面量冻结表内联（≡ IPC_CHANNELS 值，
// 三方一致性=scripts/check-ipc-surface.mjs 静态断言＋main/ipc/preload-transport.spec.ts
// 运行时断言；编译期经 satisfies Record<keyof typeof IPC_CHANNELS, IpcChannel> 键/值域约束）。
import type {
  AppVersionReq,
  AppVersionRes,
  ConfirmCloseReq,
  ConfirmCloseRes,
  CreateSessionReq,
  CreateSessionRes,
  CronCancelReq,
  CronCancelRes,
  CronFiredEvent,
  CronUpsertReq,
  CronUpsertRes,
  CdpProbeReq,
  CdpProbeRes,
  DestroyRunReq,
  DestroyRunRes,
  IpcChannel,
  KillScriptReq,
  KillScriptRes,
  ListSessionsReq,
  ListSessionsRes,
  NavigateReq,
  NavigateRes,
  OpenFileReq,
  OpenFileRes,
  OpenViewerReq,
  OpenViewerRes,
  SaveFileReq,
  SaveFileRes,
  ScriptEvent,
  SecretDelReq,
  SecretDelRes,
  SecretGetReq,
  SecretGetRes,
  SecretSetReq,
  SecretSetRes,
  ShellOpenExternalReq,
  SpawnScriptReq,
  SpawnScriptRes,
  StorageInvokeReq,
  StorageInvokeRes,
  StorageOp,
  SystemInfoReq,
  SystemInfoRes,
  ZipExportReq,
  ZipExportRes,
  ZipImportReq,
  ZipImportRes,
} from '@constella/shared/ipc';
import type { IPC_CHANNELS } from '@constella/shared/ipc';

/** preload 消费的 ipcRenderer 面（生产=真实 ipcRenderer；测试=ipc-loop/mock） */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

// ————————————————————————————————————————————
// 暴露键冻结表（≡ IPC_CHANNELS；check-ipc-surface.mjs 静态断言面）
// ————————————————————————————————————————————

/** 21 r→m invoke 键→通道全名（字面量 ≡ IPC_CHANNELS 值——sandboxed preload 不可 require
 *  workspace 包，故内联；键/值域经 satisfies 编译期约束＋check-ipc-surface.mjs 静态核对） */
export const PRELOAD_INVOKE_SURFACE = {
  appVersion: 'constella:app:version',
  envSystemInfo: 'constella:env:systemInfo',
  envCdpProbe: 'constella:env:cdpProbe',
  shellOpenExternal: 'constella:shell:openExternal',
  dialogOpenFile: 'constella:dialog:openFile',
  dialogSaveFile: 'constella:dialog:saveFile',
  storageInvoke: 'constella:storage:invoke',
  secretSet: 'constella:secret:set',
  secretGet: 'constella:secret:get',
  secretDel: 'constella:secret:del',
  runSpawnScript: 'constella:run:spawnScript',
  runKillScript: 'constella:run:killScript',
  cdpCreateSession: 'constella:cdp:createSession',
  cdpNavigate: 'constella:cdp:navigate',
  cdpListSessions: 'constella:cdp:listSessions',
  cdpOpenViewer: 'constella:cdp:openViewer',
  cdpDestroyRun: 'constella:cdp:destroyRun',
  cronUpsert: 'constella:cron:upsert',
  cronCancel: 'constella:cron:cancel',
  zipExport: 'constella:zip:export',
  zipImport: 'constella:zip:import',
} as const;

/** 3 m→r 推送键→通道全名（同上内联） */
export const PRELOAD_PUSH_SURFACE = {
  runScriptEvent: 'constella:run:scriptEvent',
  cronFired: 'constella:cron:fired',
  appConfirmClose: 'constella:app:confirmClose',
} as const;

/** 键面完整性（编译期）：invoke＋push 恰等分 IPC_CHANNELS 24 键（缺键即编译错） */
const SURFACE_UNION_CHECK: Record<keyof typeof IPC_CHANNELS, IpcChannel> = {
  ...PRELOAD_INVOKE_SURFACE,
  ...PRELOAD_PUSH_SURFACE,
};
void SURFACE_UNION_CHECK;

// ————————————————————————————————————————————
// 错误恢复（{code,message} 恰形；前缀不泄漏）
// ————————————————————————————————————————————

/** reject 恢复形（IpcError 同构——code 含 INTERNAL 兜底，见 serialize-error.ts） */
export interface NormalizedIpcError {
  code: string;
  message: string;
}

function isPlainIpcError(v: unknown): v is { code: string; message: string } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v instanceof Error) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.code === 'string' && typeof rec.message === 'string';
}

/**
 * invoke reject → 恰 {code,message}：
 *   ① 结构化透传径（mock/直连）：{code,message} 普通对象原样归一；
 *   ② Electron 前缀径：剥 `Error invoking remote method '<ch>': ` → JSON.parse 恢复
 *      （IpcGateway 端 toString=JSON 编码，serialize-error.ts）；
 *   ③ 兜底：INTERNAL（02 §6.1）＋剥前缀原文（Electron 原生错误如 No handler registered）。
 */
export function normalizeIpcRejection(err: unknown): NormalizedIpcError {
  if (isPlainIpcError(err)) return { code: err.code, message: err.message };
  if (err instanceof Error) {
    const stripped = err.message.replace(/^Error invoking remote method '[^']+': /, '');
    try {
      const parsed: unknown = JSON.parse(stripped);
      if (isPlainIpcError(parsed)) return { code: parsed.code, message: parsed.message };
    } catch {
      /* 非 JSON——走 INTERNAL 兜底 */
    }
    return { code: 'INTERNAL', message: stripped };
  }
  return { code: 'INTERNAL', message: String(err) };
}

// ————————————————————————————————————————————
// window.constella 白名单 API（24 键）
// ————————————————————————————————————————————

/** m→r 推送订阅（返回退订函数） */
export type PushSubscription<T> = (listener: (payload: T) => void) => () => void;

/** app:confirmClose 应答器（m→r 带响应：问 dirty → 同通道回程 {dirty}，02 §3.3/§3.4） */
export type ConfirmCloseResponder = (
  payload: ConfirmCloseReq,
) => ConfirmCloseRes | Promise<ConfirmCloseRes>;

export interface ConstellaApi {
  // —— 21 r→m invoke（payload/结果形=X-01 9 域）——
  appVersion(payload?: AppVersionReq): Promise<AppVersionRes>;
  envSystemInfo(payload?: SystemInfoReq): Promise<SystemInfoRes>;
  envCdpProbe(payload?: CdpProbeReq): Promise<CdpProbeRes>;
  shellOpenExternal(payload: ShellOpenExternalReq): Promise<void>;
  dialogOpenFile(payload?: OpenFileReq): Promise<OpenFileRes>;
  dialogSaveFile(payload?: SaveFileReq): Promise<SaveFileRes>;
  storageInvoke<TOp extends StorageOp = StorageOp>(
    payload: StorageInvokeReq & { op: TOp },
  ): Promise<StorageInvokeRes<TOp>>;
  secretSet(payload: SecretSetReq): Promise<SecretSetRes>;
  secretGet(payload: SecretGetReq): Promise<SecretGetRes>;
  secretDel(payload: SecretDelReq): Promise<SecretDelRes>;
  runSpawnScript(payload: SpawnScriptReq): Promise<SpawnScriptRes>;
  runKillScript(payload: KillScriptReq): Promise<KillScriptRes>;
  cdpCreateSession(payload: CreateSessionReq): Promise<CreateSessionRes>;
  cdpNavigate(payload: NavigateReq): Promise<NavigateRes>;
  cdpListSessions(payload: ListSessionsReq): Promise<ListSessionsRes>;
  cdpDestroyRun(payload: DestroyRunReq): Promise<DestroyRunRes>;
  cdpOpenViewer(payload: OpenViewerReq): Promise<OpenViewerRes>;
  cronUpsert(payload: CronUpsertReq): Promise<CronUpsertRes>;
  cronCancel(payload: CronCancelReq): Promise<CronCancelRes>;
  zipExport(payload: ZipExportReq): Promise<ZipExportRes>;
  zipImport(payload: ZipImportReq): Promise<ZipImportRes>;
  // —— 3 m→r 推送（fire-and-forget 订阅面；app:confirmClose 带响应回程）——
  runScriptEvent: PushSubscription<ScriptEvent>;
  cronFired: PushSubscription<CronFiredEvent>;
  appConfirmClose(responder: ConfirmCloseResponder): () => void;
}

/**
 * 装配 preload 面（index.ts 经 contextBridge.exposeInMainWorld('constella', …) 暴露；
 * 测试经 ipc-loop 直连）。全部 24 键在两张冻结表约束下展开——键面漂移由
 * check-ipc-surface.mjs＋preload-transport.spec.ts 双面断言拦截。
 */
export function createConstellaApi(ipc: IpcRendererLike): ConstellaApi {
  const invokeRaw = async (channel: string, payload: unknown): Promise<unknown> => {
    try {
      return await ipc.invoke(channel, payload);
    } catch (err) {
      throw normalizeIpcRejection(err);
    }
  };
  const subscribe = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
    const wrapped = (_event: unknown, ...args: unknown[]): void => {
      listener(args[0] as T);
    };
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };

  return {
    appVersion: (payload: AppVersionReq = {}) => invokeRaw(PRELOAD_INVOKE_SURFACE.appVersion, payload) as Promise<AppVersionRes>,
    envSystemInfo: (payload: SystemInfoReq = {}) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.envSystemInfo, payload) as Promise<SystemInfoRes>,
    envCdpProbe: (payload: CdpProbeReq = {}) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.envCdpProbe, payload) as Promise<CdpProbeRes>,
    shellOpenExternal: (payload: ShellOpenExternalReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.shellOpenExternal, payload) as Promise<void>,
    dialogOpenFile: (payload: OpenFileReq = {}) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.dialogOpenFile, payload) as Promise<OpenFileRes>,
    dialogSaveFile: (payload: SaveFileReq = {}) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.dialogSaveFile, payload) as Promise<SaveFileRes>,
    storageInvoke: <TOp extends StorageOp = StorageOp>(
      payload: StorageInvokeReq & { op: TOp },
    ): Promise<StorageInvokeRes<TOp>> =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.storageInvoke, payload) as Promise<StorageInvokeRes<TOp>>,
    secretSet: (payload: SecretSetReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.secretSet, payload) as Promise<SecretSetRes>,
    secretGet: (payload: SecretGetReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.secretGet, payload) as Promise<SecretGetRes>,
    secretDel: (payload: SecretDelReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.secretDel, payload) as Promise<SecretDelRes>,
    runSpawnScript: (payload: SpawnScriptReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.runSpawnScript, payload) as Promise<SpawnScriptRes>,
    runKillScript: (payload: KillScriptReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.runKillScript, payload) as Promise<KillScriptRes>,
    cdpCreateSession: (payload: CreateSessionReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.cdpCreateSession, payload) as Promise<CreateSessionRes>,
    cdpNavigate: (payload: NavigateReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.cdpNavigate, payload) as Promise<NavigateRes>,
    cdpListSessions: (payload: ListSessionsReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.cdpListSessions, payload) as Promise<ListSessionsRes>,
    cdpDestroyRun: (payload: DestroyRunReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.cdpDestroyRun, payload) as Promise<DestroyRunRes>,
    cdpOpenViewer: (payload: OpenViewerReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.cdpOpenViewer, payload) as Promise<OpenViewerRes>,
    cronUpsert: (payload: CronUpsertReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.cronUpsert, payload) as Promise<CronUpsertRes>,
    cronCancel: (payload: CronCancelReq) =>
      invokeRaw(PRELOAD_INVOKE_SURFACE.cronCancel, payload) as Promise<CronCancelRes>,
    zipExport: (payload: ZipExportReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.zipExport, payload) as Promise<ZipExportRes>,
    zipImport: (payload: ZipImportReq) => invokeRaw(PRELOAD_INVOKE_SURFACE.zipImport, payload) as Promise<ZipImportRes>,
    runScriptEvent: (listener: (payload: ScriptEvent) => void) => subscribe(PRELOAD_PUSH_SURFACE.runScriptEvent, listener),
    cronFired: (listener: (payload: CronFiredEvent) => void) => subscribe(PRELOAD_PUSH_SURFACE.cronFired, listener),
    appConfirmClose: (responder: ConfirmCloseResponder): (() => void) => {
      const wrapped = (_event: unknown): void => {
        void Promise.resolve(responder({})).then((res) => {
          ipc.send(PRELOAD_PUSH_SURFACE.appConfirmClose, res);
        });
      };
      ipc.on(PRELOAD_PUSH_SURFACE.appConfirmClose, wrapped);
      return () => ipc.removeListener(PRELOAD_PUSH_SURFACE.appConfirmClose, wrapped);
    },
  };
}

declare global {
  interface Window {
    /** preload 半段暴露面（contextBridge 注入，C-M1 §1；renderer 侧类型入口——生产经
     * index.ts 装配，类型经本声明直达 renderer tsc 程序） */
    constella: ConstellaApi;
  }
}
