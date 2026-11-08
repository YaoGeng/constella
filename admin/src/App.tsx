/**
 * antd 按需引入三约束口径登记（TDD-A-01 §1，S-8 强制吸收；T0-09 落配置与示范，
 * P5 波 A-01 起逐页落实）：
 * ① 组件一律从 `antd` 具名导入（tree-shaking），禁止命名空间整体导入
 *    （TDD-A-01 §6.5 静态检查该模式 → 0 命中）——见下方 Button/ConfigProvider。
 * ② 路由级 React.lazy 代码分割 + Vite manualChunks vendor 分包
 *    （vite.config.ts：vendor-react / vendor-antd 独立 chunk；lazy 随 P5 波路由表落地）。
 * ③ antd 6 弃用 API 以 `styles.content` 系为准（如 Statistic 弃 valueStyle——
 *    S-8 唯一弃用告警记录，A-04/A-05 落地）。
 */
import type { ReactNode } from 'react'
import { Button, ConfigProvider } from 'antd'

export function App(): ReactNode {
  return (
    <ConfigProvider>
      <Button type="primary">Constella Admin</Button>
    </ConfigProvider>
  )
}
