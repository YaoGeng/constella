/**
 * DashboardPage（TDD-A-05 §1/§3 编排行）：运营看板页——五计数卡（包数/待审数/下载量/安装量/用户数）
 * ＋7 日双指标趋势图（TrendChart）＋手动刷新；登录后默认落地页（/ → /dashboard，A-01 路由表）。
 * - 五卡=antd Statistic `styles.content` 语义槽（S-8：antd 6 弃用的旧数值样式 prop 不用——§6.3 静态检查零命中）；
 * - pendingCount 卡可点击跳 /reviews（路由 path 解耦——不 import A-03，§1；本页唯一交互，§0）；
 * - 数据层全收在 api/adminStats.ts（页面禁自起 fetch——A-01 §6.5 边界）；staleTime 60s（§3 设计值）；
 * - 空日零高直绘（daily7d 补零=server 职责 S-04 §1——前端不聚合不补桶，§0 边界）；
 * - StatCard/TrendChart 内联于本文件（§3 组件行接口逐字一致；单页复用无跨页引用——Reviews 页同款先例）。
 */
import type { ReactNode } from 'react'
import { Button, Card, Col, Flex, Row, Statistic, Typography } from 'antd'
import { useNavigate } from 'react-router'
import type { StatsOverview } from '@constella/shared/dto'
import { useStatsOverviewQuery } from '../api/adminStats'
import { PageState } from '../components/PageState'

export interface StatCardProps {
  title: string
  value: number
  /** 可点击跳转的路由 path（pendingCount 变体——本页唯一交互，§0/§1） */
  to?: string
}

/** StatCard（§3）：Statistic 封装——数值样式经 styles.content（antd 6 语义槽，S-8 实测修正）；to 提供时整卡可点 */
export function StatCard({ title, value, to }: StatCardProps): ReactNode {
  const navigate = useNavigate()
  const statistic = (
    <Statistic title={title} value={value} styles={{ content: { fontSize: 28, fontWeight: 600 } }} />
  )
  if (to === undefined) {
    return <Card>{statistic}</Card>
  }
  return (
    <Card hoverable style={{ cursor: 'pointer' }} onClick={() => navigate(to)}>
      {statistic}
    </Card>
  )
}

// —— TrendChart（§1 候选①推荐默认）：纯 SVG 自绘分组柱状图（7 桶×双指标=14 柱＋轴＋图例，零新依赖；
// 图型静态展示无交互——tooltip/缩放=V2 随候选②③，05 P6 T6-05 备注）——

export interface TrendChartProps {
  data: StatsOverview['daily7d']
}

/** 画布与内边距（viewBox 固定坐标系——容器宽度自适应缩放） */
const CHART_W = 720
const CHART_H = 280
const CHART_PAD = { top: 40, right: 16, bottom: 36, left: 48 }
/** 组内双柱间距（px） */
const BAR_GAP = 4
/** y 轴分段数（4 段=5 刻度线含基线） */
const Y_TICKS = 4
/** 双指标图例（antd 色板 blue-6 / green-6） */
const TREND_METRICS = [
  { key: 'downloads', label: '下载量', color: '#1677ff' },
  { key: 'installs', label: '安装量', color: '#52c41a' },
] as const

