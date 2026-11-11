/**
 * PageState（TDD-A-01 §3）：loading/empty/error 三态公共件（透传 TanStack Query 派生态）。
 * error 展示 code+requestId（便于对账 server 请求日志——02 §5.1 每请求一行日志）。
 * 复用处：A-02~05 全部页面。本组件不发起任何请求——数据出口一律经 api/client。
 */
import type { ReactNode } from 'react'
import { Alert, Button, Empty, Flex, Spin } from 'antd'
import { ApiError } from '../api/client'

export interface PageStateProps {
  loading?: boolean
  /** TanStack Query 的 error（unknown——经 instanceof ApiError 收窄展示契约字段） */
  error?: unknown
  empty?: boolean
  onRetry?(): void
  children?: ReactNode
}

export function PageState({ loading = false, error, empty = false, onRetry, children }: PageStateProps): ReactNode {
  if (error) {
    const detail =
      error instanceof ApiError
        ? {
            message: `${error.body.error.code}`,
            description: [
              error.body.error.message,
              error.body.error.requestId ? `requestId: ${error.body.error.requestId}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }
        : { message: '加载失败', description: error instanceof Error ? error.message : String(error) }
    return (
      <Alert
        type="error"
        showIcon
        message={detail.message}
        description={detail.description}
        action={
          onRetry ? (
            <Button size="small" danger onClick={onRetry}>
              重试
            </Button>
          ) : undefined
        }
      />
    )
  }
  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flex>
    )
  }
  if (empty) {
    return <Empty description="暂无数据" />
  }
  return children
}
