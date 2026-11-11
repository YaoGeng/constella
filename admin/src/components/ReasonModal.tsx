/**
 * ReasonModal（TDD-A-01 §3）：理由弹窗——reason 必填、trim 非空；
 * 长度上限跟随 server Zod（前端不另造——S-04 banSchema max=500），经 maxLength 透传、缺省不设限。
 * 复用处：A-02 封禁、A-04 驳回/下架。
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Input, Modal, Space, Typography } from 'antd'

export interface ReasonModalProps {
  open: boolean
  title: string
  /** 提交（调用方负责关闭与 loading 态）；入参=trim 后的理由 */
  onSubmit(reason: string): void | Promise<void>
  onCancel?(): void
  /** 确认按钮 loading（提交进行中） */
  confirmLoading?: boolean
  /** 可选长度上限——逐字镜像对端 server Zod（如 A-02 ban reason=500）；不传则不另造上限 */
  maxLength?: number
}

export function ReasonModal({ open, title, onSubmit, onCancel, confirmLoading, maxLength }: ReasonModalProps): ReactNode {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 打开时清空上次输入与校验态
  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])

  const handleOk = (): void => {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setError('理由不能为空')
      return
    }
    if (maxLength !== undefined && trimmed.length > maxLength) {
      setError(`理由长度不能超过 ${maxLength} 字`)
      return
    }
    setError(null)
    void onSubmit(trimmed)
  }

  return (
    <Modal
      open={open}
      title={title}
      okText="提交"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      confirmLoading={confirmLoading}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Input.TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          status={error ? 'error' : undefined}
          rows={4}
          placeholder="请输入理由（必填，将随操作留痕）"
          maxLength={maxLength}
          showCount={maxLength !== undefined}
        />
        {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      </Space>
    </Modal>
  )
}
