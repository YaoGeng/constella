/**
 * PermTags（TDD-A-01 §3）：PermLabel[] → antd Tag 预设色（六标签封闭集——X-01 ./dto PermLabel）。
 * 复用处：A-03 审核队列列表、A-04 包详情。
 */
import type { ReactNode } from 'react'
import { Tag } from 'antd'
import type { PermLabel } from '@constella/shared/dto'

/** 六标签预设色（antd Tag preset color；视觉区分度优先——A-03/A-04 统一消费） */
const PERM_COLORS: Record<PermLabel, string> = {
  CDP: 'purple',
  网络: 'geekblue',
  文件: 'gold',
  AI: 'magenta',
  交互: 'cyan',
  社媒: 'green',
}

export function PermTags({ perms }: { perms: PermLabel[] }): ReactNode {
  if (perms.length === 0) {
    return <Tag>无权限声明</Tag>
  }
  return (
    <>
      {perms.map((perm) => (
        <Tag key={perm} color={PERM_COLORS[perm]}>
          {perm}
        </Tag>
      ))}
    </>
  )
}
