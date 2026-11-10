/**
 * AppRouter + QueryClient 装配（TDD-A-01 §1 工程落位：main.tsx/App.tsx 行；§3 AppRouter 行）。
 *
 * 七行路由表（react-router 7.18.5；SPA fallback 与 `*` 兜底重定向为 S-8 实测）：
 *   /login 公开（唯一公开路由）；/ → Navigate /dashboard（登录后默认落地=设计值，02 未定）；
 *   /users、/reviews、/packages/:id、/dashboard = RequireAdmin 守卫；* → Navigate /dashboard。
 * basename=/admin（静态托管于 www/admin/——vite base 设计值；§4 构建产物）。
 *
 * antd 三约束（S-8 强制吸收）：①具名导入（本文件及全 src）②路由级 React.lazy 代码分割
 * + vite manualChunks vendor 分包（vite.config.ts vendor-react/vendor-antd——对照 S-8 全量引入
 * 单 chunk 1.08MB 反例）③弃用 API 用 v6 styles.content 系（A-04/A-05 落地）。
 *
 * TanStack Query 缓存键命名空间（§4 冻结，各卡登记）：
 *   A-02 ['admin','users',{q,page}] / A-03 ['admin','reviews',page] /
 *   A-04 ['admin','package',id] / A-05 ['admin','stats','overview']。
 */
import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button, Layout, Space, Spin, Typography } from 'antd'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { RequireAdmin } from './components/RequireAdmin'
import { authSession } from './session/authSession'

// 路由级 lazy（A-01 页+四占位页统一 lazy 分割；T6-02~05 整文件替换占位、default export 不变）
const LoginPage = lazy(() => import('./pages/Login'))
const UsersPage = lazy(() => import('./pages/Users'))
const ReviewsPage = lazy(() => import('./pages/Reviews'))
const PackageDetailPage = lazy(() => import('./pages/PackageDetail'))
const DashboardPage = lazy(() => import('./pages/Dashboard'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401 单飞刷新链路由 ApiClient 承担（重放恰一次）——query 层不 retry 放大
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

function RouteFallback(): ReactNode {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Spin />
    </div>
  )
}

/** 管理端骨架壳：顶栏（标识+当前账号+退出）+ 内容区（A-01 骨架层；A-02~05 页面渲染于 Outlet） */
function AdminLayout(): ReactNode {
  const user = authSession.getUser()
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#001529',
        }}
      >
        <Typography.Text strong style={{ color: 'rgba(255,255,255,0.88)' }}>
          Constella Admin
        </Typography.Text>
        <Space>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.66)' }}>
            {user ? user.email : ''}
          </Typography.Text>
          <Button size="small" ghost onClick={() => authSession.logout()} data-testid="logout">
            退出登录
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </Layout.Content>
    </Layout>
  )
}

/** 路由表 + lazy 装配 + 守卫包裹（§3 AppRouter 行：<AppRouter /> 经 App 由 main.tsx 挂载） */
export function AppRouter(): ReactNode {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<RouteFallback />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route
            path="/users"
            element={
              <Suspense fallback={<RouteFallback />}>
                <UsersPage />
              </Suspense>
            }
          />
          <Route
            path="/reviews"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ReviewsPage />
              </Suspense>
            }
          />
          <Route
            path="/packages/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <PackageDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<RouteFallback />}>
                <DashboardPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export function App(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  )
}
