// @vitest-environment jsdom
// MarketBrowser 用例（T5-09；TDD-C-09 §3 MarketBrowser 行——两 tab 节点/流程＋搜索/排序/分页
// hooks＋卡片逐字段↔MarketListItem（demo L817-820/L3032-3036 参照非权威，字段映射=X-01 DTO）；
// §6.2 匿名浏览照常；未登录下载→登录引导弹窗（零外发——list 走注入 face，download 不触发）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { MarketListItem, MarketListQuery, MarketListRes } from '@constella/shared/dto';
import { MarketTransportError, MarketUnconfiguredError } from './market-error';
import { MarketBrowser } from './MarketBrowser';
import type { MarketAuthFace, MarketListFace } from './MarketBrowser';

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function item(over: Partial<MarketListItem> = {}): MarketListItem {
  return {
    id: 'pkg-1',
    kind: 'node',
    name: '热榜抓取',
    summary: '抓取站点热榜并汇总',
    author: { id: 'u1', name: 'alice' },
    perms: ['CDP', '网络'],
    downloadCount: 12,
    installCount: 8,
    starCount: 0,
    version: '1.2.0',
    updatedAt: '2026-11-08T02:11:00Z',
    ...over,
  };
}

function page(items: MarketListItem[], total: number): MarketListRes {
  return { items, total };
}

/** auth face mock：登录态可翻转＋订阅回调可手动触发（onAuthChange 接线断言面） */
function fakeAuth(loggedIn = false): { face: MarketAuthFace; setLoggedIn(v: boolean): void; notify(): void } {
  let state = loggedIn;
  const subs = new Set<() => void>();
  return {
    face: {
      isLoggedIn: () => state,
      onAuthChange: (fn) => {
        subs.add(fn);
        return () => subs.delete(fn);
      },
      login: vi.fn(async () => {
        state = true;
        for (const fn of [...subs]) fn();
        return { id: 'u1', email: 'a@b.c', role: 'user' as const };
      }),
      register: vi.fn(async () => {
        state = true;
        for (const fn of [...subs]) fn();
        return { id: 'u1', email: 'a@b.c', role: 'user' as const };
      }),
    },
    setLoggedIn: (v) => {
      state = v;
    },
    notify: () => {
      for (const fn of [...subs]) fn();
    },
  };
}

async function mountBrowser(
  list: MarketListFace['list'],
  auth: MarketAuthFace,
  onDownload: (it: MarketListItem) => void = () => {},
): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarketBrowser listFace={{ list }} auth={auth} onDownload={onDownload} onClose={() => {}} />);
  });
  await act(async () => {
    await flush();
  });
  const m = { container, root };
  return m;
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

async function click(el: Element | null): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setInput(el: HTMLInputElement | null, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el?.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(el: HTMLSelectElement | null, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
  el?.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('MarketBrowser 两 tab＋查询面（demo L817-820 参照）', () => {
  it('挂载 → 匿名 list（kind=node、page=1、sort=latest）；切流程 tab → kind=flow 且页复位', async () => {
    const list = vi.fn(async (_q?: MarketListQuery) => page([], 0));
    const m = await mountBrowser(list, fakeAuth().face);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ kind: 'node', page: 1, sort: 'latest' });
    await click(m.container.querySelector('[data-tab="flow"]'));
    await act(async () => {
      await flush();
    });
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'flow', page: 1 }));
    await unmount(m);
  });

  it('搜索（回车提交）＋排序下拉 → 查询参透传（搜索/排序/分页 hooks 消费面）', async () => {
    const list = vi.fn(async () => page([], 0));
    const m = await mountBrowser(list, fakeAuth().face);
    const input = m.container.querySelector<HTMLInputElement>('[data-browser="search-input"]');
    setInput(input, '日报');
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: '日报' }));
    setSelect(m.container.querySelector<HTMLSelectElement>('[data-browser="sort"]'), 'downloads');
    await act(async () => {
      await flush();
    });
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'downloads', q: '日报' }));
    await unmount(m);
  });

  it('分页：total=45 → 3 页；next → page=2 查询', async () => {
    const list = vi.fn(async (q?: MarketListQuery) => page([item({ id: `p${q?.page ?? 1}` })], 45));
    const m = await mountBrowser(list, fakeAuth().face);
    expect(m.container.querySelector('[data-browser="page"]')?.textContent).toContain('1 / 3');
    await click(m.container.querySelector('[data-browser="next"]'));
    await act(async () => {
      await flush();
    });
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(m.container.querySelector('[data-browser="page"]')?.textContent).toContain('2 / 3');
    await unmount(m);
  });
});

