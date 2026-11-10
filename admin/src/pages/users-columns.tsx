/**
 * usersColumns（TDD-A-02 §3 列配置行）：AdminUserRow 列定义纯函数——
 * role=Tag / status=Badge / createdAt 格式化 / packageCount；
 * 操作列按行内 status 渲染（ACTIVE→封禁、BANNED→解封），
 * role=ADMIN 行的封禁外加二次确认 Popconfirm（§1 防自锁设计值——S-04 未禁止）。
 */
import type { ReactNode } from 'react'
import { Badge, Button, Popconfirm, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import type { AdminUserRow, UserRole, UserStatus } from '@constella/shared/dto'

export interface UsersColumnsProps {
  onBan(row: AdminUserRow): void
  onUnban(row: AdminUserRow): void
}

/** 角色展示映射（role=Tag） */
const ROLE_TAG: Record<UserRole, { color: string; label: string }> = {
  user: { color: 'default', label: 'USER' },
  admin: { color: 'gold', label: 'ADMIN' },
}

/** 状态展示映射（status=Badge；user status 唯一权威=server 响应，见 §0 边界） */
const STATUS_BADGE: Record<UserStatus, { status: 'success' | 'error'; text: string }> = {
  active: { status: 'success', text: '正常' },
  banned: { status: 'error', text: '已封禁' },
}

/** createdAt（ISO 8601）→ 本地可读时间（列展示格式化，不做时区归一） */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export function usersColumns({ onBan, onUnban }: UsersColumnsProps): TableColumnsType<AdminUserRow> {
  return [
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: UserRole): ReactNode => <Tag color={ROLE_TAG[role].color}>{ROLE_TAG[role].label}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: UserStatus): ReactNode => (
        <Badge status={STATUS_BADGE[status].status} text={STATUS_BADGE[status].text} />
      ),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (iso: string): string => formatDateTime(iso),
    },
    { title: '包数量', dataIndex: 'packageCount', key: 'packageCount', width: 90 },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_: unknown, row: AdminUserRow): ReactNode =>
        row.status === 'active' ? (
          row.role === 'admin' ? (
            <Popconfirm
              title="该账号为 ADMIN"
              description="封禁后此管理员将无法登录管理端，确认继续？"
              okText="仍要封禁"
              cancelText="取消"
              onConfirm={() => onBan(row)}
            >
              <Button type="link" size="small" danger>
                封禁
              </Button>
            </Popconfirm>
          ) : (
            <Button type="link" size="small" danger onClick={() => onBan(row)}>
              封禁
            </Button>
          )
        ) : (
          <Popconfirm
            title="确认解封该用户？"
            okText="确认解封"
            cancelText="取消"
            onConfirm={() => onUnban(row)}
          >
            <Button type="link" size="small">
              解封
            </Button>
          </Popconfirm>
        ),
    },
  ]
}
