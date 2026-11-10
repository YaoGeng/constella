// workshop-panel —— 工坊面板最小宿主壳（T6-17；卡面③「工坊面板（IntentRouter·HitCardView·
// PlanCard 链）」——已交付组件的挂载宿主，**视觉打磨=T6-16 walk**（登记移交，不就地扩卡））。
//
// 最小宿主面：输入框＋IntentRouter 五意图路由（develop=NodeDevAgent 草稿卡〔NodeDraftCard——
// 02 §12.2#2 脚本明示〕/flow=handoffToFlowWorkshop 计划卡→FlowMaterializer 一键生成/
// explain·zip·optimize=LLM 文本应答）＋HitCardView 断点卡挂载（runStore.pendingHits→
// hits.list 构建→resolveHitCard 编排）。
// ⚠ 最小壳登记（不静默造功能）：optimize 差异卡链（ConfirmGate+patchNode）与流式文本渲染
// 未实装——文本应答代位；轨道 tab 双栏（node/flow 互斥面板）未实装——单栏对话流承载。
import { useEffect, useRef, useState } from 'react';
import type { LogLevel } from '@constella/shared/ipc';
import { useCanvasStore } from '../canvas/canvas-store';
import { useFlowStore } from '../canvas/stores/flow-store';
import { useRunStore } from '../run/run-store';
import {
  handoffToFlowWorkshop,
  useWorkshopStore,
  HitCardView,
  NodeDraftCard,
  resolveHitCard,
  type HitCardData,
  type HitResolveAction,
  type PlanCard,
} from '../workshop';
import type { AppRuntime } from './app-runtime';
import { useShellStore } from './shell-store';

const TEXT_REPLY_PROMPT =
  '你是星丛节点工坊的助手。用简体中文简洁回答用户关于节点/zip 资产包/流程自动化的问题或优化建议。仅输出 JSON：{"reply":"回复正文"}';

