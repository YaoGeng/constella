// DAO 公共件：行↔类型转换辅助＋业务错误（T1-04/T1-05；C-06 §3 DAO×N 组件行）。
//
// 错误口径（C-M1 §1「DAO 业务码透传」）：StorageError.code ∈ shared STORAGE_DAO_ERROR_CODES
// （FLOW/VERSION/RUN/HIT-NOT-FOUND、ACTIVE-RUN-EXISTS）——经 storage:invoke 以 IpcError.code
// 透传至 renderer（通道 handler 归 C-M1，P4）。参数校验失败（VALIDATION-FAILED）与未知 op
// （IPC-UNKNOWN-OP）在 ops 层抛（T1-07）。
import { randomUUID } from 'node:crypto';
import { STORAGE_DAO_ERROR_CODES } from '@constella/shared/constants';
import type { StorageDaoErrorCode } from '@constella/shared/constants';

/** DAO/ops 层业务错误（code 透传契约见上） */
export class StorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function flowNotFound(id: string): StorageError {
  return new StorageError(STORAGE_DAO_ERROR_CODES.FLOW_NOT_FOUND, `流程不存在：${id}`);
}

export function versionNotFound(id: string): StorageError {
  return new StorageError(STORAGE_DAO_ERROR_CODES.VERSION_NOT_FOUND, `版本不存在：${id}`);
}

export function runNotFound(id: string): StorageError {
  return new StorageError(STORAGE_DAO_ERROR_CODES.RUN_NOT_FOUND, `运行不存在：${id}`);
}

export function hitNotFound(id: string): StorageError {
  return new StorageError(STORAGE_DAO_ERROR_CODES.HIT_NOT_FOUND, `断点不存在：${id}`);
}

export function activeRunExists(flowId: string): StorageError {
  return new StorageError(STORAGE_DAO_ERROR_CODES.ACTIVE_RUN_EXISTS, `流程已有进行中的运行：${flowId}`);
}

export function isStorageDaoErrorCode(code: string): code is StorageDaoErrorCode {
  return Object.values(STORAGE_DAO_ERROR_CODES).includes(code as StorageDaoErrorCode);
}

/** 连接获取器（factoryReset 换连接后 DAO 引用自动跟随——StorageLayer 持有者注入） */
export type ConnGetter = () => import('../engine/connection').DbConnection;

/** 毫秒时间戳（全层统一 Date.now） */
export function now(): number {
  return Date.now();
}

/** 新行 id（UUIDv4；种子等固定 id 场景不用本函数） */
export function newId(): string {
  return randomUUID();
}

/** JSON 列编码（undefined→null；对象/数组序列化） */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/** JSON 列解码（null/undefined→null；损坏数据抛错而非吞错——迁移期数据问题要暴露） */
export function fromJson<T>(raw: string | null | undefined, field: string): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`JSON 列损坏（${field}）：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 行字段取值并窄化为 string（DAO 行对象由引擎归一化为普通对象） */
export function asString(v: unknown): string {
  return v as string;
}
