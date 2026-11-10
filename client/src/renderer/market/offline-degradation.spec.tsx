// @vitest-environment jsdom
// OfflineDegradation 用例（T5-11 / TDD-C-09 §3 组件行＋§6.6 离线降级验收）。
//
// 覆盖：离线判定（TransportFailureKind 输入——network=offline、timeout=降级观察不翻转）；
// 缓存列表只读投影（会话内存不持久化——卡内冻结 ⚠）；安装置灰信号；广场 pill 离线态（B-9）；
// 联网恢复翻转（onOnline 一次触发——PendingPublishQueue 补交提示接线位）；本地功能零阻塞
// （MarketBrowser 断网=错误条＋缓存只读渲染＋按钮置灰——弹窗照常可关）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { MarketListItem, MarketListRes, UserProfile } from '@constella/shared/dto';
import { MarketTransportError } from './market-error';
import { createOfflineDegradation, projectCachedList, useOfflineState } from './offline-degradation';
import { MarketBrowser } from './MarketBrowser';
import type { MarketAuthFace } from './MarketBrowser';

const ITEM: MarketListItem = {
  id: 'pkg-1',
  kind: 'node',
  name: '热榜抓取',
  author: { id: 'u1', name: 'alice' },
  perms: [],
  downloadCount: 3,
  installCount: 1,
  starCount: 0,
  version: '1.0.0',
  updatedAt: '2026-11-08T02:11:00Z',
};

const USER: UserProfile = { id: 'u1', email: 'a@b.c', role: 'user' };
const AUTH: MarketAuthFace = {
  isLoggedIn: () => true,
  onAuthChange: () => () => {},
  login: vi.fn(async (): Promise<UserProfile> => USER),
  register: vi.fn(async (): Promise<UserProfile> => USER),
};

describe('OfflineDegradation——离线判定（TransportFailureKind 输入）', () => {
  it('network=疑似离线（offline）；timeout=降级观察不翻转；reportOnline=恢复', () => {
    const d = createOfflineDegradation();
    expect(d.state()).toBe('online');
    d.report('timeout');
    expect(d.state()).toBe('online'); // 慢≠断网
    d.report('network');
    expect(d.state()).toBe('offline');
    expect(d.installDisabled()).toBe(true); // §1 安装置灰信号
    d.reportOnline();
    expect(d.state()).toBe('online');
    expect(d.installDisabled()).toBe(false);
  });

  it('onStateChange/onOnline：翻转恰一次通知（联网恢复=补交提示接线位）', () => {
    const d = createOfflineDegradation();
    const states: string[] = [];
    const online = vi.fn();
    d.onStateChange((s) => states.push(s));
    d.onOnline(online);
    d.report('network');
    d.report('network'); // 幂等——不重复翻转
    d.reportOnline();
    d.reportOnline();
    expect(states).toEqual(['offline', 'online']);
    expect(online).toHaveBeenCalledTimes(1);
  });
});

describe('OfflineDegradation——缓存列表只读投影（会话内存 ⚠ 卡内冻结）', () => {
  it('cacheList/cachedList/projectCachedList：最近一次成功响应投影；无缓存=null', () => {
    const d = createOfflineDegradation();
    expect(projectCachedList(d)).toBe(null);
    const first: MarketListRes = { items: [ITEM], total: 1 };
    d.cacheList(first);
    expect(projectCachedList(d)).toEqual({ offline: false, items: [ITEM], total: 1 });
    d.cacheList({ items: [], total: 0 }); // 最近一次覆盖
    expect(projectCachedList(d)!.items).toHaveLength(0);
    d.report('network');
    expect(projectCachedList(d)!.offline).toBe(true); // 断网后投影只读可渲染
  });

  it('useOfflineState hook：翻转驱动重渲染（B-9 pill 数据源）', async () => {
    const d = createOfflineDegradation();
    let value: 'online' | 'offline' = 'online';
    const Probe = (): null => {
      value = useOfflineState(d);
      return null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
    expect(value).toBe('online');
    await act(async () => {
      d.report('network');
    });
    expect(value).toBe('offline');
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});

describe('§6.6 断网-广场（MarketBrowser offline 注入——pill/置灰/缓存只读渲染）', () => {
  it('在线成功→断网失败：错误条＋缓存只读渲染（卡片保留）；下载按钮置灰离线文案＋pill；关闭照常（零阻塞）', async () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();
    // 在线成功（缓存登记）→ 断网失败（transport——缓存列表只读投影数据位=use-market-list error.last）
    let online = true;
    const list = vi.fn(async () => {
      if (online) return { items: [ITEM], total: 1 };
      throw new MarketTransportError('network', '网络错误');
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const render = (offline: boolean): void => {
      root.render(<MarketBrowser listFace={{ list }} auth={AUTH} onDownload={onDownload} onClose={onClose} offline={offline} />);
    };
    await act(async () => {
      render(false);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-card-download]')?.textContent).toBe('下载'); // 在线正常

    // 断网：OfflineDegradation.state→offline（装配位注入）＋搜索提交触发重查→失败路径
    online = false;
    await act(async () => {
      render(true); // 装配位：offline 态传入
    });
    const search = container.querySelector<HTMLInputElement>('[data-browser="search-input"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '关键词');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    // pill 离线态（B-9）
    expect(container.querySelector('[data-browser="offline-pill"]')?.textContent).toBe('离线');
    // 错误条（transport 文案——可继续浏览最近一次列表）
    expect(container.querySelector('[data-browser="error"]')?.textContent).toContain('无法连接广场服务');
    // 缓存列表只读渲染：卡片保留（error.last 投影）
    expect(container.querySelector('[data-card="pkg-1"] [data-field="name"]')?.textContent).toBe('热榜抓取');
    // 安装置灰：disabled＋「离线」文案
    const btn = container.querySelector<HTMLButtonElement>('[data-card-download]');
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe('离线');
    // 置灰零触发（onDownload 不外发）
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDownload).not.toHaveBeenCalled();
    // 本地功能零阻塞——弹窗照常可关
    await act(async () => {
      container.querySelector('[data-browser="close"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });

  it('在线（offline 缺省）——无 pill、按钮可用：原 T5-09 行为零回归', async () => {
    const list = vi.fn(async () => ({ items: [ITEM], total: 1 }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <MarketBrowser listFace={{ list }} auth={AUTH} onDownload={() => {}} onClose={() => {}} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-browser="offline-pill"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-card-download]')?.disabled).toBe(false);
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});
