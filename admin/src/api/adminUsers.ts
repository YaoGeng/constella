/**
 * admin 用户域 API + Query hooks（TDD-A-02 §3 useUsersQuery/useBanMutation/useUnbanMutation 行；
 * 对端=TDD-S-04 §1 三端点，DTO 形=X-01 ./dto/admin 冻结——AdminUsersRes/BanUserReq）。
 * - ⚠ 列表仅传 q/page（02 §6.3/S-04 端点未定义 pageSize——不擅自加参，页大小跟随 server 返回）；
 * - 缓存键=['admin','users',{q,page}]（A-01 §4 命名空间登记）；翻页 placeholderData 保留旧数据防清屏；
 * - 封禁/解封成功 → invalidate 整表 ['admin','users']（留痕语义下以 server 状态为准，不做行级乐观更新）；
 * - NOT-FOUND（行已失效）→ message 提示 + 同样失效重取（§1 错误处理列）。
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { AdminUsersRes } from '@constella/shared/dto'
import { message } from 'antd'
import { ApiError, get, post } from './client'

/** GET /api/admin/users?q=&page=（q 空串不携参——仅此二参，见文件头 ⚠） */
export function fetchUsers(q: string, page: number): Promise<AdminUsersRes> {
  const params = new URLSearchParams()
  if (q) {
    params.set('q', q)
  }
  params.set('page', String(page))
  return get<AdminUsersRes>(`/admin/users?${params.toString()}`)
}

/** POST /api/admin/users/:id/ban —— {reason} 必填（S-04 BanReq：trim 非空、max 500） */
export function banUser(id: string, reason: string): Promise<{ ok: true }> {
  return post(`/admin/users/${encodeURIComponent(id)}/ban`, { reason })
}

/** POST /api/admin/users/:id/unban —— body 无业务字段（{}） */
export function unbanUser(id: string): Promise<{ ok: true }> {
  return post(`/admin/users/${encodeURIComponent(id)}/unban`, {})
}

/** useUsersQuery（§3）：q/page 驱动列表查询；翻页/搜索期间保留旧数据（防清屏） */
export function useUsersQuery(q: string, page: number) {
  return useQuery({
    queryKey: ['admin', 'users', { q, page }],
    queryFn: () => fetchUsers(q, page),
    placeholderData: keepPreviousData,
  })
}

/** 操作失败 message 文案（code 原文保留展示——对账口径同 LoginPage） */
function mutationErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.body.error.message ? `（${err.body.error.message}）` : ''
    return `操作失败：${err.body.error.code}${detail}`
  }
  return '操作失败，请稍后再试'
}

/** §1 错误处理列：NOT-FOUND（行已失效）→ message + 自动刷新；其余错误仅 message */
function onMutationError(queryClient: QueryClient): (err: unknown) => void {
  return (err) => {
    void message.error(mutationErrorText(err), 5)
    if (err instanceof ApiError && err.body.error.code === 'NOT-FOUND') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    }
  }
}

/** useBanMutation（§3）：mutate({id,reason}) → 成功后 invalidate 整表 */
export function useBanMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) => banUser(input.id, input.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      void message.success('已封禁', 4)
    },
    onError: onMutationError(queryClient),
  })
}

/** useUnbanMutation（§3）：mutate({id,reason?}) → 成功后 invalidate 整表 */
export function useUnbanMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) => unbanUser(input.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      void message.success('已解封', 4)
    },
    onError: onMutationError(queryClient),
  })
}
