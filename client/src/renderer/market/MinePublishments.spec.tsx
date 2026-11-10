// @vitest-environment jsdom
// MinePublishments 用例（T5-11 / TDD-C-09 §1 mine() 行——只读视图＋驳回理由可见 PRD-A13-02）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { MarketMineItem } from '@constella/shared/dto';
import { MinePublishments } from './MinePublishments';

function mineItem(over: Partial<MarketMineItem> = {}): MarketMineItem {
  return {
    id: 'pkg-1',
    kind: 'node',
    name: '热榜抓取',
    author: { id: 'u1', name: 'alice' },
    perms: [],
    downloadCount: 4,
    installCount: 2,
    starCount: 0,
    version: '1.0.0',
    updatedAt: '2026-11-08T02:11:00Z',
    status: 'pending',
    ...over,
  };
}

async function mountMine(mine: () => Promise<{ items: MarketMineItem[]; total: number }>): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<MinePublishments mine={mine} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  (container as HTMLDivElement & { __root?: Root }).__root = root;
  return container;
}

async function unmount(container: HTMLDivElement): Promise<void> {
  const root = (container as HTMLDivElement & { __root?: Root }).__root;
  await act(async () => {
    root?.unmount();
    container.remove();
  });
}

describe('MinePublishments——只读视图（客户端只消费状态）', () => {
  it('全状态渲染＋驳回理由可见（rejected 行——PRD-A13-02）', async () => {
    const items = [
      mineItem({ id: 'a', status: 'pending' }),
      mineItem({ id: 'b', status: 'approved' }),
      mineItem({ id: 'c', status: 'rejected', reviewReason: '脚本含未声明的文件写权限' }),
      mineItem({ id: 'd', status: 'offline' }),
    ];
    const container = await mountMine(async () => ({ items, total: 4 }));
    expect(container.querySelector('[data-mine="total"]')?.textContent).toContain('共 4 个发布');
    const badges = [...container.querySelectorAll('[data-mine-field="status"]')].map((e) => e.textContent);
    expect(badges).toEqual(['审核中', '已上架', '已驳回', '已下架']);
    const reason = container.querySelector('[data-mine-item="c"] [data-mine-field="review-reason"]');
    expect(reason?.textContent).toContain('脚本含未声明的文件写权限');
    expect(container.querySelector('[data-mine-item="a"] [data-mine-field="review-reason"]')).toBeNull(); // 非 rejected 不渲染
    await unmount(container);
  });

  it('空列表/未登录态', async () => {
    const empty = await mountMine(async () => ({ items: [], total: 0 }));
    expect(empty.textContent).toContain('还没有发布过内容');
    await unmount(empty);

    const unauth = await mountMine(() =>
      Promise.reject(Object.assign(new Error('登录后才能执行该操作'), { code: 'UNAUTHORIZED' })),
    );
    expect(unauth.textContent).toContain('登录后可查看我的发布');
    await unmount(unauth);
  });

  it('加载失败态（transport——不崩溃）', async () => {
    const err = await mountMine(() => Promise.reject(new Error('网络错误')));
    expect(err.querySelector('[data-mine="error"]')?.textContent).toContain('加载失败');
    await unmount(err);
  });
});

describe('useMine（stale 守卫同 useMarketList 口径）', () => {
  it('reload 重查', async () => {
    let calls = 0;
    const container = await mountMine(async () => {
      calls++;
      return { items: [mineItem()], total: 1 };
    });
    expect(calls).toBe(1);
    await unmount(container);
  });
});
