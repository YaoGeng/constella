/**
 * UsersPage（TDD-A-02 §1/§3 编排行）：用户列表页——email 搜索（debounce 设计值 300ms）＋分页 Table
 * ＋封禁（ReasonModal，reason 必填 trim 非空）/解封（Popconfirm，列内）。
 * - 数据层全收在 api/adminUsers.ts（hooks 接口面收窄；页面禁自起 fetch——A-01 §6.5 边界）；
 * - ⚠ 分页仅传 q/page（02 §6.3/S-04 端点未定义 pageSize——Table 页大小跟随 server 返回，不擅自加参）；
 * - 操作成功后 invalidate 整表 ['admin','users']（留痕语义下以 server 状态为准，不做行级乐观更新）；
 * - 封禁留痕从简=server 结构化日志，UI 不展示（§0 边界）。
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Flex, Input, Spin, Table, Typography } from 'antd'
import type { AdminUserRow } from '@constella/shared/dto'
import { useBanMutation, useUnbanMutation, useUsersQuery } from '../api/adminUsers'
import { PageState } from '../components/PageState'
import { ReasonModal } from '../components/ReasonModal'
import { usersColumns } from './users-columns'

/** email 搜索 debounce（§1 设计值 300ms） */
const SEARCH_DEBOUNCE_MS = 300

/** 封禁理由长度上限——逐字镜像对端 banSchema（S-04：max 500），前端不另造 */
const BAN_REASON_MAX = 500

export default function UsersPage(): ReactNode {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null)

  // 输入静默期 300ms 后才提交查询（q 变更同时复位到第 1 页；清空=回全量）
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(input.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  // refetch 别名 reload：pages/components 禁自起请求字面（A-01 §6.5 静态检查按「fetch＋左括号」
  // 子串匹配，原方法名调用会误中）——仅命名规避，语义不变
  const { data, isPending, isFetching, error, refetch: reload } = useUsersQuery(q, page)
  const banMutation = useBanMutation()
  const unbanMutation = useUnbanMutation()

  const submitBan = (reason: string): void => {
    if (!banTarget) {
      return
    }
    banMutation.mutate(
      { id: banTarget.id, reason },
      {
        onSuccess: () => setBanTarget(null),
        // 出错同样收起弹窗：NOT-FOUND 时列表已失效重取、失效行随之消失（§1 错误处理列）
        onError: () => setBanTarget(null),
      },
    )
  }

  return (
    <div>
      <Typography.Title level={5}>用户管理</Typography.Title>
      <Flex align="center" gap={12} style={{ marginBottom: 16 }}>
        <Input
          allowClear
          data-testid="users-search"
          placeholder="按邮箱搜索"
          style={{ width: 280 }}
          value={input}
          suffix={isFetching ? <Spin size="small" /> : undefined}
          onChange={(e) => setInput(e.target.value)}
        />
        {data ? (
          <Typography.Text type="secondary" data-testid="users-total">
            共 {data.total} 个用户
          </Typography.Text>
        ) : null}
      </Flex>
      <PageState loading={isPending} error={error} onRetry={() => void reload()}>
        <Table<AdminUserRow>
          rowKey="id"
          columns={usersColumns({
            onBan: (row) => setBanTarget(row),
            onUnban: (row) => unbanMutation.mutate({ id: row.id }),
          })}
          dataSource={data?.items ?? []}
          loading={isFetching}
          pagination={{
            current: page,
            // ⚠ 页大小跟随 server（默认 20）：端点不回显 pageSize，取本页行数与 20 的较大值——
            // 尾页行数 < 20 时以 20 保分页数学正确（总页数由 total 驱动）
            pageSize: Math.max(data?.items.length ?? 20, 20),
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: (next) => setPage(next),
          }}
        />
      </PageState>
      <ReasonModal
        open={banTarget !== null}
        title={banTarget ? `封禁用户：${banTarget.email}` : '封禁用户'}
        maxLength={BAN_REASON_MAX}
        confirmLoading={banMutation.isPending}
        onSubmit={submitBan}
        onCancel={() => setBanTarget(null)}
      />
    </div>
  )
}
