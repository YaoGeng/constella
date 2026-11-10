import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// T0-09 / TDD-A-01 §1 antd 按需三约束之二：lazy + manualChunks vendor 分包——
// antd / react 系各自独立 chunk，对照 S-8 全量引入单 chunk 1.08MB（gzip 345KB）反例
// （spikes/s8-admin/REPORT.md）。约束之一（具名导入）与之三（styles.content 弃 valueStyle 系）
// 见 src/App.tsx 顶部注释；路由级 React.lazy 随 P5 波 A-01 路由表落地。
export default defineConfig({
  plugins: [react()],
  // 静态托管于 www/admin/（TDD-A-01 §4 构建产物；base 设计值 /admin/——M5 部署卡核对）
  base: '/admin/',
  server: {
    // 监听 IPv4 回环（本机 localhost 解析为 ::1 时 127.0.0.1 curl 不通——§6.3 冒烟命令口径）
    host: '127.0.0.1',
    // dev 期 API 反代（TDD-A-01 §1：dev=Vite server.proxy → http://127.0.0.1:8051；
    // 生产与 server 同域经反代免 CORS——部署标准 §5.3/§8 步 4，与 S-01 K3 同口径）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8051',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 现代浏览器基线，与 tsconfig.base.json target ES2022 对齐
    target: 'es2022',
    rollupOptions: {
      output: {
        // vite 8 + TS 7.0.2 实测：对象形 manualChunks 判型冲突（ManualChunksFunction 单形），
        // 改函数形等价实现 vendor-react / vendor-antd 两组分包（T0-09 验收修复留痕）。
        // P6 PM 裁决（2026-11-11，T6-02 上报）：A-02 Table 栈使 vendor-antd 达 1,027.83kB
        // （十进制 >1MB）——增拆 vendor-antd-table（表格数据栈）保「最大单 chunk <1MB」
        // （TDD-A-01 §6.2 设计值；S-8 反例 1.08MB 对照），组件契约零砍。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (
            id.includes('antd/es/table') ||
            id.includes('antd/lib/table') ||
            id.includes('rc-table') ||
            id.includes('rc-pagination') ||
            id.includes('rc-virtual-list')
          ) {
            return 'vendor-antd-table'
          }
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
