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
 * 后台改版（2026-11-12）：AdminLayout 由顶栏单列改 antd 侧边栏模式（Sider+Menu），
 * 菜单 label 刻意避开与页面 H1 同文——admin-smoke S4/S5 getByText('运营看板') 为 strict
 * locator，菜单+标题同文会双命中（改版冒烟实测约束，登记于本行）。布局结构样式一律
 * antd 组件承载（Flex/Space），不再裸 div 手写 flex。
 *
 * TanStack Query 缓存键命名空间（§4 冻结，各卡登记）：
 *   A-02 ['admin','users',{q,page}] / A-03 ['admin','reviews',page] /
 *   A-04 ['admin','package',id] / A-05 ['admin','stats','overview']。
 */
import type { ReactNode } from 'react'
import { lazy, Suspense, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuditOutlined, DashboardOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Flex, Layout, Menu, Space, Spin, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
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
    <Flex align="center" justify="center" style={{ padding: 48 }}>
      <Spin />
    </Flex>
  )
}

/** 侧边栏菜单项（后台改版 2026-11-12）：key=路由 path（Menu onClick 直接 navigate）。
 *  /packages/:id 不设菜单项——详情页归属审核流，selectedKey 映射回 /reviews 高亮。 */
const NAV_ITEMS: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '看板' },
  { key: '/reviews', icon: <AuditOutlined />, label: '审核队列' },
  { key: '/users', icon: <TeamOutlined />, label: '用户管理' },
]

/** 管理端骨架壳（antd 侧边栏模式，后台改版 2026-11-12）：
 *  Sider（标识＋导航 Menu＋断点折叠）＋ 顶栏（当前账号＋退出）＋ 内容区（A-01 骨架层；
 *  A-02~05 页面渲染于 Outlet）。折叠受控=品牌位随折叠收窄换字（collapsedWidth 默认 80），
 *  breakpoint=lg 窄屏自动折叠（冒烟视口 1280px 恒展开——菜单可见性不受场景影响）。 */
function AdminLayout(): ReactNode {
  const user = authSession.getUser()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  // 详情页归属审核流：/packages/:id → 高亮「审核队列」；其余按 path 精确匹配（一级路由无嵌套）
  const selectedKey = pathname.startsWith('/packages') ? '/reviews' : pathname

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        theme="dark"
      >
        <Flex align="center" justify="center" style={{ height: 64, overflow: 'hidden' }}>
          <Typography.Text strong style={{ color: 'rgba(255,255,255,0.88)', whiteSpace: 'nowrap' }}>
            {collapsed ? 'C' : 'Constella Admin'}
          </Typography.Text>
        </Flex>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#001529',
            paddingInline: 24,
          }}
        >
          <span />
          <Space>
            <UserOutlined style={{ color: 'rgba(255,255,255,0.66)' }} />
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
