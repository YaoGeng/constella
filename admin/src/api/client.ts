/**
 * ApiClient（TDD-A-01 §1）：admin 端唯一 HTTP 出口——A-02~05 hooks 禁自起 fetch，一律经 request<T>()。
 * - baseURL `/api`（dev=Vite server.proxy → http://127.0.0.1:8051；生产与 server 同域经反代免 CORS，
 *   部署标准 §5.3/§8 步 4——与 S-01 K3 同口径）
 * - 自动注入 `Authorization: Bearer`（access 只存内存，由 session 模块经 bindSession 晚绑定供给）
 * - 非 2xx → 解析 ErrorBody（X-01 `@constella/shared/dto`）抛 ApiError
 * - 401 → 单飞 POST /api/auth/refresh（并发请求共享同一刷新 promise——S-01 C4 一次性轮换只许一发）
 *   → 重放原请求恰一次 → 仍 401 → onSessionExpired()（=logout()）
 *
 * 分层（A-01 §2）：本文件属骨架层，只 import X-01 类型；不 import server/client 任何代码。
 */
import type { ErrorBody } from '@constella/shared/dto'

/** 统一 API 错误：非 2xx 响应解析出的 ErrorBody（code/message/requestId——对账 server 请求日志） */
export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorBody

  constructor(status: number, body: ErrorBody) {
    super(body.error.message || body.error.code)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** 令牌对（login/refresh 响应的子集形；完整形=X-01 LoginRes） */
export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * 会话晚绑定接口（client ← session 单向：authSession.ts 模块加载时 bindSession 注册，
 * 避免 client ↔ session 循环 import；token 存取全收在 session 模块——§6.5 唯一落盘点）。
 */
export interface SessionHooks {
  getAccessToken(): string | null
  getRefreshToken(): string | null
  applyTokens(pair: TokenPair): void
  onSessionExpired(): void
}

let hooks: SessionHooks | null = null

/** 由 session/authSession.ts 在模块加载时注册（幂等——后注册覆盖） */
export function bindSession(h: SessionHooks): void {
  hooks = h
}

const BASE_URL = '/api'

/** 公开 auth 端点前缀：不注入 Bearer、不触发 401 刷新链路（login 自身 401=凭据错误，须原样抛给页面） */
const PUBLIC_AUTH_PREFIX = '/auth/'

/** 非 JSON 错误体（反代 502/网络中断等）归一为 ErrorBody 形（code 收口 INTERNAL） */
function fallbackBody(status: number, requestId: string | null): ErrorBody {
  return {
    error: {
      code: 'INTERNAL',
      message: `HTTP ${status}`,
      ...(requestId ? { requestId } : {}),
    },
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('X-Request-Id')
  let body: ErrorBody | null = null
  try {
    const parsed: unknown = await res.json()
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'object' &&
      (parsed as { error: object }).error !== null
    ) {
      body = parsed as ErrorBody
    }
  } catch {
    // 非 JSON 体走 fallback
  }
  return new ApiError(res.status, body ?? fallbackBody(res.status, requestId))
}

/** 低层请求：无鉴权机械的裸出口 + ErrorBody 解析（api/auth.ts 与 401 刷新单飞复用） */
export async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

// —— 401 单飞刷新（并发共享同一 promise；一次性轮换语义下同一 refresh token 只发一发）——

let refreshInflight: Promise<boolean> | null = null

async function refreshOnce(): Promise<boolean> {
  const refreshToken = hooks?.getRefreshToken()
  if (!refreshToken) {
    return false
  }
  try {
    const pair = await http<TokenPair>('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    hooks?.applyTokens(pair)
    return true
  } catch {
    return false
  }
}

function refreshSingleflight(): Promise<boolean> {
  if (!refreshInflight) {
    refreshInflight = refreshOnce().finally(() => {
      refreshInflight = null
    })
  }
  return refreshInflight
}

/**
 * 统一请求出口：Bearer 注入 + 401 单飞刷新重放。
 * @param path 以 `/` 开头的 API 路径（如 `/admin/users`——不含 `/api` 前缀）
 * @param isReplay 内部标记：true=刷新后的重放（恰一次，再 401 即终结会话）
 */
export async function request<T>(path: string, init: RequestInit = {}, isReplay = false): Promise<T> {
  const headers = new Headers(init.headers)
  const token = hooks?.getAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (res.status === 401 && !path.startsWith(PUBLIC_AUTH_PREFIX)) {
    if (!isReplay) {
      const refreshed = await refreshSingleflight()
      if (refreshed) {
        return request<T>(path, init, true)
      }
    }
    // 无 refresh 可刷 / 刷新失败 / 重放仍 401 → 会话终结（logout 清内存+落盘并跳 /login）
    hooks?.onSessionExpired()
  }

  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

/** 快捷方法（A-02~05 hooks 用） */
export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
