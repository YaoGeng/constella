// @vitest-environment jsdom
// LoginDialog 用例（T5-09；TDD-C-09 §3 AuthSession＋LoginDialog 行——client 侧唯一账号 UI，
// 01 第 2 章最小集：表单＋错误呈现）。组件测试栈=仓库惯例（jsdom docblock＋createRoot/act）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LoginDialog } from './LoginDialog';

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

async function mountDialog(props: Parameters<typeof LoginDialog>[0]): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<LoginDialog {...props} />);
  });
  return { container, root };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

function setInput(el: HTMLInputElement | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el?.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(form: HTMLFormElement | null): Promise<void> {
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function click(el: Element | null): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('LoginDialog（表单＋错误呈现）', () => {
  it('登录模式：邮箱/密码提交 → onLogin(email,password)', async () => {
    const onLogin = vi.fn();
    const m = await mountDialog({ onLogin, onRegister: vi.fn(), onClose: vi.fn() });
    setInput(m.container.querySelector<HTMLInputElement>('[data-login="email"]'), 'a@b.c');
    setInput(m.container.querySelector<HTMLInputElement>('[data-login="password"]'), 'pw123');
    await submit(m.container.querySelector<HTMLFormElement>('[data-login="form"]'));
    expect(onLogin).toHaveBeenCalledWith('a@b.c', 'pw123');
    await unmount(m);
  });

  it('切注册模式：提交 → onRegister(email,password)', async () => {
    const onRegister = vi.fn();
    const m = await mountDialog({ onLogin: vi.fn(), onRegister, onClose: vi.fn() });
    await click(m.container.querySelector('[data-login="mode-register"]'));
    setInput(m.container.querySelector<HTMLInputElement>('[data-login="email"]'), 'x@y.z');
    setInput(m.container.querySelector<HTMLInputElement>('[data-login="password"]'), 'pw456');
    await submit(m.container.querySelector<HTMLFormElement>('[data-login="form"]'));
    expect(onRegister).toHaveBeenCalledWith('x@y.z', 'pw456');
    await unmount(m);
  });

  it('error 呈现（data-login="error"）＋ busy 禁用提交', async () => {
    const m = await mountDialog({
      onLogin: vi.fn(),
      onRegister: vi.fn(),
      onClose: vi.fn(),
      busy: true,
      error: '邮箱或密码错误',
    });
    expect(m.container.querySelector('[data-login="error"]')?.textContent).toBe('邮箱或密码错误');
    const btn = m.container.querySelector<HTMLButtonElement>('[data-login="submit"]');
    expect(btn?.disabled).toBe(true);
    await unmount(m);
  });

  it('空值不提交（邮箱/密码必填）', async () => {
    const onLogin = vi.fn();
    const m = await mountDialog({ onLogin, onRegister: vi.fn(), onClose: vi.fn() });
    await submit(m.container.querySelector<HTMLFormElement>('[data-login="form"]'));
    expect(onLogin).not.toHaveBeenCalled();
    await unmount(m);
  });

  it('onClose 关闭回调（取消钮）', async () => {
    const onClose = vi.fn();
    const m = await mountDialog({ onLogin: vi.fn(), onRegister: vi.fn(), onClose });
    await click(m.container.querySelector('[data-login="close"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(m);
  });
});