describe('MarketBrowser 卡片逐字段↔MarketListItem（X-01 DTO 字段面）', () => {
  it('名称/简介/作者/下载量/星级/版本/权限标签 逐字段渲染', async () => {
    const list = vi.fn(async () => page([item()], 1));
    const m = await mountBrowser(list, fakeAuth().face);
    const card = m.container.querySelector('[data-card="pkg-1"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector('[data-field="name"]')?.textContent).toBe('热榜抓取');
    expect(card?.querySelector('[data-field="summary"]')?.textContent).toBe('抓取站点热榜并汇总');
    expect(card?.querySelector('[data-field="author"]')?.textContent).toBe('alice');
    expect(card?.querySelector('[data-field="downloads"]')?.textContent).toContain('12');
    expect(card?.querySelector('[data-field="stars"]')?.textContent).toContain('0');
    expect(card?.querySelector('[data-field="version"]')?.textContent).toContain('1.2.0');
    const perms = [...(card?.querySelectorAll('[data-field="perm"]') ?? [])].map((e) => e.textContent);
    expect(perms).toEqual(['CDP', '网络']);
    await unmount(m);
  });
});

describe('MarketBrowser 未配置引导（market.baseUrl 默认空——03 §7.3#2）', () => {
  it('list 抛 MarketUnconfiguredError → 引导面板（不渲染卡片/搜索面）', async () => {
    const list = vi.fn(async () => {
      throw new MarketUnconfiguredError();
    });
    const m = await mountBrowser(list, fakeAuth().face);
    expect(m.container.querySelector('[data-browser="guide"]')).not.toBeNull();
    expect(m.container.textContent).toContain('market.baseUrl');
    expect(m.container.querySelector('[data-browser="search-input"]')).toBeNull();
    await unmount(m);
  });
});

describe('MarketBrowser 网络错误（离线判定输入的 UI 呈现——降级本体归 T5-11）', () => {
  it('MarketTransportError → 错误面板＋离线提示文案', async () => {
    const list = vi.fn(async () => {
      throw new MarketTransportError('network', '网络错误');
    });
    const m = await mountBrowser(list, fakeAuth().face);
    expect(m.container.querySelector('[data-browser="error"]')).not.toBeNull();
    expect(m.container.textContent).toContain('无法连接广场服务');
    await unmount(m);
  });
});

describe('MarketBrowser 登录引导（§6.2：未登录下载→登录弹窗；匿名浏览照常）', () => {
  it('未登录点下载 → LoginDialog 打开、onDownload 零调用；登录成功 → 弹窗收口＋再点即外发', async () => {
    const list = vi.fn(async () => page([item()], 1));
    const auth = fakeAuth(false);
    const onDownload = vi.fn();
    const m = await mountBrowser(list, auth.face, onDownload);
    await click(m.container.querySelector('[data-card="pkg-1"] [data-card-download]'));
    expect(m.container.querySelector('[data-login="form"]')).not.toBeNull(); // 登录引导弹窗
    expect(onDownload).not.toHaveBeenCalled(); // 未登录——零外发
    // 表单登录 → 成功收口
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      m.container.querySelector<HTMLInputElement>('[data-login="email"]'),
      'a@b.c',
    );
    m.container.querySelector<HTMLInputElement>('[data-login="email"]')?.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      m.container.querySelector<HTMLInputElement>('[data-login="password"]'),
      'pw',
    );
    m.container.querySelector<HTMLInputElement>('[data-login="password"]')?.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => {
      m.container.querySelector<HTMLFormElement>('[data-login="form"]')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flush();
    });
    expect(auth.face.login).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(m.container.querySelector('[data-login="form"]')).toBeNull(); // 弹窗收口
    await click(m.container.querySelector('[data-card="pkg-1"] [data-card-download]'));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'pkg-1' }));
    await unmount(m);
  });

  it('登录失败 → 错误呈现于弹窗（AUTH-INVALID-CREDENTIALS 映射文案）', async () => {
    const list = vi.fn(async () => page([item()], 1));
    const face: MarketAuthFace = {
      isLoggedIn: () => false,
      onAuthChange: () => () => {},
      login: vi.fn(async () => {
        throw new (await import('./market-error')).MarketApiError('AUTH-INVALID-CREDENTIALS', 'Invalid email or password', 401, 'r1');
      }),
      register: vi.fn(async () => {
        throw new Error('unused');
      }),
    };
    const m = await mountBrowser(list, face);
    await click(m.container.querySelector('[data-card="pkg-1"] [data-card-download]'));
    const email = m.container.querySelector<HTMLInputElement>('[data-login="email"]');
    const password = m.container.querySelector<HTMLInputElement>('[data-login="password"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(email, 'a@b.c');
    email?.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(password, 'bad');
    password?.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => {
      m.container.querySelector<HTMLFormElement>('[data-login="form"]')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flush();
    });
    expect(m.container.querySelector('[data-login="error"]')?.textContent).toContain('邮箱或密码错误');
    expect(m.container.querySelector('[data-login="form"]')).not.toBeNull(); // 弹窗保持
    await unmount(m);
  });
});
