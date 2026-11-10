// PublisherDialog —— 发布弹窗（T5-11 / TDD-C-09 §3 Publisher 行 UI 半段；demo L826-841 参照
// 非权威）。二选一类型（发布节点=类型勾选〔1=node、≥2=pack〕/发布流程=整条流程）＋整条预览
// （流程名·N 节点·M 连线）＋name≤24/summary≤40 前端拦截＋perms 实时推导（C-05 derivePerms
// 注入）＋名称建议未聚焦才覆盖（demo L2902-2913）＋版本 v1.0.0 固定尾注（D-11 首发）。
// 提交→注入的 publish（publisher.ts 编排：字节变体产物→上传/入队——toast 在编排内发）。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlowDoc, FlowListItem } from '@constella/shared/ipc';
import type { PermLabel } from '@constella/shared/dto';
import {
  derivePublishKind,
  suggestPublishName,
  validatePublishForm,
  PUBLISH_NAME_MAX,
  PUBLISH_SUMMARY_MAX,
  type PublishOutcome,
  type PublishSource,
} from './publisher';

/** 类型选项（装配位从 definitions.loadAll 投影——builtin 可选〔勾选仅内置→「无特殊权限」§6.4〕） */
export interface PublisherTypeOption {
  type: string;
  /** 展示名（meta.name） */
  name: string;
  /** 类目（perms 推导输入位——derivePerms 注入侧同源消费 type，此处仅展示） */
  category: string;
  kind: 'builtin' | 'custom';
}

export interface PublisherDialogProps {
  listTypes(): Promise<PublisherTypeOption[]>;
  /** flows.list 面（{items} 形——C-06 直通投影） */
  listFlows(): Promise<{ items: FlowListItem[] }>;
  /** 流程详情（整条预览：节点/连线数——flows.get 面） */
  getFlow(flowId: string): Promise<FlowDoc>;
  /** perms 实时推导（C-05 PermDeriver 同源——装配注入；仅 builtin 勾选→[]） */
  derivePerms(types: readonly string[]): PermLabel[];
  /** 发布编排（createPublisher 装配注入——202/入队 toast 在编排内发） */
  publish(args: { name: string; summary: string }, source: PublishSource): Promise<PublishOutcome>;
  onClose(): void;
}

type PubMode = 'node' | 'flow';

