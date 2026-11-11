/**
 * 包详情动作分区（TDD-A-04 §1 动作区/§3 两组件行）：ActionPanel（status→动作集适配）＋DownloadPrecheck
 * （下载预检按钮）。动作适配=本文件（状态字面量允许处之一——§6.3）；409 的失效＋「已被其他管理员处理」
 * 提示统一收在 api/adminPackages.ts（onError），本层只补每动作的成功后交互：
 * - 通过 → onDone()（页面注入 navigate('/reviews')——§1 设计值；禁 import A-03 组件，§2）；
 * - 驳回/下架 → 停留本页（失效重取后按新 status 只读重渲染）；REJECTED/OFFLINE → 不渲染动作区（只读）。
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Popconfirm, Space, message } from 'antd'
import type { AdminPackageDetail } from '@constella/shared/dto'
import { downloadPackageZip, useOfflineMutation, useReviewDecisionMutation } from '../api/adminPackages'
import { ApiError } from '../api/client'
import { ReasonModal } from '../components/ReasonModal'

/** 理由长度上限——逐字镜像对端 Zod（S-03 reviewDecisionSchema/offlineSchema reason max=500），前端不另造 */
const REASON_MAX = 500

export interface ActionPanelProps {
  pkg: AdminPackageDetail
  /** approve 成功后的离页回调（页面注入回队列导航——动作文件不直接耦合路由跳转语义） */
  onDone(): void
}

/** ActionPanel（§3）：status 适配动作集（pending→通过/驳回；approved→下架；rejected/offline→只读无动作区） */
export function ActionPanel({ pkg, onDone }: ActionPanelProps): ReactNode {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const reviewMutation = useReviewDecisionMutation(pkg.id)
  const offlineMutation = useOfflineMutation(pkg.id)

  switch (pkg.status) {
    case 'pending':
      return (
        <div data-testid="pkg-actions">
          <Space>
            <Popconfirm
              title="确认通过该包？"
              okText="确认通过"
              cancelText="取消"
              onConfirm={() =>
                reviewMutation.mutate({ action: 'approve' }, { onSuccess: onDone })
              }
            >
              <Button type="primary" data-testid="pkg-action-approve">
                通过
              </Button>
            </Popconfirm>
            <Button danger data-testid="pkg-action-reject" onClick={() => setRejectOpen(true)}>
              驳回
            </Button>
          </Space>
          <ReasonModal
            open={rejectOpen}
            title={`驳回包：${pkg.name}`}
            maxLength={REASON_MAX}
            confirmLoading={reviewMutation.isPending}
            onSubmit={(reason) =>
              reviewMutation.mutate(
                { action: 'reject', reason },
                {
                  onSuccess: () => {
                    setRejectOpen(false)
                    void message.success('已驳回', 4)
                  },
                  // 出错同样收起弹窗（409 时页面已失效重取转实态动作集——Users.tsx 同款先例）
                  onError: () => setRejectOpen(false),
                },
              )
            }
            onCancel={() => setRejectOpen(false)}
          />
        </div>
      )
    case 'approved':
      return (
        <div data-testid="pkg-actions">
          <Button danger data-testid="pkg-action-offline" onClick={() => setOfflineOpen(true)}>
            下架
          </Button>
          <ReasonModal
            open={offlineOpen}
            title={`下架包：${pkg.name}`}
            maxLength={REASON_MAX}
            confirmLoading={offlineMutation.isPending}
            onSubmit={(reason) =>
              offlineMutation.mutate(
                { reason },
                {
                  onSuccess: () => {
                    setOfflineOpen(false)
                    void message.success('已下架', 4)
                  },
                  onError: () => setOfflineOpen(false),
                },
              )
            }
            onCancel={() => setOfflineOpen(false)}
          />
        </div>
      )
    case 'rejected':
    case 'offline':
      // 只读终态——无动作区（§1；OFFLINE 重上架=V2 扩展点①，随 S-03）
      return null
  }
}

/** DownloadPrecheck（§3）：下载预检按钮——ApiClient 流式取包 → a[download] 落 <semver>.zip（全状态可预检） */
export function DownloadPrecheck({ id, semver }: { id: string; semver: string }): ReactNode {
  const [downloading, setDownloading] = useState(false)

  const start = async (): Promise<void> => {
    setDownloading(true)
    try {
      const { blob, filename } = await downloadPackageZip(id, semver)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      // §1 错误处理列：NOT-FOUND → 「包不存在」；其余 code 原文展示（对账 server 请求日志）
      const code = err instanceof ApiError ? err.body.error.code : ''
      void message.error(code === 'NOT-FOUND' ? '包不存在' : `下载失败：${code || '请稍后再试'}`, 5)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Button data-testid="pkg-download" loading={downloading} onClick={() => void start()}>
      下载预检
    </Button>
  )
}
