/**
 * PackageDetailPage（TDD-A-04 §1/§3 编排行）：包详情=admin 唯一工作台——七展示分区全部响应驱动
 * （元数据/权限声明/manifest 摘要/脚本清单/版本/计量/动作区按 status 适配）＋下载预检。
 * - 动作区适配=package-actions.tsx（状态字面量允许处）；展示分区=package-sections.tsx（含展示映射）；
 *   本页只编排（§3 PackageDetailPage 行：无 props，id 取 useParams）；
 * - NOT-FOUND → 「包不存在」＋回 /reviews（§1 错误处理列；回队列=navigate——禁 import A-03 组件，§2）；
 * - 数据层全收在 api/adminPackages.ts（页面禁自起 fetch——A-01 §6.5 边界）；
 * - approve 成功离页=navigate('/reviews')（§1 设计值）；驳回/下架停留本页——失效重取后按实态只读重渲染。
 */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Card, Space, Typography, message } from 'antd'
import { useNavigate, useParams } from 'react-router'
import { usePackageDetailQuery } from '../api/adminPackages'
import { ApiError } from '../api/client'
import { PageState } from '../components/PageState'
import { PermTags } from '../components/PermTags'
import { ActionPanel, DownloadPrecheck } from './package-actions'
import { ManifestSummary, MetaSection, MeterCards, ScriptListTable, VersionsTable } from './package-sections'

export default function PackageDetailPage(): ReactNode {
  const { id } = useParams()
  const navigate = useNavigate()
  // refetch 别名 reload：pages/components 禁自起请求字面（A-01 §6.5 静态检查按「fetch＋左括号」
  // 子串匹配，原方法名调用会误中）——仅命名规避，语义不变（Users/Reviews 同款）
  const { data: pkg, isPending, error, refetch: reload } = usePackageDetailQuery(id ?? '')

  // §1 错误处理列：NOT-FOUND → 「包不存在」＋回 /reviews（详情对象已不存在——工作台无以立足）
  useEffect(() => {
    if (error instanceof ApiError && error.body.error.code === 'NOT-FOUND') {
      void message.error('包不存在', 4)
      navigate('/reviews')
    }
  }, [error, navigate])

  return (
    <div>
      <Typography.Title level={5}>包详情</Typography.Title>
      <PageState loading={isPending} error={error} onRetry={() => void reload()}>
        {pkg ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <MetaSection pkg={pkg} />
            <Card title="权限声明" data-testid="pkg-perms">
              <PermTags perms={pkg.perms} />
            </Card>
            <ManifestSummary manifest={pkg.manifest} />
            <ScriptListTable scripts={pkg.manifest.scripts ?? {}} />
            <VersionsTable versions={pkg.versions} />
            <MeterCards downloadCount={pkg.downloadCount} installCount={pkg.installCount} />
            <Card title="操作区">
              <Space direction="vertical">
                {/* 下载预检全状态可用（S-03：审核对象含待审包）；semver=最新版本（versions 末位） */}
                <ActionPanel pkg={pkg} onDone={() => navigate('/reviews')} />
                <DownloadPrecheck
                  id={pkg.id}
                  semver={pkg.versions[pkg.versions.length - 1]?.semver ?? ''}
                />
              </Space>
            </Card>
          </Space>
        ) : null}
      </PageState>
    </div>
  )
}
