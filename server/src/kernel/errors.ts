/**
 * ErrorContract（TDD-S-01 §1 C2/K3；T2-01）：统一错误体 + 错误码→HTTP 状态映射。
 * 状态映射表本卡冻结（02 §6.1 总表 + 业务码映射：AUTH-EMAIL-TAKEN→409、
 * AUTH-INVALID-CREDENTIALS/AUTH-REFRESH-INVALID/ADMIN-USER-BANNED→401、
 * MARKET-PACKAGE-NOT-FOUND/APPROVED→404、MARKET-FILE-INVALID→400、REVIEW-ALREADY-DONE→409）。
 * 错误码字面量联合＝X-01 shared ./dto/common ErrorCode（类型归 X-01，本文件只持映射常量）。
 */
import type { ErrorBody, ErrorCode } from "@constella/shared/dto";

/** httpStatusOf 返回域（02 §6.1 总表的状态集合） */
export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

/** 错误码→HTTP 状态映射（本卡冻结；Record<ErrorCode,…> 让 tsc 保证全集穷尽） */
const HTTP_STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  "VALIDATION-FAILED": 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  "NOT-FOUND": 404,
  CONFLICT: 409,
  "RATE-LIMITED": 429,
  INTERNAL: 500,
  "AUTH-INVALID-CREDENTIALS": 401,
  "AUTH-EMAIL-TAKEN": 409,
  "AUTH-REFRESH-INVALID": 401,
  "MARKET-PACKAGE-NOT-FOUND": 404,
  "MARKET-PACKAGE-NOT-APPROVED": 404,
  "MARKET-FILE-INVALID": 400,
  "REVIEW-ALREADY-DONE": 409,
  "ADMIN-USER-BANNED": 401,
};

/** 默认错误文案（handler 可用自定义 message 覆盖） */
const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  "VALIDATION-FAILED": "Invalid input",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Forbidden",
  "NOT-FOUND": "Not found",
  CONFLICT: "Conflict",
  "RATE-LIMITED": "Too many requests",
  INTERNAL: "Internal server error",
  "AUTH-INVALID-CREDENTIALS": "Invalid email or password",
  "AUTH-EMAIL-TAKEN": "Email already registered",
  "AUTH-REFRESH-INVALID": "Invalid or expired refresh token",
  "MARKET-PACKAGE-NOT-FOUND": "Package not found",
  "MARKET-PACKAGE-NOT-APPROVED": "Package not approved for download",
  "MARKET-FILE-INVALID": "Invalid package file",
  "REVIEW-ALREADY-DONE": "Review already done",
  "ADMIN-USER-BANNED": "User account is banned",
};

/** 错误码→HTTP 状态（本卡冻结的映射表唯一入口） */
export function httpStatusOf(code: ErrorCode): HttpStatus {
  return HTTP_STATUS_BY_CODE[code];
}

/** 默认文案查询（补全 handler 未指定 message 的场景） */
export function defaultMessageOf(code: ErrorCode): string {
  return MESSAGE_BY_CODE[code];
}

/** 统一错误体构造：形＝X-01 ./dto ErrorBody（02 §6.1 错误结构原文形） */
export function errorBody(code: ErrorCode, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

/**
 * 业务错误异常：handler 抛出→全局 onError 统一渲染。
 * status 由冻结映射表派生，不允许绕过表单独指定状态。
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: HttpStatus;

  constructor(code: ErrorCode, message: string = defaultMessageOf(code)) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = httpStatusOf(code);
  }
}
