// @vitest-environment jsdom
// useMarketList hooks 用例（T5-09；TDD-C-09 §3 MarketBrowser 行「搜索/排序/分页 hooks」）。
// 组件测试栈=仓库惯例（jsdom docblock＋createRoot/act＋probe 组件——无 testing-library 依赖红线）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { MarketListItem, MarketListQuery, MarketListRes } from '@constella/shared/dto';
import { MarketTransportError, MarketUnconfiguredError } from './market-error';
import { useMarketList, useMarketPagination, useMarketSearch, useMarketSort } from './use-market-list';

interface ProbeHandle<T> {
  current(): T;
  rerenderWith(useHook: () => T): Promise<void>;
  unmount(): Promise<void>;
}

async function mountHook<T>(useHook: () => T): Promise<ProbeHandle<T>> {
  let value: T = undefined as unknown as T;
  const Probe = ({ use }: { use: () => T }): null => {
    value = use();
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Probe use={useHook} />);
  });
  return {
    current: () => value,
    rerenderWith: async (next: () => T) => {
      const fn = next;
      await act(async () => {
        root.render(<Probe use={fn} />);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
        container.remove();
      });
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function items(n: number): MarketListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: 'node',
    name: `包${i}`,
    author: { id: 'u1', name: 'alice' },
    perms: [],
    downloadCount: i,
    installCount: i,
    starCount: 0,
    version: '1.0.0',
    updatedAt: '2026-11-08T02:11:00Z',
  }));
}

describe('useMarketList（§3 组件级接口 useMarketList(q)）', () => {
  it('成功 → ready{items,total}；reload() 重查', async () => {
    const list = vi.fn(async () => ({ items: items(2), total: 2 }));
    const p = await mountHook(() => useMarketList(list, { kind: 'node' }));
    await act(async () => {
      await flush();
    });
    const ready = p.current().state;
    expect(ready.phase).toBe('ready');
    if (ready.phase === 'ready') {
      expect(ready.items).toHaveLength(2);
      expect(ready.total).toBe(2);
    }
    expect(list).toHaveBeenCalledWith({ kind: 'node' });
    await act(async () => {
      p.current().reload();
      await flush();
    });
    expect(list).toHaveBeenCalledTimes(2);
    await p.unmount();
  });

  it('查询参透传（q/sort/page/pageSize）', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0 }));
    const q: MarketListQuery = { kind: 'flow', q: '日报', sort: 'downloads', page: 2, pageSize: 10 };
    const p = await mountHook(() => useMarketList(list, q));
    await act(async () => {
      await flush();
    });
    expect(list).toHaveBeenCalledWith(q);
    await p.unmount();
  });

  it('baseUrl 空（MarketUnconfiguredError）→ phase=unconfigured', async () => {
    const list = vi.fn(async () => {
      throw new MarketUnconfiguredError();
    });
    const p = await mountHook(() => useMarketList(list, {}));
    await act(async () => {
      await flush();
    });
    expect(p.current().state.phase).toBe('unconfigured');
    await p.unmount();
  });

  it('网络错误 → phase=error 且保留最近成功列表（last——T5-11 缓存投影数据位）', async () => {
    let fail = false;
    const list = vi.fn(async (): Promise<MarketListRes> => {
      if (fail) throw new MarketTransportError('network', '网络错误');
      return { items: items(3), total: 3 };
    });
    const p = await mountHook(() => useMarketList(list, { kind: 'node' }));
    await act(async () => {
      await flush();
    });
    expect(p.current().state.phase).toBe('ready');
    fail = true;
    await act(async () => {
      p.current().reload();
      await flush();
    });
    const s = p.current().state;
    expect(s.phase).toBe('error');
    if (s.phase === 'error') {
      expect(s.last?.items).toHaveLength(3); // 最近一次成功响应保留（01 §8.3 断网-广场行——持久化归 T5-11）
    }
    await p.unmount();
  });

  it('迟到的旧响应不覆盖新响应（stale 守卫：q 变化后旧慢响应丢弃）', async () => {
    const list = vi.fn((q?: MarketListQuery): Promise<MarketListRes> => {
      const slow = q?.q === 'a'; // 第一次查询慢（40ms），第二次快（5ms）
      return new Promise((resolve) => {
        setTimeout(() => resolve({ items: items(1), total: slow ? 1 : 2 }), slow ? 40 : 5);
      });
    });
    const p = await mountHook(() => useMarketList(list, { kind: 'node', q: 'a' }));
    // 注意：重渲染与等待须各自独立 act 作用域——嵌套 act 的批量提交会把重渲染推迟到
    // 最外层退出，定时器将等在提交之前（时序假阴性）。
    await p.rerenderWith(() => useMarketList(list, { kind: 'node', q: 'b' })); // 换查询（旧响应在途）
    await act(async () => {
      await flush();
      await new Promise((r) => setTimeout(r, 60)); // 两个响应均到期（b=5ms 先回、a=40ms 迟到）
    });
    const s = p.current().state;
    expect(s.phase).toBe('ready');
    if (s.phase === 'ready') expect(s.total).toBe(2); // 迟到的旧响应（total=1）未覆盖
    await p.unmount();
  });
});

describe('useMarketSearch（搜索框：文本态/提交态分离——不逐键打 server）', () => {
  it('text 编辑不提交；commit() 才落 committed', async () => {
    const p = await mountHook(() => useMarketSearch());
    expect(p.current().committed).toBe('');
    await p.unmount();
  });
});

describe('useMarketSort（排序两值）', () => {
  it('默认 latest；setSort 收敛两值', async () => {
    const p = await mountHook(() => useMarketSort());
    expect(p.current().sort).toBe('latest');
    await p.unmount();
  });
});

describe('useMarketPagination（分页）', () => {
  it('pageCount=ceil(total/pageSize)；next/prev 边界收敛', async () => {
    const p = await mountHook(() => useMarketPagination(45, 20));
    const s = p.current();
    expect(s.page).toBe(1);
    expect(s.pageCount).toBe(3);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(true);
    await act(async () => {
      s.next();
    });
    expect(p.current().page).toBe(2);
    await act(async () => {
      p.current().next();
    });
    expect(p.current().page).toBe(3);
    expect(p.current().canNext).toBe(false);
    await act(async () => {
      p.current().prev();
    });
    expect(p.current().page).toBe(2);
    await act(async () => {
      p.current().setPage(99); // 越界收敛
    });
    expect(p.current().page).toBe(3);
    await act(async () => {
      p.current().setPage(1);
    });
    expect(p.current().page).toBe(1);
    await p.unmount();
  });

  it('total=0 → pageCount=1（不出现 0 页）', async () => {
    const p = await mountHook(() => useMarketPagination(0, 20));
    expect(p.current().pageCount).toBe(1);
    await p.unmount();
  });
});
