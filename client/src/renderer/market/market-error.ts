// market 域类型化错误（T5-09；TDD-C-09 §3 MarketApiClient 行——ErrorBody（code+requestId）
// 解析 / 超时与网络错误分类（离线判定输入）；02 §6.1 统一错误体 {error:{code,message,requestId}}）。
//
// 消费方：本卡 hooks/LoginDialog/MarketBrowser；T5-10 Installer/Publisher（UNAUTHORIZED→
// 登录引导）；T5-11 OfflineDegradation（TransportFailureKind=离线判定输入枚举——接口先定）。
import { ERROR_CODES } from '@constella/shared/constants';
import type { ErrorCode } from '@constella/shared/dto';

/** 传输层失败分类——离线判定输入枚举（03 C-09 §3「超时与网络错误分类（离线判定输入）」；
 * T5-11 OfflineDegradation 消费：network=疑似离线、timeout=降级观察。 */
export type TransportFailureKind = 'network' | 'timeout';

/** 错误码字面量合法集（ErrorBody 解析时未知 code → INTERNAL 兜底，不臆造联合外字面量） */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

/** server 统一错误体（ErrorBody）的类型化呈现——code/status/requestId 逐字段（02 §6.1） */
export class MarketApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId?: string;

  constructor(code: ErrorCode, message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'MarketApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/** 传输层错误（fetch 网络拒绝/超时中止）——kind=离线判定输入（T5-11 消费） */
export class MarketTransportError extends Error {
  readonly kind: TransportFailureKind;
  readonly cause?: unknown;

  constructor(kind: TransportFailureKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'MarketTransportError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** 未登录前置拦截（§6.2 四操作零外发）——UI 捕获→登录引导弹窗（LoginDialog） */
export class MarketUnauthorizedError extends Error {
  constructor() {
    super('登录后才能执行该操作');
    this.name = 'MarketUnauthorizedError';
  }
}

/** market.baseUrl 未配置（默认空＋首次使用引导——03 §7.3#2）——UI 捕获→首次使用引导面板 */
export class MarketUnconfiguredError extends Error {
  constructor() {
    super('广场服务地址未配置（settings market.baseUrl 为空）');
    this.name = 'MarketUnconfiguredError';
  }
}

export function isMarketApiError(e: unknown): e is MarketApiError {
  return e instanceof MarketApiError;
}

export function isMarketTransportError(e: unknown): e is MarketTransportError {
  return e instanceof MarketTransportError;
}

export function isMarketUnauthorizedError(e: unknown): e is MarketUnauthorizedError {
  return e instanceof MarketUnauthorizedError;
}

export function isMarketUnconfiguredError(e: unknown): e is MarketUnconfiguredError {
  return e instanceof MarketUnconfiguredError;
}

/** 错误体解析（Response → MarketApiError）：{error:{code,message,requestId?}} 合法形直译；
 * 未知 code/不可解析体 → INTERNAL 兜底（不抛裸错误——调用方只见类型化错误）。 */
export async function toMarketApiError(res: Response): Promise<MarketApiError> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return new MarketApiError('INTERNAL', `HTTP ${res.status}`, res.status);
  }
  if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
    const detail = (parsed as { error: unknown }).error;
    if (detail !== null && typeof detail === 'object' && 'code' in detail && 'message' in detail) {
      const { code, message, requestId } = detail as { code: unknown; message: unknown; requestId?: unknown };
      if (typeof code === 'string' && typeof message === 'string') {
        if (KNOWN_CODES.has(code)) {
          return new MarketApiError(
            code as ErrorCode,
            message,
            res.status,
            typeof requestId === 'string' ? requestId : undefined,
          );
        }
      }
    }
  }
  return new MarketApiError('INTERNAL', `HTTP ${res.status}`, res.status);
}