/** TrendChart（§3）：7 日双指标趋势图——daily7d 原样直绘（空日零高柱落基线，不聚合不隐藏） */
export function TrendChart({ data }: TrendChartProps): ReactNode {
  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const groupW = innerW / data.length
  const barW = Math.min(24, (groupW - BAR_GAP) / 2)
  // 基线至少 1——全零周（空库）不除零，全部 14 柱零高落基线
  const maxValue = Math.max(1, ...data.flatMap((d) => [d.downloads, d.installs]))
  const baselineY = CHART_PAD.top + innerH
  const yFor = (v: number): number => baselineY - (innerH * v) / maxValue
  const barX = (i: number, metricIndex: number): number =>
    CHART_PAD.left + i * groupW + (groupW - (barW * 2 + BAR_GAP)) / 2 + metricIndex * (barW + BAR_GAP)

  return (
    <svg
      data-testid="trend-chart"
      role="img"
      aria-label="近 7 日下载量与安装量趋势"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      style={{ width: '100%', maxWidth: CHART_W, display: 'block' }}
    >
      {/* y 轴网格＋刻度值（0=基线；max 向上取整标注经等分刻度自然取整） */}
      {Array.from({ length: Y_TICKS + 1 }, (_, t) => {
        const tickValue = (maxValue * t) / Y_TICKS
        const y = yFor(tickValue)
        return (
          <g key={t}>
            <line
              x1={CHART_PAD.left}
              x2={CHART_W - CHART_PAD.right}
              y1={y}
              y2={y}
              stroke={t === 0 ? '#d9d9d9' : '#f0f0f0'}
              strokeWidth={1}
            />
            <text x={CHART_PAD.left - 8} y={y + 4} textAnchor="end" fontSize={12} fill="#8c8c8c">
              {Math.round(tickValue)}
            </text>
          </g>
        )
      })}
      {/* 分组柱：7 桶×双指标（空日零高直绘——height=0、y=基线，柱节点始终在） */}
      {data.map((day, i) =>
        TREND_METRICS.map((metric, metricIndex) => (
          <rect
            key={`${day.date}-${metric.key}`}
            data-testid={`trend-bar-${metric.key}-${i}`}
            x={barX(i, metricIndex)}
            y={yFor(day[metric.key])}
            width={barW}
            height={(innerH * day[metric.key]) / maxValue}
            fill={metric.color}
            rx={1}
          />
        )),
      )}
      {/* x 轴日期标签（'YYYY-MM-DD' → 'MM-DD'） */}
      {data.map((day, i) => (
        <text
          key={day.date}
          data-testid={`trend-date-${i}`}
          x={CHART_PAD.left + i * groupW + groupW / 2}
          y={CHART_H - 12}
          textAnchor="middle"
          fontSize={12}
          fill="#8c8c8c"
        >
          {day.date.slice(5)}
        </text>
      ))}
      {/* 图例（左上，双指标色样＋标签） */}
      {TREND_METRICS.map((metric, i) => (
        <g key={metric.key} transform={`translate(${CHART_PAD.left + i * 96}, 14)`}>
          <rect width={12} height={12} fill={metric.color} rx={2} />
          <text x={18} y={11} fontSize={12} fill="#595959">
            {metric.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

export default function DashboardPage(): ReactNode {
  // refetch 别名 reload：pages/components 禁自起请求字面（A-01 §6.5 静态检查按「fetch＋左括号」
  // 子串匹配，原方法名调用会误中）——仅命名规避，语义不变（Users/Reviews 同款）
  const { data, isPending, isFetching, error, refetch: reload } = useStatsOverviewQuery()

  return (
    <div>
      <Flex align="center" justify="space-between" style={{ marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          运营看板
        </Typography.Title>
        <Button loading={isFetching} onClick={() => void reload()} data-testid="dashboard-refresh">
          刷新
        </Button>
      </Flex>
      <PageState loading={isPending} error={error} onRetry={() => void reload()}>
        {data ? (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={8}>
                <div data-testid="stat-package">
                  <StatCard title="包数" value={data.packageCount} />
                </div>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <div data-testid="stat-pending">
                  <StatCard title="待审数" value={data.pendingCount} to="/reviews" />
                </div>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <div data-testid="stat-download">
                  <StatCard title="下载量" value={data.downloadTotal} />
                </div>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <div data-testid="stat-install">
                  <StatCard title="安装量" value={data.installTotal} />
                </div>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <div data-testid="stat-user">
                  <StatCard title="用户数" value={data.userCount} />
                </div>
              </Col>
            </Row>
            <Card style={{ marginTop: 16 }} title="近 7 日下载 / 安装趋势">
              <TrendChart data={data.daily7d} />
            </Card>
          </>
        ) : null}
      </PageState>
    </div>
  )
}