export function PublisherDialog(props: PublisherDialogProps) {
  const [mode, setMode] = useState<PubMode>('node');
  const [types, setTypes] = useState<PublisherTypeOption[]>([]);
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flowId, setFlowId] = useState<string | null>(null);
  const [flowDoc, setFlowDoc] = useState<FlowDoc | null>(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void props.listTypes().then(setTypes).catch(() => setTypes([]));
    void props
      .listFlows()
      .then(({ items }) => {
        setFlows(items);
        if (items.length > 0) setFlowId(items[0]!.id); // 缺省选首个流程（demo pubSel 同缺省）
      })
      .catch(() => setFlows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 装配面一次性装载（props.identity 装配期稳定）
  }, []);

  // 整条预览：流程选中→取详情（节点/连线数）
  useEffect(() => {
    if (mode !== 'flow' || flowId === null) {
      setFlowDoc(null);
      return;
    }
    let cancelled = false;
    void props
      .getFlow(flowId)
      .then((doc) => {
        if (!cancelled) setFlowDoc(doc);
      })
      .catch(() => {
        if (!cancelled) setFlowDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, flowId, props]);

  const selectedTypes = useMemo(() => types.filter((t) => selected.has(t.type)), [types, selected]);
  const flowName = useMemo(() => flows.find((f) => f.id === flowId)?.name ?? null, [flows, flowId]);
  const perms = useMemo(
    () => (mode === 'flow' ? props.derivePerms([...new Set(flowDoc?.nodes.map((n) => n.type) ?? [])]) : props.derivePerms([...selected])),
    [mode, selected, flowDoc, props],
  );

  // 名称建议（demo L2902-2913：输入框未聚焦才覆盖——不抢用户输入；仅选择变化触发覆盖，
  // 失焦本身不回写〔pubAutoMeta 只在选择变化时被调——demo 同源〕）
  const suggestion = suggestPublishName(mode, [...selected], flowName, (t) => types.find((x) => x.type === t)?.name ?? t);
  const lastSuggestionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!nameFocused && suggestion !== lastSuggestionRef.current) setName(suggestion);
    lastSuggestionRef.current = suggestion;
  }, [suggestion, nameFocused]);

  const kind = derivePublishKind(mode, [...selected]);
  const formError = validatePublishForm(name, summary, mode === 'flow' ? 1 : selected.size, kind);

  const toggleType = (type: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const submit = (): void => {
    if (formError !== null) {
      setError(formError); // 前端拦截（§6.4：name>24/summary>40 不上传）
      return;
    }
    if (mode === 'flow' && (flowDoc?.nodes.length ?? 0) === 0) {
      setError('当前流程没有节点可发布');
      return;
    }
    setError(null);
    setBusy(true);
    const source: PublishSource = mode === 'flow' ? { flowId: flowId! } : { types: [...selected] };
    void props
      .publish({ name: name.trim(), summary: summary.trim() }, source)
      .then(() => props.onClose()) // 202→「已提交审核」/入队提示 toast 在编排内发——成功即关弹窗
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  };

  return (
    <div data-publisher="root" className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(3,6,16,0.72)]">
      <div
        data-publisher="panel"
        className="flex w-[480px] max-w-[92vw] flex-col gap-3 rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <b className="text-base font-semibold text-[var(--tx)]">发布到广场</b>
          <span className="font-mono text-[10px] text-[var(--tx-3)]">打包 zip → 审核 → 上架</span>
          <button
            type="button"
            data-publisher="close"
            className="rounded px-2 py-0.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <div className="flex gap-2" data-publisher="type">
          <button
            type="button"
            data-publisher="type-node"
            className={`flex-1 rounded-md border px-3 py-2 text-sm ${mode === 'node' ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'border-[var(--line-2)] text-[var(--tx-2)]'}`}
            onClick={() => setMode('node')}
          >
            发布节点
          </button>
          <button
            type="button"
            data-publisher="type-flow"
            className={`flex-1 rounded-md border px-3 py-2 text-sm ${mode === 'flow' ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'border-[var(--line-2)] text-[var(--tx-2)]'}`}
            onClick={() => setMode('flow')}
          >
            发布流程
          </button>
        </div>

        {mode === 'node' ? (
          <div data-publisher="pick" className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--line-2)] p-2">
            {types.length === 0 && <p className="p-2 text-center text-xs text-[var(--tx-3)]">节点库为空</p>}
            {types.map((t) => (
              <label key={t.type} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)]">
                <input
                  type="checkbox"
                  data-publisher="type-check"
                  data-type={t.type}
                  checked={selected.has(t.type)}
                  onChange={() => toggleType(t.type)}
                />
                <span data-pick-name={t.type}>{t.name}</span>
                <span className="ml-auto font-mono text-[10px] text-[var(--tx-3)]">
                  {t.kind === 'builtin' ? '内置' : '自研'}·{t.category}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div data-publisher="flow-pick" className="flex flex-col gap-1">
            <select
              data-publisher="flow-select"
              className="rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-2 py-1.5 text-sm text-[var(--tx)]"
              value={flowId ?? ''}
              onChange={(e) => setFlowId(e.target.value)}
            >
              {flows.length === 0 && <option value="">（无流程）</option>}
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {/* 整条预览（demo L2896：流程名·N 节点·M 连线·整条流程打包） */}
            <p data-publisher="flow-preview" className="rounded-md border border-dashed border-[var(--line-2)] px-2 py-1.5 text-xs text-[var(--tx-3)]">
              {flowDoc !== null ? `${flowDoc.name} · ${flowDoc.nodes.length} 节点 · ${flowDoc.edges.length} 连线 · 整条流程打包` : '读取流程…'}
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-[var(--tx-2)]">
          <span className="w-10 shrink-0">名称</span>
          <input
            ref={nameInputRef}
            data-publisher="name"
            className="min-w-0 flex-1 rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-2 py-1.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
            maxLength={PUBLISH_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
          />
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--tx-3)]">
            {name.length}/{PUBLISH_NAME_MAX}
          </span>
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--tx-2)]">
          <span className="w-10 shrink-0">简介</span>
          <input
            data-publisher="summary"
            className="min-w-0 flex-1 rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-2 py-1.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
            maxLength={PUBLISH_SUMMARY_MAX}
            placeholder="一句话说明用途…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--tx-3)]">
            {summary.length}/{PUBLISH_SUMMARY_MAX}
          </span>
        </label>

        <div className="flex items-center gap-2 text-xs text-[var(--tx-2)]" data-publisher="perms">
          <span className="shrink-0">权限声明（自动推导）</span>
          {perms.length > 0 ? (
            perms.map((p) => (
              <span key={p} data-publisher="perm" className="rounded border border-[var(--line-2)] px-1.5 leading-4">
                {p}
              </span>
            ))
          ) : (
            <span data-publisher="perm-none" className="text-[10.5px] text-[var(--tx-3)]">
              无特殊权限
            </span>
          )}
        </div>

        {error !== null && (
          <p data-publisher="error" className="rounded-md border border-[rgba(120,60,60,0.6)] bg-[rgba(120,20,40,0.18)] px-2 py-1.5 text-xs text-[#ff9db0]">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-[10px] text-[var(--tx-3)]">版本 v1.0.0</span>
          <div className="flex gap-2">
            <button
              type="button"
              data-publisher="cancel"
              className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-xs text-[var(--tx-2)] hover:border-[var(--accent)]"
              onClick={props.onClose}
            >
              取消
            </button>
            <button
              type="button"
              data-publisher="submit"
              disabled={busy}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[#04101f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={submit}
            >
              {busy ? '发布中…' : '打包并发布'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
