/**
 * 应用入口（TDD-A-01 §1：main.tsx/App.tsx 行）。
 * 启动顺序：bootstrap 静默续期（有 refreshToken → POST /api/auth/refresh）先行——
 * 带着续期结果再首帧渲染，避免守卫在续期完成前误跳 /login（reload 保持登录场景的正确性前提）。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { authSession } from './session/authSession'

void authSession.bootstrap().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
