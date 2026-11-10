// HitCardView —— 断点交互卡渲染宿主（T5-05；TDD-C-07 §3 HitCardView 行＋§1 resolveHitCard 接口段；
// 01 A-7.1=PRD-A7-01 GWT 权威；X-12 数据块列表分块（01 L422）；02 §10 断点段 L709；
// demo L1971-1989（卡形态）/L1992-2013（确认·跳过收口）=形态源（参照非权威）。
//
// 边界（§2 依赖方向——P-3）：hit 推送数据、resumeHit 回调、LlmGateway 实例全部经注入进入——
// 本文件不 import run/（C-03）任何模块；resumeHit 载荷形（{kind:'confirm',merged}|{kind:'skip'}）
// 在本文件结构重述（与 run/types.ts ResumeDecision 同形），装配点以 RunEngine.resumeHit 挂接。
// merge 走注入 LlmGateway.chatJson（T5-01 交付面）——canonicalKeys 白名单折叠 N6 键名差异。
// LLM 失败兜底：锚未冻结（§6.8/01 A-7.1/02 §10 均未提及）——本实现口径=错误上卡、卡保持可操作
// （可重试确认/跳过放行）、不自动 resumeHit（不擅自替用户决策交付物）；⚠ 待评审收口（任务报告⑥）。
import { useState } from 'react';
import type { LlmGateway } from './llm-gateway';

// ————————————————————————————————————————————
// 契约类型（§3 组件级接口 render(hit,onResolve) 的 props 形）
// ————————————————————————————————————————————

/** 断点卡推送数据（C-03 HitCoordinator.hit→装配点组装推宿主；input=data_snapshot=上游真实输出，B-4） */
export interface HitCardData {
  hitId: string;
  runId: string;
  /** 头部「run 名 · #hitId」（demo L1980 `${run.name} · #${id}`）；缺省回退 runId */
  runName?: string;
  nodeId: string;
  /** 缺省 '人工确认'（demo L1974 TYPES 兜底形） */
  nodeName?: string;
  /** 缺省 '🙋'（demo L1974） */
  icon?: string;
  /** 缺省 '请确认以下信息'（demo L1981） */
  question?: string;
  /** 选项 chip（多选；空=不渲染 chips 行，demo L1983） */
  options: readonly string[];
  /** 上游真实输出——数据块展示（X-12）＋merge 输入 */
  input: unknown;
}

/** resumeHit 载荷形（=C-03 RunEngine.resumeHit 第二参 ResumeDecision 的结构重述——P-3 不 import run/） */
export type HitResumeDecision = { kind: 'confirm'; merged: unknown } | { kind: 'skip' };

/** 用户原始动作（确认=未 merge 的 picks/extra；跳过） */
export type HitResolveAction = { kind: 'confirm'; picks: readonly string[]; extra: string } | { kind: 'skip' };

/** resolve 编排结果（error=merge 失败——错误上卡，卡保持可操作） */
export type HitResolveOutcome =
  | { kind: 'confirmed'; merged: unknown }
  | { kind: 'skipped' }
  | { kind: 'error'; message: string };

/** 注入面（P-3）：llm=merge 通道（T5-01 LlmGateway 接口）；resumeHit=C-03 确认/跳过回调 */
export interface HitResolverDeps {
  llm: Pick<LlmGateway, 'chatJson'>;
  resumeHit: (hitId: string, d: HitResumeDecision) => void;
}

/** §3 onResolve 形 */
export type HitResolver = (hit: HitCardData, action: HitResolveAction) => Promise<HitResolveOutcome>;

// ————————————————————————————————————————————
// §1 resolveHitCard：确认→LLM merge(input,picks,extra)→resumeHit(confirm,merged)；
// 跳过→resumeHit(skip) 原始 input 直发（01 A-7.1——不经 LLM）
// ————————————————————————————————————————————

/** merge 产物三键形态（01 L418「AI 合并结构化数据（{jd, filters, notes} 形态）交付下游」；demo L1881 同形） */
export const HIT_MERGE_CANONICAL_KEYS = ['jd', 'filters', 'notes'] as const;

const MERGE_SYSTEM_PROMPT =
  '你是流程断点的人工确认合并器。将上游节点输出(input)、用户勾选项(picks)与补充要求(extra)' +
  '合并为一个结构化 JSON 对象，仅含三个键：jd=上游输入的结构化整理，filters=用户勾选项字符串数组，' +
  'notes=补充要求原文（无补充时为空字符串）。只输出该 JSON 对象，不输出任何其他文字。';

export async function resolveHitCard(
  deps: HitResolverDeps,
  hit: HitCardData,
  action: HitResolveAction,
): Promise<HitResolveOutcome> {
  if (action.kind === 'skip') {
    // 01 A-7.1：跳过=原始 input 直发——不经 LLM；C-03 HitCoordinator.resume(skip) 侧以
    // data_snapshot 原值交付下游（T4-04 hit-coordinator.ts resume 路径）
    deps.resumeHit(hit.hitId, { kind: 'skip' });
    return { kind: 'skipped' };
  }
  try {
    const merged = await deps.llm.chatJson<Record<string, unknown>>(
      {
        messages: [
          { role: 'system', content: MERGE_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ input: hit.input, picks: action.picks, extra: action.extra }) },
        ],
      },
      { canonicalKeys: HIT_MERGE_CANONICAL_KEYS },
    );
    // 合并由本卡完成（02 §10：确认=LLM 合并 merge(input,picks,extra) 交付下游并 resume）
    deps.resumeHit(hit.hitId, { kind: 'confirm', merged });
    return { kind: 'confirmed', merged };
  } catch (err) {
    // ⚠ 锚未冻结兜底口径：错误消息上卡（LlmGateway 错误面已脱敏——sk- 零出现），不自动 resumeHit
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ————————————————————————————————————————————
// 数据块（X-12：上游输出为 JSON 列表→按列表分块逐项分行，最小方案——01 L422；
// 非列表→整块 JSON 展示，demo L1982 `JSON.stringify(MOCK_JD,null,1)` 形）
// ————————————————————————————————————————————

function formatDataValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 1) ?? String(v); // JSON.stringify(undefined/函数)→undefined
}

