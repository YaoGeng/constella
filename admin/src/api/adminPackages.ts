/**
 * admin 包详情工作台 API + Query/Mutation hooks（TDD-A-04 §3；对端=TDD-S-03 §1 detail/review/offline/
 * download 四端点，DTO 形=X-01 ./dto/admin 冻结——AdminPackageDetail/ReviewDecision/ReviewDecisionRes/
 * OfflinePackageReq）。
 * - 缓存键=['admin','package',id]（A-01 §4 命名空间登记）；staleTime=0（A-03 同款口径：工作台以 server
 *   现状为准——失效/进入即重取，409 并发语义的前端配合：按实际 status 重渲染，无本地状态机副本）；
 * - 决策/offline 成功与 409 REVIEW-ALREADY-DONE → 一律失效 ['admin','package',id]＋['admin','reviews']
 *   （§4 全局键名协作，非组件 import）；409 提示「已被其他管理员处理」且不自动重试（S-03 §1 并发语义：
 *   两管理员并发审同包恰一成功，后到方以 server 实态为准——offline 的并发 409 同码同承接）；
 * - 下载预检=唯一非 JSON 出口（zip 流）：client.ts request<T> 恒 res.json()（X-01 JSON 形约定）且本卡
 *   不动骨架层——按 ApiClient 同一约定（/api 前缀＋Bearer 注入＋ApiError 解析）就地取 blob；
 * - 状态字面量零出现（§6.3 reviewer 核对项）：本文件只透传 server 响应字段——动作适配在
 *   pages/package-actions.tsx、展示映射在 pages/package-sections.tsx。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type {
  AdminPackageDetail,
  ErrorBody,
  OfflinePackageReq,
  ReviewDecision,
  ReviewDecisionRes,
} from '@constella/shared/dto'
import { message } from 'antd'
import { authSession } from '../session/authSession'
import { ApiError, get, post } from './client'

/** GET /api/admin/packages/:id —— 工作台详情聚合（元数据/manifest 摘要/versions/计量计数） */
export function fetchPackageDetail(id: string): Promise<AdminPackageDetail> {
  return get<AdminPackageDetail>(`/admin/packages/${encodeURIComponent(id)}`)
}

/** usePackageDetailQuery（§3）：id 驱动详情查询（id 空=禁用——路由参数缺位防御） */
export function usePackageDetailQuery(id: string) {
  return useQuery({
    queryKey: ['admin', 'package', id],
    queryFn: () => fetchPackageDetail(id),
    enabled: id.length > 0,
    staleTime: 0,
  })
}

/** POST /api/admin/packages/:id/review —— {action,reason?}（reject 必填 reason——前端 ReasonModal 拦截） */
export function reviewDecision(id: string, input: ReviewDecision): Promise<ReviewDecisionRes> {
  return post<ReviewDecisionRes>(`/admin/packages/${encodeURIComponent(id)}/review`, input)
}

/** POST /api/admin/packages/:id/offline —— {reason} 必填（下架留痕） */
export function takePackageOffline(id: string, input: OfflinePackageReq): Promise<ReviewDecisionRes> {
  return post<ReviewDecisionRes>(`/admin/packages/${encodeURIComponent(id)}/offline`, input)
}

/** 决策/offline 后统一失效（§4：详情＋审核队列——队列行随决策出队） */
function invalidatePackageAndQueue(queryClient: QueryClient, id: string): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'package', id] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] })
}

/**
 * §1 错误处理列（review/offline 两端点统一）：409 REVIEW-ALREADY-DONE → 失效后按实际 status 重渲染
 * ＋「已被其他管理员处理」（不自动重试）；其余错误 code 原文展示（对账口径同 adminUsers）。
 */
function onDecisionError(queryClient: QueryClient, id: string): (err: unknown) => void {
  return (err) => {
    if (err instanceof ApiError && err.status === 409 && err.body.error.code === 'REVIEW-ALREADY-DONE') {
      invalidatePackageAndQueue(queryClient, id)
      void message.warning('已被其他管理员处理', 5)
      return
    }
    const detail = err instanceof ApiError && err.body.error.message ? `（${err.body.error.message}）` : ''
    void message.error(`操作失败：${err instanceof ApiError ? err.body.error.code : '请稍后再试'}${detail}`, 5)
  }
}

/** useReviewDecisionMutation（§3 ActionPanel 消费）：mutate({action,reason}) → 成功失效详情＋队列 */
export function useReviewDecisionMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReviewDecision) => reviewDecision(id, input),
    onSuccess: () => invalidatePackageAndQueue(queryClient, id),
    onError: onDecisionError(queryClient, id),
  })
}

/** useOfflineMutation（§3 ActionPanel 消费）：mutate({reason}) → 成功失效详情＋队列（下架终态） */
export function useOfflineMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OfflinePackageReq) => takePackageOffline(id, input),
    onSuccess: () => invalidatePackageAndQueue(queryClient, id),
    onError: onDecisionError(queryClient, id),
  })
}

/** 非 JSON 错误体归一 ErrorBody（client.ts toApiError 同构——本卡不扩骨架出口） */
async function toApiErrorLike(res: Response): Promise<ApiError> {
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
  return new ApiError(res.status, body ?? { error: { code: 'INTERNAL', message: `HTTP ${res.status}` } })
}

/** 下载文件名：Content-Disposition 对齐（server 恒 attachment; filename="<semver>.zip"）——缺头/未匹配回退 <semver>.zip */
function filenameFromDisposition(header: string | null, fallback: string): string {
  const m = header !== null ? /filename="?([^";]+)"?/.exec(header) : null
  const matched = m?.[1]
  return matched !== undefined && matched.length > 0 ? matched : fallback
}

/**
 * GET /api/admin/packages/:id/download —— 下载预检（✅ M4 #9）：zip 流取 blob（S-05 getStream 透传），
 * 由 DownloadPrecheck 以 a[download] 落 <semver>.zip。唯一非 JSON 出口：client.ts request<T> 恒
 * res.json() 且本卡冻结面不动骨架——按 ApiClient 同一约定（/api 前缀＋Bearer 注入＋ApiError 解析）
 * 就地实现；401 单飞刷新链路为骨架私有不外泄——预检为显式按钮可重点，access 过期边缘以 ApiError 呈现。
 */
export async function downloadPackageZip(
  id: string,
  semver: string,
): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {}
  const token = authSession.getAccessToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`/api/admin/packages/${encodeURIComponent(id)}/download`, { headers })
  if (!res.ok) {
    throw await toApiErrorLike(res)
  }
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition'), `${semver}.zip`),
  }
}
