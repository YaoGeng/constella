/**
 * DashboardPage 占位（TDD-A-01 路由表 /dashboard 行；登录后默认落地——设计值，02 未定）：
 * A-05 尚未建页（T6-05 / TDD-A-05 持有）——本文件为最小占位常量组件，
 * T6-05 整文件替换（保持 default export DashboardPage）。
 */
import type { ReactNode } from 'react'
import { Typography } from 'antd'

export default function DashboardPage(): ReactNode {
  return (
    <div>
      <Typography.Title level={5}>运营看板</Typography.Title>
      <Typography.Paragraph type="secondary">统计总览（T6-05 占位）</Typography.Paragraph>
    </div>
  )
}
