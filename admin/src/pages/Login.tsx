/**
 * LoginPage（TDD-A-01 §1 路由表 /login——唯一公开路由；§3 LoginPage 行）：
 * 登录表单（email/password；校验范式=S-8 四类规则实测：required + email 格式）。
 * 错误文案：ApiError 展示 code+友好文案（AUTH-INVALID-CREDENTIALS 等对账口径）；
 * USER 账号 → NonAdminError「非管理员账号」（不建会话——authSession.login 拦截）。
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { authSession, NonAdminError } from '../session/authSession'

interface LoginFormValues {
  email: string
  password: string
}

/** 错误码→中文文案（server 02 §6.1 错误码；code 原文保留展示以便对账） */
const CODE_MESSAGES: Record<string, string> = {
  'AUTH-INVALID-CREDENTIALS': '邮箱或密码错误',
  'ADMIN-USER-BANNED': '账号已被封禁',
  'RATE-LIMITED': '尝试过于频繁，请稍后再试', // X-01 ErrorCode 冻结字面量为 RATE-LIMITED（T6-01 评审 MINOR 修正）
}

function errorText(err: unknown): string {
  if (err instanceof NonAdminError) {
    return '非管理员账号，无法登录管理端'
  }
  if (err instanceof ApiError) {
    const code = err.body.error.code
    const friendly = CODE_MESSAGES[code] ?? err.body.error.message
    return `${code}：${friendly}`
  }
  return '登录失败，请稍后再试'
}

export default function LoginPage(): ReactNode {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFinish = async (values: LoginFormValues): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      await authSession.login(values.email, values.password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>
          Constella Admin
        </Typography.Title>
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} data-testid="login-error" />
        ) : null}
        <Form<LoginFormValues> layout="vertical" onFinish={(_values) => void onFinish(_values)} disabled={submitting}>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input autoComplete="username" placeholder="admin@example.com" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password autoComplete="current-password" placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting} data-testid="login-submit">
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Flex>
  )
}
