/**
 * 包详情展示分区（TDD-A-04 §1 展示分区/§3 五组件行）：MetaSection/ManifestSummary/ScriptListTable/
 * VersionsTable/MeterCards——全部响应驱动（只渲染 detail 响应字段，无本地推导——§2）。
 * - 状态字面量仅存在于本文件（展示映射）与 package-actions.tsx（动作适配）——§6.3 reviewer 核对项；
 * - MeterCards=Statistic `styles.content` 语义槽（S-8：antd 6 弃用的旧数值样式 prop 零出现）；
 * - 元数据区 semver/sizeBytes/checksum 取 versions 末位（server 固定 createdAt asc——inspectPackage，
 *   末位=最新）；checksum 等宽（Typography code）＋可复制；
 * - formatBytes/formatDateTime 与 Reviews 列展示格式化同款（本页自持副本——禁 import A-03 页面文件，§2）。
 */
import type { ReactNode } from 'react'
import { Badge, Card, Col, Descriptions, Row, Statistic, Table, Tag, Typography } from 'antd'
import type {
  AdminPackageDetail,
  PackageStatus,
  PackageVersionMeta,
} from '@constella/shared/dto'
import type { PackageManifest, ScriptRef } from '@constella/shared/manifest'

/** status 展示映射（§6.3 允许处：DTO 小写字面量 → Badge 状态预设＋中文标签） */
const STATUS_BADGE: Record<PackageStatus, { status: 'processing' | 'success' | 'error' | 'default'; label: string }> = {
  pending: { status: 'processing', label: '待审' },
  approved: { status: 'success', label: '已通过' },
  rejected: { status: 'error', label: '已驳回' },
  offline: { status: 'default', label: '已下架' },
}

/** kind 展示映射（node/pack/flow → antd Tag 预设色——Reviews 列同款配色，本页自持副本） */
const KIND_TAG: Record<AdminPackageDetail['kind'], { color: string; label: string }> = {
  node: { color: 'blue', label: 'node' },
  pack: { color: 'orange', label: 'pack' },
  flow: { color: 'geekblue', label: 'flow' },
}

/** sizeBytes → 可读大小（B/KB/MB，1 位小数——Reviews 列展示格式化同款） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** createdAt（ISO 8601）→ 本地可读时间（列展示格式化，不做时区归一——Reviews 同款） */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

/** versions 末位=最新版本（server 固定 createdAt asc 排序——inspectPackage；latestVersion 恒在） */
function latestVersionOf(pkg: AdminPackageDetail): PackageVersionMeta | undefined {
  return pkg.versions[pkg.versions.length - 1]
}

/** MetaSection（§3）：元数据＋status Badge＋checksum（等宽/复制） */
export function MetaSection({ pkg }: { pkg: AdminPackageDetail }): ReactNode {
  const latest = latestVersionOf(pkg)
  return (
    <Card title="元数据" data-testid="pkg-meta">
      <Descriptions column={2} size="small">
        <Descriptions.Item label="名称">{pkg.name}</Descriptions.Item>
        <Descriptions.Item label="类别">
          <Tag color={KIND_TAG[pkg.kind].color}>{KIND_TAG[pkg.kind].label}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="简介">{pkg.summary ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="作者">{pkg.author.name}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <span data-testid="pkg-status">
            <Badge status={STATUS_BADGE[pkg.status].status} text={STATUS_BADGE[pkg.status].label} />
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="最新版本">{latest ? latest.semver : '—'}</Descriptions.Item>
        <Descriptions.Item label="大小">{latest ? formatBytes(latest.sizeBytes) : '—'}</Descriptions.Item>
        <Descriptions.Item label="校验和">
          {latest ? (
            <Typography.Text code copyable>
              {latest.checksum}
            </Typography.Text>
          ) : (
            '—'
          )}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  )
}

/** ManifestSummary（§3）：manifest 导出元信息摘要（X-01 ./manifest 摘要形——kind/name/summary/version） */
export function ManifestSummary({ manifest }: { manifest: PackageManifest }): ReactNode {
  return (
    <Card title="manifest 摘要" data-testid="pkg-manifest">
      <Descriptions column={2} size="small">
        <Descriptions.Item label="kind">{manifest.kind}</Descriptions.Item>
        <Descriptions.Item label="name">{manifest.name}</Descriptions.Item>
        <Descriptions.Item label="summary">{manifest.summary ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="version">{manifest.version}</Descriptions.Item>
      </Descriptions>
    </Card>
  )
}

/** ScriptListTable（§3）：scripts 键集清单（node→{file,lang,entry}——manifest.scripts 映射） */
export function ScriptListTable({ scripts }: { scripts: Record<string, ScriptRef> }): ReactNode {
  const rows = Object.entries(scripts).map(([node, ref]) => ({ node, ...ref }))
  return (
    <Card title="脚本清单" data-testid="pkg-scripts">
      <Table
        rowKey="node"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '节点', dataIndex: 'node' },
          { title: 'file', dataIndex: 'file' },
          { title: 'lang', dataIndex: 'lang' },
          { title: 'entry', dataIndex: 'entry' },
        ]}
      />
    </Card>
  )
}

/** VersionsTable（§3）：版本列表（semver/提交时间/大小/checksum——versions 元素形=X-01 冻结） */
export function VersionsTable({ versions }: { versions: PackageVersionMeta[] }): ReactNode {
  return (
    <Card title="版本" data-testid="pkg-versions">
      <Table
        rowKey="semver"
        size="small"
        pagination={false}
        dataSource={versions}
        columns={[
          { title: '版本', dataIndex: 'semver' },
          { title: '提交时间', dataIndex: 'createdAt', render: (iso: string): string => formatDateTime(iso) },
          { title: '大小', dataIndex: 'sizeBytes', render: (bytes: number): string => formatBytes(bytes) },
          {
            title: 'checksum',
            dataIndex: 'checksum',
            render: (checksum: string): ReactNode => <Typography.Text code>{checksum}</Typography.Text>,
          },
        ]}
      />
    </Card>
  )
}

/** MeterCards（§3）：下载/安装计量 Statistic×2（styles.content——S-8 强制，旧数值样式 prop 零出现） */
export function MeterCards({
  downloadCount,
  installCount,
}: {
  downloadCount: number
  installCount: number
}): ReactNode {
  return (
    <Card title="计量" data-testid="pkg-meters">
      <Row gutter={16}>
        <Col span={12}>
          <div data-testid="pkg-meter-download">
            <Statistic title="下载量" value={downloadCount} styles={{ content: { fontSize: 24, fontWeight: 600 } }} />
          </div>
        </Col>
        <Col span={12}>
          <div data-testid="pkg-meter-install">
            <Statistic title="安装量" value={installCount} styles={{ content: { fontSize: 24, fontWeight: 600 } }} />
          </div>
        </Col>
      </Row>
    </Card>
  )
}
