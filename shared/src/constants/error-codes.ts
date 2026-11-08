// 错误码常量集（X-01 §1 constants 行；02 §6.1 错误码总表）+ storage DAO 业务错误码初集
// （X-01 §1 constants 行 M4 收口：P2-13 落位本包——renderer 错误渲染需常量、C-M1 §1「DAO 业务码
// 透传」的落点；语义源＝C-06 §1 op 表；全集随 M5 C-06 任务卡冻结）。
// 字面量联合形见 ../dto/common.ts ErrorCode（脚本 scripts/check-shared-consts.mjs 双向核对）。
import type { ErrorCode } from '../dto/common';

/** HTTP API 错误码常量（02 §6.1：7 通用 + 8 业务，逐项一致） */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION-FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT-FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE-LIMITED',
  INTERNAL: 'INTERNAL',
  AUTH_INVALID_CREDENTIALS: 'AUTH-INVALID-CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH-EMAIL-TAKEN',
  AUTH_REFRESH_INVALID: 'AUTH-REFRESH-INVALID',
  MARKET_PACKAGE_NOT_FOUND: 'MARKET-PACKAGE-NOT-FOUND',
  MARKET_PACKAGE_NOT_APPROVED: 'MARKET-PACKAGE-NOT-APPROVED',
  MARKET_FILE_INVALID: 'MARKET-FILE-INVALID',
  REVIEW_ALREADY_DONE: 'REVIEW-ALREADY-DONE',
  ADMIN_USER_BANNED: 'ADMIN-USER-BANNED',
} as const satisfies Record<string, ErrorCode>;

/** storage DAO 业务错误码初集（X-01 §1 constants 行；全集随 M5 C-06 任务卡冻结；
 * 经 storage:invoke 以 IpcError.code 透传至 renderer，C-M1 §1 storage:invoke 行「DAO 业务码透传」） */
export const STORAGE_DAO_ERROR_CODES = {
  FLOW_NOT_FOUND: 'FLOW-NOT-FOUND',
  VERSION_NOT_FOUND: 'VERSION-NOT-FOUND',
  RUN_NOT_FOUND: 'RUN-NOT-FOUND',
  HIT_NOT_FOUND: 'HIT-NOT-FOUND',
  ACTIVE_RUN_EXISTS: 'ACTIVE-RUN-EXISTS',
} as const;

export type StorageDaoErrorCode = (typeof STORAGE_DAO_ERROR_CODES)[keyof typeof STORAGE_DAO_ERROR_CODES];
