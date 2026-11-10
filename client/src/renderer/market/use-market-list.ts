// useMarketList hooks（T5-09；TDD-C-09 §3 MarketBrowser 行「搜索/排序/分页 hooks」）。
//
// useMarketList(q)=§3 组件级接口：MarketApiClient.list 注入（fn 经 ref 收口——identity 不入
// effect deps）；stale 守卫（迟到旧响应丢弃）；unconfigured=baseUrl 空引导（03 §7.3#2）；
// error 保留 last（最近一次成功响应——01 §8.3「最近一次缓存列表」数据位，只读投影归 T5-11）。
// 搜索/排序/分页三小 hook=MarketBrowser 消费面（不逐键打 server——text/committed 分离）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketListQuery, MarketListRes } from '@constella/shared/dto';
import { isMarketUnconfiguredError } from './market-error';

/** 列表态（unconfigured=首次使用引导；error.last=最近成功响应——T5-11 缓存投影数据位） */
export type MarketListState =
  | { phase: 'loading'; last: MarketListRes | null }
  | { phase: 'ready'; items: MarketListRes['items']; total: number; last: MarketListRes }
  | { phase: 'error'; error: unknown; last: MarketListRes | null }
  | { phase: 'unconfigured' };

/** useMarketList 返回面 */
export interface UseMarketList {
  state: MarketListState;
  reload(): void;
}

/** 列表 hook：q 变化/手动 reload 重查；迟到旧响应丢弃（seq 守卫） */
export function useMarketList(
  list: (q?: MarketListQuery) => Promise<MarketListRes>,
  q: MarketListQuery,
): UseMarketList {
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unconfigured'>('loading');
  const [error, setError] = useState<unknown>(null);
  const lastGoodRef = useRef<MarketListRes | null>(null);
  const seqRef = useRef(0);
  const listRef = useRef(list);
  const qRef = useRef(q);
  listRef.current = list;
  qRef.current = q;
  const key = JSON.stringify(q);

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    setPhase('loading');
    listRef.current(qRef.current).then(
      (res) => {
        if (cancelled || seq !== seqRef.current) return; // stale 守卫：迟到旧响应丢弃
        lastGoodRef.current = res;
        setPhase('ready');
      },
      (err: unknown) => {
        if (cancelled || seq !== seqRef.current) return;
        if (isMarketUnconfiguredError(err)) {
          setPhase('unconfigured'); // market.baseUrl 空——首次使用引导（03 §7.3#2）
          return;
        }
        setError(err);
        setPhase('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const state: MarketListState =
    phase === 'ready' && lastGoodRef.current !== null
      ? { phase: 'ready', items: lastGoodRef.current.items, total: lastGoodRef.current.total, last: lastGoodRef.current }
      : phase === 'error'
        ? { phase: 'error', error, last: lastGoodRef.current }
        : phase === 'unconfigured'
          ? { phase: 'unconfigured' }
          : { phase: 'loading', last: lastGoodRef.current };

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { state, reload };
}

/** 搜索 hook：文本态/提交态分离（Enter/按钮提交——不逐键打 server） */
export function useMarketSearch(): {
  text: string;
  setText(v: string): void;
  committed: string;
  commit(): void;
} {
  const [text, setText] = useState('');
  const [committed, setCommitted] = useState('');
  const commit = useCallback(() => setCommitted(text), [text]);
  return { text, setText, committed, commit };
}

/** 排序 hook（两值：latest=updatedAt desc / downloads=downloadCount desc——server LIST_SORTS 对端） */
export function useMarketSort(): { sort: 'latest' | 'downloads'; setSort(v: 'latest' | 'downloads'): void } {
  const [sort, setSort] = useState<'latest' | 'downloads'>('latest');
  return { sort, setSort };
}

/** 分页 hook：pageCount=ceil(total/pageSize)（0 页收敛 1）；setPage/next/prev 边界夹取 */
export function useMarketPagination(total: number, pageSize: number): {
  page: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  setPage(p: number): void;
  next(): void;
  prev(): void;
} {
  const [page, setPageRaw] = useState(1);
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const clamp = (p: number): number => Math.min(Math.max(1, p), pageCount);
  const setPage = useCallback((p: number) => setPageRaw(clamp(p)), [pageCount]);
  const next = useCallback(() => setPageRaw((p) => Math.min(p + 1, pageCount)), [pageCount]);
  const prev = useCallback(() => setPageRaw((p) => Math.max(p - 1, 1)), []);
  return { page, pageCount, canPrev: page > 1, canNext: page < pageCount, setPage, next, prev };
}
