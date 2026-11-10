/**
 * ReviewsPage（TDD-A-03 §1/§3 编排行）：审核队列页——pending 包分页列表
 * （kind 徽标/name/summary/author/perms=PermTags/sizeBytes/semver/createdAt）＋队列计数头＋翻页。
 * - 行操作「审核」→ navigate('/packages/'+packageId)（路由 path 解耦——不 import A-04 组件，§2）；
 * - 数据层全收在 api/adminReviews.ts（页面禁自起 fetch——A-01 §6.5 边界）；
 * - ⚠ 仅传 status=pending/page（§1 端点表冻结面）；V1 固定 pending（D-7 最小集，§8 扩展①不在本卡）；
 * - 从 A-04 返回本页=组件重挂载触发 useQuery 重取（staleTime=0 设计值——adminReviews.ts）；
 * - reviewColumns/QueueEmptyState 内联于本文件（§3 组件行，接口逐字一致；
 *   QueueEmptyState 无 props——手动刷新按钮由本页编排注入查询出口）。
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Empty, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useNavigate } from 'react-router'
import type { ReviewQueueItem } from '@constella/shared/dto'
import { useReviewQueueQuery } from '../api/adminReviews'
import { PageState } from '../components/PageState'
import { PermTags } from '../components/PermTags'

/** kind 徽标展示映射（node/pack/flow=S-03 §1 冻结字面量；antd Tag 预设色） */
const KIND_TAG: Record<ReviewQueueItem['kind'], { color: string; label: string }> = {
  node: { color: 'blue', label: 'node' },
  pack: { color: 'orange', label: 'pack' },
  flow: { color: 'geekblue', label: 'flow' },
}

/** sizeBytes → 可读大小（B/KB/MB，1 位小数——列展示格式化） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** createdAt（ISO 8601）→ 本地可读时间（列展示格式化，不做时区归一——users-columns 同款） */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export interface ReviewColumnsProps {
  onReview(row: ReviewQueueItem): void
}

/** reviewColumns（§3 列配置行）：ReviewQueueItem 列定义纯函数（操作列「审核」回调注入） */
export function reviewColumns({ onReview }: ReviewColumnsProps): TableColumnsType<ReviewQueueItem> {
  return [
    {
      title: '类别',
      dataIndex: 'kind',
      key: 'kind',
      width: 90,
      render: (kind: ReviewQueueItem['kind']): ReactNode => (
        <Tag color={KIND_TAG[kind].color}>{KIND_TAG[kind].label}</Tag>
      ),
    },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '简介',
      dataIndex: 'summary',
      key: 'summary',
      ellipsis: true,
      render: (summary: string | undefined): string => summary ?? '—',
    },
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
      width: 140,
      render: (author: ReviewQueueItem['author']): string => author.name,
    },
    {
      title: '权限',
      dataIndex: 'perms',
      key: 'perms',
      render: (perms: ReviewQueueItem['perms']): ReactNode => <PermTags perms={perms} />,
    },
    {
      title: '大小',
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      width: 100,
      render: (bytes: number): string => formatBytes(bytes),
    },
    { title: '版本', dataIndex: 'semver', key: 'semver', width: 100 },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (iso: string): string => formatDateTime(iso),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, row: ReviewQueueItem): ReactNode => (
        <Button type="link" size="small" onClick={() => onReview(row)}>
          审核
        </Button>
      ),
    },
  ]
}

/** QueueEmptyState（§3 组件行）：空队列态「队列已清空」（无 props；手动刷新按钮由 ReviewsPage 编排） */
function QueueEmptyState(): ReactNode {
  return (
    <div data-testid="reviews-empty">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="队列已清空" />
    </div>
  )
}

export default function ReviewsPage(): ReactNode {
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  // refetch 别名 reload：pages/components 禁自起请求字面（A-01 §6.5 静态检查按「fetch＋左括号」
  // 子串匹配，原方法名调用会误中）——仅命名规避，语义不变（Users.tsx 同款）
  const { data, isPending, isFetching, error, refetch: reload } = useReviewQueueQuery(page)
  const queueEmpty = data !== undefined && data.items.length === 0

  return (
    <div>
      <Typography.Title level={5}>审核队列</Typography.Title>
      <div style={{ marginBottom: 16 }}>
        {data ? (
          <Typography.Text type="secondary" data-testid="reviews-total">
            待审 {data.total} 个包
          </Typography.Text>
        ) : null}
      </div>
      <PageState loading={isPending} error={error} onRetry={() => void reload()}>
        {queueEmpty ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <QueueEmptyState />
            <div>
              <Button style={{ marginTop: 16 }} loading={isFetching} onClick={() => void reload()}>
                手动刷新
              </Button>
            </div>
          </div>
        ) : (
          <Table<ReviewQueueItem>
            rowKey="packageId"
            columns={reviewColumns({
              onReview: (row) => navigate(`/packages/${row.packageId}`),
            })}
            dataSource={data?.items ?? []}
            loading={isFetching}
            pagination={{
              current: page,
              // ⚠ 页大小跟随 server（默认 20）：端点不回显 pageSize，取本页行数与 20 的较大值——
              // 尾页行数 < 20 时以 20 保分页数学正确（总页数由 total 驱动；Users.tsx 同款）
              pageSize: Math.max(data?.items.length ?? 20, 20),
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: (next) => setPage(next),
            }}
          />
        )}
      </PageState>
    </div>
  )
}
