// 三端统一错误渲染契约（X-01 §1 dto 行；02 §6.1 统一约定）。
// 值常量集 ERROR_CODES / STORAGE_DAO_ERROR_CODES 落位 ../constants/error-codes.ts（X-01 §1 constants 行）；
// 本文件冻结字面量联合（下方 15 项与 02 §6.1 错误码总表逐项一致，由 scripts/check-shared-consts.mjs 机械核对）。
export type ErrorCode =
  // 7 通用（02 §6.1：括号内为 HTTP 状态码）
  | 'VALIDATION-FAILED' // 400
  | 'UNAUTHORIZED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT-FOUND' // 404
  | 'CONFLICT' // 409
  | 'RATE-LIMITED' // 429
  | 'INTERNAL' // 500
  // 8 业务（02 §6.1）
  | 'AUTH-INVALID-CREDENTIALS'
  | 'AUTH-EMAIL-TAKEN'
  | 'AUTH-REFRESH-INVALID'
  | 'MARKET-PACKAGE-NOT-FOUND'
  | 'MARKET-PACKAGE-NOT-APPROVED'
  | 'MARKET-FILE-INVALID'
  | 'REVIEW-ALREADY-DONE'
  | 'ADMIN-USER-BANNED';

/** 错误码业务载荷（02 §6.1 错误结构 {"error":{code,message,requestId}} 的内层） */
export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  /** 请求留痕 id（server 全局 onRequest request_id；02 §5.1） */
  requestId?: string;
}

/** 统一错误响应体（02 §6.1 错误结构原文形） */
export interface ErrorBody {
  error: ErrorDetail;
}

/** 权限标签结果形（X-01 §1 dto 行；02 §6.2 包详情 perms、§12.2#1；demo L2875-2880 pubPermsOf 同源）：
 * 由 manifest 类目推导（C-05 PermDeriver / server 复核同源映射），六标签封闭集合。 */
export type PermLabel = 'CDP' | '网络' | '文件' | 'AI' | '交互' | '社媒';
