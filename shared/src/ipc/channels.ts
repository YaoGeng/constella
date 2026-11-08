// IPC 通道常量 + 错误面（X-01 §1 ipc 行；02 §3.4 IPC 契约表全量 24 通道；
// C-M1 §1 矩阵＝通道×语义×错误码权威）。通道全名=`constella:<name>`（02 §3.4）；
// 21 r→m invoke + 3 m→r 推送（run:scriptEvent / cron:fired / app:confirmClose）。
// preload 暴露白名单键 ≡ 本常量 ≡ 02 §3.4 全集（C-M1 §6.6 check-ipc-surface.mjs 断言面）。
import type { ErrorCode } from '../dto/common';
import type { StorageDaoErrorCode } from '../constants/error-codes';

/** 全量通道常量（值＝通道全名；键＝驼峰别名，preload/IpcGateway 消费用） */
export const IPC_CHANNELS = {
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
  // —— m→r 推送（fire-and-forget；app:confirmClose 带响应 {dirty}）——
  runScriptEvent: 'constella:run:scriptEvent',
  cronFired: 'constella:cron:fired',
  appConfirmClose: 'constella:app:confirmClose',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** r→m invoke 通道子集（21，02 §3.4） */
export const IPC_INVOKE_CHANNELS = [
  'constella:app:version',
  'constella:env:systemInfo',
  'constella:env:cdpProbe',
  'constella:shell:openExternal',
  'constella:dialog:openFile',
  'constella:dialog:saveFile',
  'constella:storage:invoke',
  'constella:secret:set',
  'constella:secret:get',
  'constella:secret:del',
  'constella:run:spawnScript',
  'constella:run:killScript',
  'constella:cdp:createSession',
  'constella:cdp:navigate',
  'constella:cdp:listSessions',
  'constella:cdp:openViewer',
  'constella:cdp:destroyRun',
  'constella:cron:upsert',
  'constella:cron:cancel',
  'constella:zip:export',
  'constella:zip:import',
] as const;

/** m→r 推送通道子集（3，02 §3.4） */
export const IPC_PUSH_CHANNELS = [
  'constella:run:scriptEvent',
  'constella:cron:fired',
  'constella:app:confirmClose',
] as const;

/** IPC 错误码常量集（✅ M4 #8⑦；以 C-M1 §1 矩阵为准——02 §3.4 未定义 IPC 错误码，
 * C-M1 即其「错误语义」规格落点；推送通道无错误语义；「业务非错误」一律 in-band 结果不 reject） */
export const IPC_ERROR_CODES = {
  SHELL_INVALID_URL: 'SHELL-INVALID-URL',
  IPC_UNKNOWN_OP: 'IPC-UNKNOWN-OP',
  SECRET_UNAVAILABLE: 'SECRET-UNAVAILABLE',
  RUN_SCRIPT_NOT_FOUND: 'RUN-SCRIPT-NOT-FOUND',
  RUN_ENV_MISSING: 'RUN-ENV-MISSING',
  RUN_INVALID_LANG: 'RUN-INVALID-LANG',
  CDP_PORT_EXHAUSTED: 'CDP-PORT-EXHAUSTED',
  CDP_ATTACH_FAILED: 'CDP-ATTACH-FAILED',
  CDP_SESSION_NOT_FOUND: 'CDP-SESSION-NOT-FOUND',
  CDP_NAV_FAILED: 'CDP-NAV-FAILED',
  CRON_INVALID_EXPR: 'CRON-INVALID-EXPR',
  ZIP_WRITE_FAILED: 'ZIP-WRITE-FAILED',
  ZIP_FLOW_NOT_FOUND: 'ZIP-FLOW-NOT-FOUND',
  ZIP_INVALID: 'ZIP-INVALID',
  ZIP_UNSAFE_ENTRY: 'ZIP-UNSAFE-ENTRY',
} as const;

/** IPC 错误码字面量（15 项全集）；参数校验失败复用 02 §6.1 VALIDATION-FAILED（C-M1 §1 铁律），
 * storage:invoke 另透传 DAO 业务码（STORAGE_DAO_ERROR_CODES） */
export type IpcErrorCode =
  | (typeof IPC_ERROR_CODES)[keyof typeof IPC_ERROR_CODES]
  | Extract<ErrorCode, 'VALIDATION-FAILED'>;

/** r→m handler 抛错的统一序列化形（✅ M4 #8⑦：IpcError {code,message}；C-M1 错误序列化铁律——
 * 裸 Error/堆栈不穿 contextBridge；storage:invoke 的 DAO 业务码透传见 StorageDaoErrorCode） */
export interface IpcError {
  code: IpcErrorCode | StorageDaoErrorCode;
  message: string;
}

/** 简单成功响应 {ok}（多通道复用：run:killScript、cdp 三通道、cron 两通道等幂等 in-band 面） */
export interface OkRes {
  ok: boolean;
}
