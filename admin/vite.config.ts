import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// T0-09 / TDD-A-01 §1 antd 按需三约束之二：lazy + manualChunks vendor 分包——
// antd / react 系各自独立 chunk，对照 S-8 全量引入单 chunk 1.08MB（gzip 345KB）反例
// （spikes/s8-admin/REPORT.md）。约束之一（具名导入）与之三（styles.content 弃 valueStyle 系）
// 见 src/App.tsx 顶部注释；路由级 React.lazy 随 P5 波 A-01 路由表落地。
export default defineConfig({
  plugins: [react()],
  build: {
    // 现代浏览器基线，与 tsconfig.base.json target ES2022 对齐
    target: 'es2022',
    rollupOptions: {
      output: {
        // vite 8 + TS 7.0.2 实测：对象形 manualChunks 判型冲突（ManualChunksFunction 单形），
        // 改函数形等价实现 vendor-react / vendor-antd 两组分包（T0-09 验收修复留痕）
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('antd') || id.includes('@ant-design')) return 'vendor-antd'
          if (
            id.includes('react-dom') ||
            id.includes('react-router') ||
            /[\\/]node_modules[\\/]react[\\/]/.test(id)
          ) {
            return 'vendor-react'
          }
          return undefined
        },
      },
    },
  },
})
