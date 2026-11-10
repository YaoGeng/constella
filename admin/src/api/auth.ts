/**
 * auth 域 API（TDD-A-01 §1）：login/refresh 走公开端点（无 Bearer、不触发 401 刷新链路）——
 * 端点契约=TDD-S-01 §1（POST /api/auth/login → 200 {accessToken,refreshToken,user}；
 * POST /api/auth/refresh → 200 新对·一次性轮换）。DTO 形以 X-01 ./dto/auth 为源型。
 */
import type { LoginReq, LoginRes, RefreshReq, RefreshRes } from '@constella/shared/dto'
import { http } from './client'

export function postLogin(body: LoginReq): Promise<LoginRes> {
  return http<LoginRes>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function postRefresh(body: RefreshReq): Promise<RefreshRes> {
  return http<RefreshRes>('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
