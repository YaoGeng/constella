// IpcGateway 错误序列化（T4-14 / TDD-C-M1 §1 错误序列化铁律段＋§3 IpcGateway 行
// `serializeError(e): IpcError`——接管 T4-13 serializeDomainError 先驱）。
//
// 铁律：r→m handler 抛出的一切错误统一序列化 {code,message} reject——裸 Error/堆栈不穿
// contextBridge；推送 fire-and-forget 无错误语义；业务非错误一律 in-band（§1 矩阵末列）。
// 识别序：
//   ① 已是 {code,message} 形的普通对象（本网关校验失败值／T4-20 透传形）→ 归一（恰二键，其余丢弃）；
//   ② Error 且带非空 string code（DomainChannelError〔T4-13〕/StorageError〔T1-05/T1-07〕/
//      后续五服务错误同构形——§1「DAO 业务码透传」）→ 取 {code, message}；
//   ③ 其余 Error → INTERNAL（02 §6.1 通用码。X-01 IpcErrorCode 未含 INTERNAL——与 T4-13 先驱
//      同口径，SerializedIpcError.code 并集登记 INTERNAL）；
//   ④ 其他值 → INTERNAL + String。
//
// Electron 传输编码（实证 2026-11-09，Electron 45.2.3 头跑探针）：ipcMain.handle 的 reject 值
// 经 String() 摊平进 renderer 侧 `Error invoking remote method '<ch>': ` 前缀消息——裸 plain
// object 摊平为 `[object Object]`（code/message 全失）。故 toIpcRejection 在 {code,message} 上挂
// **不可枚举** toString=JSON 形：
//   - 结构化透传径（mock/直连）：toEqual({code,message}) 恰合（不可枚举键不计入键集）；
//   - Electron 径：String(rej)=JSON → preload 半段剥前缀＋JSON.parse 恢复
//     （client/src/preload/api.ts normalizeIpcRejection）。
import type { IpcErrorCode } from '@constella/shared/ipc';
import type { StorageDaoErrorCode } from '@constella/shared/constants';

/** 统一序列化形（IpcError 的 code 并集加 INTERNAL——见文件头 ③） */
export interface SerializedIpcError {
  code: IpcErrorCode | StorageDaoErrorCode | 'INTERNAL';
  message: string;
}

/** 已是 {code,message} 形的普通对象（非 Error）判定 */
function isPlainIpcError(v: unknown): v is { code: string; message: string } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v instanceof Error) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.code === 'string' && typeof rec.message === 'string';
}

/** 一切 handler 抛错 → {code,message}（裸 Error/堆栈不穿 contextBridge） */
export function serializeError(err: unknown): SerializedIpcError {
  if (isPlainIpcError(err)) return { code: err.code as SerializedIpcError['code'], message: err.message };
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' && code !== ''
      ? { code: code as SerializedIpcError['code'], message: err.message }
      : { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/**
 * ipcMain.handle 的 reject 值：{code,message}＋不可枚举 toString=JSON（Electron 传输编码，
 * 见文件头）——mock/结构化径恰二键 plain object，Electron String 摊平径可恢复。
 */
export function toIpcRejection(err: unknown): SerializedIpcError {
  const serialized = serializeError(err);
  Object.defineProperty(serialized, 'toString', {
    value: (): string => JSON.stringify({ code: serialized.code, message: serialized.message }),
    enumerable: false,
  });
  return serialized;
}