/** 计划卡内联渲染面（PlanCard 链——确认后 FlowMaterializer 一键生成） */
function PlanCardInline({
  plan,
  runtime,
  notify,
}: {
  plan: PlanCard;
  runtime: AppRuntime;
  notify(level: LogLevel, msg: string): void;
}) {
  const [state, setState] = useState<'pending' | 'running' | 'done'>('pending');
  const srcBadge = { lib: '📚', plaza: '🏬', new: '✨' } as const;

  const generate = (): void => {
    setState('running');
    void runtime.workshop.materializer
      .materialize(plan)
      .then((res) => {
        if (!res.ok) {
          setState('pending');
          notify('err', res.message ?? '生成失败');
          return;
        }
        // 切到新流程（demo L2303 activeFlow=id＋clearDirty＋fitView——materializer 冻结面不含
        // 切换，壳层编排收口）：serialize 当前画布（=刚落图节点/边）→loadFlow 基线重置
        if (res.flowId === undefined) return; // ok=true 恒随 flowId——防御收口
        const doc = useFlowStore.getState().serialize();
        useFlowStore.getState().loadFlow(res.flowId, { ...doc, name: plan.flowName });
        runtime.viewport.fitView();
        useCanvasStore.getState().closeDrawer();
        setState('done');
        notify('ok', `已生成「${plan.flowName}」— 可继续编辑或直接运行`);
      })
      .catch((err) => {
        setState('pending');
        notify('err', err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <div data-plan-card={plan.id} data-plan-state={state} className="flex flex-col gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--glass)] p-3">
      <div className="flex items-center gap-2">
        <b className="text-sm text-[var(--tx)]">{plan.flowName}</b>
        <span className="ml-auto text-[10px] text-[var(--tx-3)]">{plan.steps.length} 步</span>
      </div>
      <ol className="flex flex-col gap-1">
        {plan.steps.map((s, i) => (
          <li key={i} data-plan-step={i} className="flex items-baseline gap-1.5 text-xs text-[var(--tx-2)]">
            <span aria-hidden>{srcBadge[s.src]}</span>
            <b className="font-medium text-[var(--tx)]">{s.name}</b>
            <code className="font-mono text-[10px] text-[var(--tx-3)]">{s.type}</code>
            {s.note !== undefined && <span className="text-[10px] text-[var(--tx-3)]">——{s.note}</span>}
          </li>
        ))}
      </ol>
      {plan.edges !== undefined && (
        <span className="text-[10px] text-[var(--tx-3)]">显式分支路由 {plan.edges.length} 条</span>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          data-plan-action="generate"
          disabled={state !== 'pending'}
          onClick={generate}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--ink-on-accent)] hover:brightness-110 disabled:opacity-50"
        >
          {state === 'running' ? '生成中…' : state === 'done' ? '已生成' : '✨ 一键生成'}
        </button>
      </div>
    </div>
  );
}

/** 断点交互卡挂载（runStore.pendingHits→hits.list 构建→resolveHitCard——C-03 推送宿主） */
function HitCardsMount({ runtime }: { runtime: AppRuntime }) {
  const pendingHits = useRunStore((s) => s.pendingHits);
  const [cards, setCards] = useState<readonly HitCardData[]>([]);

  useEffect(() => {
    let cancelled = false;
    const runIds = [...new Set(Object.values(pendingHits).map((h) => h.runId))];
    void (async () => {
      const next: HitCardData[] = [];
      for (const runId of runIds) {
        try {
          const res = await runtime.storage.invoke('hits.list', { runId, status: 'pending' });
          for (const r of res.items) {
            next.push({
              hitId: r.id,
              runId: r.runId,
              nodeId: r.nodeId,
              question: r.question,
              options: r.options.filter((o): o is string => typeof o === 'string'),
              input: r.dataSnapshot,
            });
          }
        } catch {
          /* storage 不可达——跳过该 run 的卡面（不炸面板） */
        }
      }
      if (!cancelled) setCards(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingHits, runtime]);

  const onResolve = (hit: HitCardData, action: HitResolveAction) =>
    resolveHitCard(
      { llm: runtime.workshop.llm, resumeHit: (hitId, d) => runtime.engine.resumeHit(hitId, d) },
      hit,
      action,
    );

  return (
    <>
      {cards.map((hit) => (
        <HitCardView key={hit.hitId} hit={hit} onResolve={onResolve} />
      ))}
    </>
  );
}

export interface WorkshopPanelProps {
  runtime: AppRuntime;
  notify(level: LogLevel, msg: string): void;
}

/** 工坊面板（右栏最小宿主——挂载位/开合=shell-store workshopOpen；预填=打开事件载荷） */
export function WorkshopPanel({ runtime, notify }: WorkshopPanelProps) {
  const messages = useWorkshopStore((s) => s.messages);
  const rail = useWorkshopStore((s) => s.rail);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** 已放弃草稿 id 集（宿主层置弃——workshopStore 无移除面〔T5-02 冻结〕，隐藏即弃） */
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开事件预填（DrawerShell「让 AI 开发」→ demo L2097 chatInput 预填＋focus）
  useEffect(() => {
    const prefill = useShellStore.getState().consumeWorkshopPrefill();
    if (prefill !== '') setInput((prev) => (prev === '' ? prefill : prev));
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const request = input.trim();
    if (request === '' || busy) return;
    setInput('');
    const store = useWorkshopStore.getState();
    store.pushMessage('user', request);
    setBusy(true);
    void (async () => {
      try {
        const selection = useCanvasStore.getState().selection;
        const intent = await runtime.workshop.router.route(
          request,
          selection !== null ? { selectedNodeId: selection } : {},
        );
        if (intent.type === 'reask') {
          useWorkshopStore.getState().pushMessage('assistant', intent.question);
          return;
        }
        switch (intent.kind) {
          case 'develop': {
            useWorkshopStore.getState().setRailActivity('thinking');
            try {
              const draft = await runtime.workshop.nodeDev.develop({ request });
              useWorkshopStore
                .getState()
                .pushMessage('assistant', `草稿「${draft.name}」已通过自检——请先查看脚本内容再确认加入画布`, {
                  kind: 'draft',
                  draft,
                });
            } finally {
              useWorkshopStore.getState().setRailActivity('idle');
            }
            return;
          }
          case 'flow': {
            // 转交流程工坊（01 A-10.2）：switchRail＋预填＋自动出计划卡（消息/状态由其内部管理）
            await handoffToFlowWorkshop(request, { planner: runtime.workshop.planner });
            return;
          }
          default: {
            // explain/zip/optimize：LLM 文本应答（最小宿主面——流式渲染/差异卡链登记移交 T6-16）
            const ctx =
              intent.kind === 'optimize' && selection !== null ? `${request}\n（当前选中节点：${selection}）` : request;
            const res = await runtime.workshop.llm.chatJson<{ reply: string }>(
              { messages: [{ role: 'system', content: TEXT_REPLY_PROMPT }, { role: 'user', content: ctx }] },
              { canonicalKeys: ['reply'] },
            );
            useWorkshopStore.getState().pushMessage('assistant', res.reply === '' ? '（无回复）' : res.reply);
          }
        }
      } catch (err) {
        // 生成失败上抛挂卡（02 §9.2 兜底链限意图面——不吞不改写）
        useWorkshopStore.getState().pushMessage('assistant', `⚠ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <aside
      data-workshop="panel"
      className="absolute bottom-0 right-0 top-0 z-[19] flex w-[380px] max-w-[92vw] flex-col border-l border-[var(--line-2)] bg-[var(--glass)] backdrop-blur-[10px]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <b className="text-sm text-[var(--tx)]">✨ 节点工坊</b>
        <span data-workshop="activity" className="text-[10px] text-[var(--tx-3)]">
          {rail.activity === 'parallel' ? `并行 ${rail.parallelCount} 任务` : { idle: '待命', thinking: '思考中…', planning: '规划中…' }[rail.activity]}
        </span>
        <button
          type="button"
          data-workshop="close"
          aria-label="关闭工坊"
          className="ml-auto rounded px-1.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
          onClick={() => useShellStore.getState().closeWorkshop()}
        >
          ✕
        </button>
      </header>

      <div data-workshop="messages" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p data-workshop="empty" className="text-xs text-[var(--tx-3)]">
            描述需求——节点工坊现场开发单节点，整条流程自动转交流程工坊出计划卡。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} data-workshop-msg={m.role} className={m.role === 'user' ? 'self-end rounded-lg bg-[var(--accent-tint)] px-2.5 py-1.5 text-xs text-[var(--tx)]' : 'flex w-full flex-col gap-2'}>
            {m.text !== '' && <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--tx-2)]">{m.text}</p>}
            {m.card?.kind === 'plan' && m.card.plan && <PlanCardInline plan={m.card.plan} runtime={runtime} notify={notify} />}
            {m.card?.kind === 'draft' && m.card.draft && !discarded.has(m.card.draft.id) && (
              <NodeDraftCard
                draft={m.card.draft}
                onAdopt={(d) => runtime.workshop.nodeDev.adoptDraft(d)}
                onDiscard={(d) =>
                  setDiscarded((prev) => {
                    const next = new Set(prev);
                    next.add(d.id);
                    return next;
                  })
                }
                onTrial={(adopted, opts) => runtime.workshop.nodeDev.trialRun(adopted, opts)}
              />
            )}
          </div>
        ))}
        <HitCardsMount runtime={runtime} />
      </div>

      <div className="flex gap-2 border-t border-[var(--line)] p-2.5">
        <input
          ref={inputRef}
          data-workshop="input"
          value={input}
          disabled={busy}
          placeholder="帮我开发一个自定义节点（带脚本资产包）："
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--line-2)] bg-transparent px-2.5 py-1.5 text-xs text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          data-workshop="send"
          disabled={busy}
          onClick={submit}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--ink-on-accent)] disabled:opacity-50"
        >
          {busy ? '…' : '发送'}
        </button>
      </div>
    </aside>
  );
}
