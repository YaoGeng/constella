/**
 * admin 看板 API + Query hook（TDD-A-05 §3 useStatsOverviewQuery 行；对端=TDD-S-04 §1 stats/overview 端点，
 * DTO 形=X-01 ./dto/admin 冻结——StatsOverview/DailyStat）。
 * - 缓存键=['admin','stats','overview']（A-01 §4 命名空间登记）；
 * - staleTime=60s（A-05 §3 设计值，覆盖 App 级 30s 默认——拉模式无推送，看板计数容忍分钟级陈旧：
 *   进入页面/staleTime 到期/手动刷新三触发，§0）；
 * - daily7d 空日补零=server 职责（S-04 §1）——前端不聚合不补桶，直绘七桶。
 */
import { useQuery } from '@tanstack/react-query'
import type { StatsOverview } from '@constella/shared/dto'
import { get } from './client'

/** GET /api/admin/stats/overview —— 五计数＋daily7d 七桶（无参数——窗口参数化=扩展点①，V2） */
export function fetchStatsOverview(): Promise<StatsOverview> {
  return get<StatsOverview>('/admin/stats/overview')
}

/** useStatsOverviewQuery（§3）：看板总览查询 → {data,isFetching,refetch}（含派生态全集，A-02/A-03 同款收窄面） */
export function useStatsOverviewQuery() {
  return useQuery({
    queryKey: ['admin', 'stats', 'overview'],
    queryFn: fetchStatsOverview,
    staleTime: 60_000,
  })
}
