/**
 * UsersPage 占位（TDD-A-01 路由表 /users 行）：A-02 尚未建页（T6-02 / TDD-A-02 持有）——
 * 本文件为最小占位常量组件，T6-02 整文件替换（保持 default export UsersPage 供 App.tsx lazy 引用）。
 */
import type { ReactNode } from 'react'
import { Typography } from 'antd'

export default function UsersPage(): ReactNode {
  return <Typography.Paragraph>用户管理（T6-02 占位）</Typography.Paragraph>
}
