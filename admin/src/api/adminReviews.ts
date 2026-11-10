/**
 * admin 审核队列 API + Query hook（TDD-A-03 §3 useReviewQueueQuery 行；对端=TDD-S-03 §1 queue 端点，
 * DTO 形=X-01 ./dto/admin 冻结——ReviewQueueRes/ReviewQueueItem）。
 * - ⚠ 仅传 status/page（03 A-03 §1 端点表冻结面——pageSize 不传，页大小跟随 server 默认 20，A-02 同口径）；
 * - V1 固定 status=pending（02 §6.3 字面；D-7 最小集——status 切换 tab 为 A-03 扩展①，不在本卡）；
 * - 缓存键=['admin','reviews',page]（A-01 §4 命名空间登记）；翻页 placeholderData 保留旧数据防清屏；
 * - staleTime=0（§1 设计值，覆盖 App 级 30s 默认）：从 A-04 返回本页=组件重挂载即重取——
 *   防陈旧 pending 误导（S-03 409 并发语义的前端配合）。A-04 决策后另经 queryClient 失效
 *   ['admin','reviews'] 全局键协作（§4），非组件 import。
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReviewQueueRes } from '@constella/shared/dto'
import { get } from './client'

/** GET /api/admin/reviews?status=pending&page=（V1 固定 pending；仅此二参，见文件头 ⚠） */
export function fetchReviewQueue(page: number): Promise<ReviewQueueRes> {
  const params = new URLSearchParams()
  params.set('status', 'pending')
  params.set('page', String(page))
  return get<ReviewQueueRes>(`/admin/reviews?${params.toString()}`)
}

/** useReviewQueueQuery（§3）：page 驱动队列查询 → {data,isFetching}（含派生态全集，A-02 同款收窄面） */
export function useReviewQueueQuery(page: number) {
  return useQuery({
    queryKey: ['admin', 'reviews', page],
    queryFn: () => fetchReviewQueue(page),
    placeholderData: keepPreviousData,
    staleTime: 0,
  })
}
