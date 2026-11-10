/**
 * AuthSession（TDD-A-01 §1 会话签名逐字实现）：
 * - access 只存内存（15min，S-01 §1）——不落盘
 * - refresh=`localStorage['constella.admin.refreshToken']`（轮换后覆写；§1 会话存储策略冻结）
 * - bootstrap()：启动时有 refreshToken → POST /api/auth/refresh 静默续期（S-01 一次性轮换）
 * - login()：role!=ADMIN → 提示「非管理员账号」且不建立会话（02 §4 登录行 role=ADMIN 校验）
 * - logout()：清 access（内存）+ refresh（localStorage），跳 /login（经订阅者导航）
 *
 * 本模块是全应用唯一持久化落盘点（A-01 §4/§6.5）——localStorage 只在此文件出现。
 */
import type { LoginRes, UserProfile } from '@constella/shared/dto'
import { postLogin, postRefresh } from '../api/auth'
import { bindSession, type TokenPair } from '../api/client'

const REFRESH_TOKEN_KEY = 'constella.admin.refreshToken'

/** USER 账号在 admin 端登录被拒（登录接口本身 200，role 校验在会话建立前拦截） */
export class NonAdminError extends Error {
  constructor() {
    super('非管理员账号')
    this.name = 'NonAdminError'
  }
}

let accessToken: string | null = null
let currentUser: UserProfile | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

function readRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY)
}

function persistRefreshToken(token: string): void {
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

function clearRefreshToken(): void {
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/** login/bootstrap 成功路径：建立完整会话（内存 access + user，落盘 refresh） */
function establishSession(res: LoginRes): void {
  accessToken = res.accessToken
  currentUser = res.user
  persistRefreshToken(res.refreshToken)
  notify()
}

export const authSession = {
  /**
   * POST /api/auth/login（TDD-S-01 §1）——凭据错误时 server 401 AUTH-INVALID-CREDENTIALS（原样抛出）；
   * 200 但 role!=ADMIN → 抛 NonAdminError 且不建立会话（不写任何存储）。
   */
  async login(email: string, password: string): Promise<{ user: { id: string; email: string; role: string } }> {
    const res = await postLogin({ email, password })
    if (res.user.role !== 'admin') {
      throw new NonAdminError()
    }
    establishSession(res)
    return { user: { id: res.user.id, email: res.user.email, role: res.user.role } }
  },

  /** 清 access（内存）+ refresh（localStorage）；导航由订阅者（RequireAdmin 等经 useSyncExternalStore）承接 */
  logout(): void {
    accessToken = null
    currentUser = null
    clearRefreshToken()
    notify()
  },

  /**
   * 启动静默续期：有 refreshToken → POST /api/auth/refresh（S-01 一次性轮换——旧 token 即刻失效）。
   * 成功 → 建会话返 true；无 token/失败/非 ADMIN → 返 false（失败时清残留键，不留死会话）。
   */
  async bootstrap(): Promise<boolean> {
    const refreshToken = readRefreshToken()
    if (!refreshToken) {
      return false
    }
    try {
      const res = await postRefresh({ refreshToken })
      if (res.user.role !== 'admin') {
        authSession.logout()
        return false
      }
      establishSession(res)
      return true
    } catch {
      authSession.logout()
      return false
    }
  },

  /** access 只存内存（§1 签名——15min 有效期由 server 签发控制） */
  getAccessToken(): string | null {
    return accessToken
  },

  /** 当前管理员档案（未登录=null；requireAdmin 防御性兜底与 AdminLayout 展示用） */
  getUser(): UserProfile | null {
    return currentUser
  },

  isAuthenticated(): boolean {
    return currentUser !== null
  },

  /** useSyncExternalStore 订阅口（logout/会话建立时通知重渲染） */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// client ← session 晚绑定（api/client.ts SessionHooks；模块加载即注册，避免循环 import）：
// - 401 单飞刷新成功 → applyTokens（access 内存覆写 + refresh 落盘覆写；user 不变）
// - 刷新失败/重放仍 401 → onSessionExpired = logout()
bindSession({
  getAccessToken: () => authSession.getAccessToken(),
  getRefreshToken: () => readRefreshToken(),
  applyTokens: (pair: TokenPair) => {
    accessToken = pair.accessToken
    persistRefreshToken(pair.refreshToken)
  },
  onSessionExpired: () => authSession.logout(),
})
