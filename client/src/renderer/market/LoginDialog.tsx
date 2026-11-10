// LoginDialog —— 登录/注册引导弹窗（T5-09；TDD-C-09 §3 AuthSession＋LoginDialog 行——
// client 侧唯一账号 UI，01 第 2 章最小集）。纯展示组件：busy/error 由消费方（MarketBrowser
// 或装配点）持有；提交回调 onLogin/onRegister。UI=shadcn copy-in 手工基线风格＋tailwind
// （CdpDock.tsx/definition/form/controls.tsx 先例同源）。
import { useState } from 'react';
import type { FormEvent } from 'react';

export interface LoginDialogProps {
  /** 提交中（禁用提交钮） */
  busy?: boolean;
  /** 错误文案（消费方映射后的用户可读文案；null=无） */
  error?: string | null;
  onLogin(email: string, password: string): void;
  onRegister(email: string, password: string): void;
  onClose(): void;
}

export function LoginDialog({ busy = false, error = null, onLogin, onRegister, onClose }: LoginDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (trimmed === '' || password === '') return; // 必填——空值不提交
    if (mode === 'login') onLogin(trimmed, password);
    else onRegister(trimmed, password);
  };

  return (
    <div
      data-login="root"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,6,16,0.72)]"
    >
      <div
        data-login="panel"
        className="w-84 flex flex-col gap-3 rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <b className="text-sm font-semibold text-[var(--tx)]">广场账号</b>
          <button
            type="button"
            data-login="close"
            title="关闭"
            className="rounded px-2 py-0.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex gap-1 rounded-md border border-[var(--line-2)] p-1 text-sm">
          <button
            type="button"
            data-login="mode-login"
            className={`flex-1 rounded px-3 py-1 ${mode === 'login' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-2)]'}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            data-login="mode-register"
            className={`flex-1 rounded px-3 py-1 ${mode === 'register' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-2)]'}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>
        <form data-login="form" className="flex flex-col gap-2" onSubmit={submit}>
          <input
            data-login="email"
            type="email"
            autoComplete="email"
            placeholder="邮箱"
            className="rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-3 py-1.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            data-login="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="密码"
            className="rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-3 py-1.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error !== null && error !== '' && (
            <p data-login="error" className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1 text-xs text-[#ff9db0]">
              {error}
            </p>
          )}
          <button
            type="submit"
            data-login="submit"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[#04101f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '提交中…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
