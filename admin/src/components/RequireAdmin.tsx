/**
 * RequireAdmin（TDD-A-01 §1/§3）：受守卫路由的会话门——
 * 无会话 → <Navigate to="/login" replace>；登录时已拦 role!=ADMIN（authSession.login），
 * 此处仅防御性兜底（会话中 user 恒为 admin——bootstrap 同口径过滤）。
 * 会话经 useSyncExternalStore 订阅：任何路径 logout()（含 ApiClient 401 终结）即时重定向。
 */
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Navigate } from 'react-router'
import { authSession } from '../session/authSession'

export function RequireAdmin({ children }: { children: ReactNode }): ReactNode {
  const authenticated = useSyncExternalStore(
    authSession.subscribe,
    () => authSession.isAuthenticated(),
  )
  if (!authenticated) {
    return <Navigate to="/login" replace />
  }
  return children
}
