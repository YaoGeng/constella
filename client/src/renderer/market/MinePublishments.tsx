// MinePublishments —— 「我的发布」状态只读视图（T5-11 / TDD-C-09 §1 mine() 行：全状态＋
// 驳回理由可见——PRD-A13-02；客户端只消费状态，审核操作归 admin S-03）。只读=零写入口。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketMineItem } from '@constella/shared/dto';

/** mine 面（MarketApiClient.mine 结构子集——测试 fake face） */
export interface MineFace {
  mine(): Promise<{ items: MarketMineItem[]; total: number }>;
}

export interface UseMine {
  phase: 'loading' | 'ready' | 'error' | 'unauthorized';
  items: MarketMineItem[];
  total: number;
  reload(): void;
}

/** mine() hook（stale 守卫同 useMarketList 口径） */
export function useMine(mine: MineFace['mine']): UseMine {
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unauthorized'>('loading');
  const [items, setItems] = useState<MarketMineItem[]>([]);
  const [total, setTotal] = useState(0);
  const mineRef = useRef(mine);
  mineRef.current = mine;

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    mineRef
      .current()
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string }).code;
        setPhase(code === 'UNAUTHORIZED' ? 'unauthorized' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { phase, items, total, reload };
}

/** 状态徽标文案（PackageStatus——02 §5.2 状态机：pending→approved|rejected；approved→offline） */
const STATUS_LABEL: Record<MarketMineItem['status'], string> = {
  pending: '审核中',
  approved: '已上架',
  rejected: '已驳回',
  offline: '已下架',
};

export interface MinePublishmentsProps {
  mine: MineFace['mine'];
  onClose?(): void;
}

/** 只读列表：名称/状态徽标/驳回理由（rejected 行可见——PRD-A13-02） */
export function MinePublishments({ mine }: MinePublishmentsProps) {
  const { phase, items, total } = useMine(mine);
  return (
    <div data-mine="root" className="flex flex-col gap-2">
      {phase === 'loading' && <p className="p-2 text-center text-sm text-[var(--tx-3)]">加载中…</p>}
      {phase === 'unauthorized' && <p className="p-2 text-center text-sm text-[var(--tx-3)]">登录后可查看我的发布</p>}
      {phase === 'error' && <p data-mine="error" className="p-2 text-center text-sm text-[#ff9db0]">加载失败——请检查网络后重试</p>}
      {phase === 'ready' && (
        <>
          <p data-mine="total" className="text-xs text-[var(--tx-3)]">
            共 {total} 个发布
          </p>
          {items.length === 0 && <p className="p-2 text-center text-sm text-[var(--tx-3)]">还没有发布过内容</p>}
          {items.map((it) => (
            <article
              key={it.id}
              data-mine-item={it.id}
              className="flex items-start gap-2 rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.45)] p-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <b data-mine-field="name" className="truncate text-sm text-[var(--tx)]">
                    {it.name}
                  </b>
                  <span data-mine-field="status" data-status={it.status} className="shrink-0 rounded border border-[var(--line-2)] px-1.5 text-[10px] leading-4 text-[var(--tx-2)]">
                    {STATUS_LABEL[it.status]}
                  </span>
                </div>
                <p className="truncate text-xs text-[var(--tx-3)]">
                  {it.kind === 'flow' ? '流程' : it.kind === 'pack' ? '节点包' : '节点'}·↓ {it.downloadCount}·v{it.version}
                </p>
                {it.status === 'rejected' && it.reviewReason != null && it.reviewReason !== '' && (
                  <p data-mine-field="review-reason" className="rounded border border-[rgba(120,60,60,0.6)] bg-[rgba(120,20,40,0.18)] px-1.5 py-0.5 text-[11px] text-[#ff9db0]">
                    驳回理由：{it.reviewReason}
                  </p>
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