const DATA_BLOCK_CLS =
  'rounded-md border border-[var(--line-2)] bg-[var(--glass-2)] p-2 font-mono text-xs leading-relaxed text-[var(--tx-2)]';

function HitDataBlock({ input }: { input: unknown }) {
  if (Array.isArray(input)) {
    return (
      <div data-hit="data" className={DATA_BLOCK_CLS}>
        {input.map((item, i) => (
          <div key={i} data-hit-data-row={i} className={i > 0 ? 'border-t border-[var(--line)] pt-1.5' : undefined}>
            {formatDataValue(item)}
          </div>
        ))}
      </div>
    );
  }
  return <div data-hit="data" className={DATA_BLOCK_CLS}>{formatDataValue(input)}</div>;
}

// ————————————————————————————————————————————
// HitCardView（§3 render(hit,onResolve)——React 化：props {hit,onResolve}）
// ————————————————————————————————————————————

export interface HitCardViewProps {
  hit: HitCardData;
  /** 确认/跳过编排注入（装配点接 resolveHitCard——llm/resumeHit 依赖在那里闭合） */
  onResolve: HitResolver;
}

export function HitCardView({ hit, onResolve }: HitCardViewProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [extra, setExtra] = useState('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultTag, setResultTag] = useState<string | null>(null);
  const done = resultTag !== null;
  const busy = merging || done; // done 后全控件禁用（demo L1996）

  const nodeName = hit.nodeName ?? '人工确认'; // demo L1974 兜底
  const icon = hit.icon ?? '🙋'; // demo L1974
  const question = hit.question || '请确认以下信息'; // demo L1981

  const toggleChip = (label: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const resolve = async (action: HitResolveAction, tag: string): Promise<void> => {
    setMerging(true);
    setError(null);
    const outcome = await onResolve(hit, action);
    setMerging(false);
    if (outcome.kind === 'error') {
      setError(outcome.message); // 失败上卡：保持可操作——可重试确认或跳过放行
      return;
    }
    setResultTag(tag); // 卡转 done＋结果标签（demo L1996-2001）
  };

  const confirmSend = (): void => {
    const picks = hit.options.filter((o) => selected.has(o)); // 选项序=DOM 序（demo L2008 取序）
    const trimmed = extra.trim();
    void resolve({ kind: 'confirm', picks, extra: trimmed }, `已选 ${picks.length} 项${trimmed !== '' ? ' + 补充' : ''}`); // demo L2000
  };

  const skip = (): void => {
    void resolve({ kind: 'skip' }, '已跳过 — 原始数据直接下发'); // demo L2012
  };

  return (
    <div
      data-hit-card={hit.hitId}
      data-hit-state={done ? 'done' : merging ? 'merging' : 'open'}
      className="flex flex-col gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--glass)] p-3"
    >
      {/* 头：icon＋节点名＋「run 名 · #hitId」（demo L1980） */}
      <div className="flex items-center gap-2">
        <span data-hit="icon" aria-hidden className="text-base leading-none">
          {icon}
        </span>
        <b data-hit="name" className="text-sm font-semibold text-[var(--tx)]">
          {nodeName}
        </b>
        <span data-hit="hid" className="ml-auto truncate font-mono text-[11px] text-[var(--tx-3)]">
          {hit.runName ?? hit.runId} · #{hit.hitId}
        </span>
      </div>
      <div data-hit="q" className="text-sm text-[var(--tx)]">
        {question}
      </div>
      <HitDataBlock input={hit.input} />
      {hit.options.length > 0 && (
        <div data-hit="chips" className="flex flex-wrap gap-1.5">
          {hit.options.map((o) => {
            const on = selected.has(o);
            return (
              <button
                key={o}
                type="button"
                data-hit-chip={o}
                aria-pressed={on}
                disabled={busy}
                onClick={() => toggleChip(o)}
                className={
                  on
                    ? 'rounded-full border border-[var(--accent-line)] bg-[var(--accent-tint)] px-2.5 py-1 text-xs leading-none text-[var(--accent-hi)]'
                    : 'rounded-full border border-[var(--line-2)] px-2.5 py-1 text-xs leading-none text-[var(--tx-2)] hover:border-[var(--accent-line)]'
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
      <input
        data-hit="extra"
        value={extra}
        disabled={busy}
        placeholder="补充要求…（可选）"
        onChange={(e) => setExtra(e.target.value)}
        className="rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 text-sm text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none"
      />
      {error !== null && (
        <div data-hit="error" className="rounded-md border border-[var(--red-line)] bg-[var(--red-tint)] px-2 py-1.5 text-xs text-[var(--red)]">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-hit-action="skip"
          disabled={busy}
          onClick={skip}
          className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-xs text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-50"
        >
          跳过
        </button>
        <button
          type="button"
          data-hit-action="send"
          disabled={busy}
          onClick={confirmSend}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--ink-on-accent)] disabled:opacity-50"
        >
          确认并发送
        </button>
      </div>
      {done && (
        <div data-hit="result" className="font-mono text-[11px] text-[var(--tx-3)]">
          {resultTag}
        </div>
      )}
    </div>
  );
}
