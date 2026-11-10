// NodeDraftCard —— 现场开发草稿卡 UI（T6-17 补齐件；TDD-C-07 §3 ConfirmGate 行「草稿卡」的
// 渲染面——T5-03 交付注「NodeDraft 返回调用方挂 ConfirmGate 草稿卡」，此前无宿主渲染件）。
//
// 02 §12.2#2 脚本明示（卡面②冻结要求）：**adopt 前展示脚本内容**＋「将执行本机脚本」明示
// （InstallConfirm 同款警示文案）——未确认不入库不落画布；弱节点（exec=null）明示无脚本。
// adopt 后进入试跑段（B-5：params/input 手输＋事件回显——NodeDevAgent.trialRun 注入编排）。
// 纯展示＋状态机：adopt/trial 编排全注入（装配位接 NodeDevAgent——P-3 本组件零模块 import）。
import { useState } from 'react';
import type { ScriptEvent } from '@constella/shared/ipc';
import type { AdoptDraftResult, NodeDraft, TrialRunHandle } from './node-dev-agent';

/** 试跑输入（params 覆盖底数＋上游输入手输） */
export interface NodeTrialPanelProps {
  adopted: AdoptDraftResult;
  onTrial(
    adopted: AdoptDraftResult,
    opts: { params?: Record<string, unknown>; input?: unknown; onEvent(evt: ScriptEvent): void },
  ): Promise<TrialRunHandle>;
}

function fmtEvent(evt: ScriptEvent): string {
  if (evt.kind === 'exit') return `[exit] code=${String(evt.code)} ms=${String(evt.ms)}`;
  return `[${evt.kind}] ${evt.chunk ?? ''}`;
}

/** 试跑面板（adopted 资产 spawnScript 直调——02 §12.2#3 合法面；事件回显 run:scriptEvent） */
export function NodeTrialPanel({ adopted, onTrial }: NodeTrialPanelProps) {
  const [paramsText, setParamsText] = useState(() => JSON.stringify(adopted.trial?.params ?? {}, null, 1));
  const [inputText, setInputText] = useState('null');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (adopted.trial === null) {
    return (
      <div data-draft-trial="unsupported" className="rounded-md border border-[var(--line-2)] px-2 py-1.5 text-xs text-[var(--tx-3)]">
        该节点无可试跑脚本（资产未随包安装——02 §12.2#3）
      </div>
    );
  }

  const run = (): void => {
    let params: Record<string, unknown>;
    let input: unknown;
    try {
      params = paramsText.trim() === '' ? {} : (JSON.parse(paramsText) as Record<string, unknown>);
      input = inputText.trim() === '' ? null : (JSON.parse(inputText) as unknown);
    } catch (err) {
      setError(`参数/输入 JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setError(null);
    setRunning(true);
    setDone(false);
    setEvents([]);
    void onTrial(adopted, {
      params,
      input,
      onEvent: (evt) => {
        setEvents((prev) => [...prev, fmtEvent(evt)]);
        if (evt.kind === 'exit') {
          setRunning(false); // 运行态保持至 exit 帧（返工 MINOR-3：spawn 受理不复位——防重复起跑）
          setDone(true);
        }
      },
    }).catch((err) => {
      setRunning(false); // spawn 失败即复位（exit 帧不会到达）
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div data-draft-trial="panel" className="flex flex-col gap-1.5 rounded-md border border-[var(--line)] bg-[var(--glass-2)] p-2">
      <b className="text-xs text-[var(--tx)]">试跑（{adopted.trial.lang} · {adopted.trial.scriptPath}）</b>
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--tx-2)]">
        参数（JSON，覆盖默认值）
        <textarea
          data-draft-trial="params"
          rows={3}
          disabled={running}
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          className="rounded border border-[var(--line-2)] bg-transparent px-1.5 py-1 font-mono text-[11px] text-[var(--tx)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--tx-2)]">
        上游输入（JSON）
        <textarea
          data-draft-trial="input"
          rows={2}
          disabled={running}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="rounded border border-[var(--line-2)] bg-transparent px-1.5 py-1 font-mono text-[11px] text-[var(--tx)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <button
        type="button"
        data-draft-trial="run"
        disabled={running}
        onClick={run}
        className="self-start rounded-md border border-[var(--accent-line)] bg-[var(--accent-tint)] px-3 py-1 text-xs text-[var(--accent-hi)] disabled:opacity-50"
      >
        {running ? '试跑中…' : '▶ 试跑'}
      </button>
      {error !== null && (
        <div data-draft-trial="error" className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1 text-xs text-[#ff9db0]">
          {error}
        </div>
      )}
      {events.length > 0 && (
        <pre data-draft-trial="events" className="max-h-40 overflow-y-auto rounded border border-[var(--line-2)] bg-[rgba(1,2,7,0.5)] p-1.5 font-mono text-[10px] leading-relaxed text-[var(--tx-2)]">
          {events.join('\n')}
        </pre>
      )}
      {done && <span data-draft-trial="done" className="text-[10px] text-[var(--tx-3)]">试跑结束</span>}
    </div>
  );
}

export interface NodeDraftCardProps {
  draft: NodeDraft;
  /** 确认后「加入画布」（NodeDevAgent.adoptDraft——A-10.2 唯一确认点收口后唯一写入触发） */
  onAdopt(draft: NodeDraft): Promise<AdoptDraftResult>;
  /** 放弃草稿（宿主隐藏卡——workshopStore 无移除面，宿主层置弃标） */
  onDiscard(draft: NodeDraft): void;
  /** 试跑编排（NodeDevAgent.trialRun 注入） */
  onTrial: NodeTrialPanelProps['onTrial'];
}

type Phase = 'draft' | 'adopting' | 'adopted';

/** 草稿卡（develop 产物挂对话流停确认——demo L2432-2447「已通过自检」语义） */
export function NodeDraftCard({ draft, onAdopt, onDiscard, onTrial }: NodeDraftCardProps) {
  const [phase, setPhase] = useState<Phase>('draft');
  const [error, setError] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<AdoptDraftResult | null>(null);

  const adopt = (): void => {
    setPhase('adopting');
    setError(null);
    void onAdopt(draft)
      .then((res) => {
        setAdopted(res);
        setPhase('adopted');
      })
      .catch((err) => {
        setPhase('draft'); // 失败回可确认态（错误上卡不弃卡——与 hit 卡同口径）
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const files = [
    ...(draft.script !== undefined ? [draft.script.file] : []),
    ...(draft.config !== undefined ? [draft.config.file] : []),
    ...(draft.deps !== undefined ? [draft.deps.file] : []),
  ];

  return (
    <div
      data-draft-card={draft.id}
      data-draft-phase={phase}
      className="flex flex-col gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--glass)] p-3"
    >
      {/* 头：✨ 展示名（type）· 版本＋「已通过自检」（demo L2434） */}
      <div className="flex items-center gap-2">
        <span aria-hidden>✨</span>
        <b data-draft="name" className="text-sm font-semibold text-[var(--tx)]">
          {draft.name}
        </b>
        <span data-draft="type" className="font-mono text-[11px] text-[var(--tx-3)]">
          {draft.type} · v{draft.definition.packageVersion}
        </span>
        <span data-draft="checked" className="ml-auto rounded border border-[var(--accent-line)] bg-[var(--accent-tint)] px-1.5 py-0.5 text-[10px] leading-4 text-[var(--accent-hi)]">
          已通过自检
        </span>
      </div>

      {/* 资产清单（manifest 四件套投影） */}
      <div data-draft="files" className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--tx-2)]">
        <span>资产：</span>
        {files.length === 0 ? (
          <span>仅定义（弱节点——无脚本资产）</span>
        ) : (
          files.map((f) => (
            <code key={f} className="rounded border border-[var(--line-2)] px-1 py-0.5 font-mono text-[10px]">
              {f}
            </code>
          ))
        )}
      </div>

      {/* 02 §12.2#2 脚本明示：adopt 前展示脚本内容＋「将执行本机脚本」警示（InstallConfirm 同款） */}
      {draft.script !== undefined ? (
        <>
          <pre
            data-draft="script"
            className="max-h-56 overflow-y-auto rounded-md border border-[var(--line-2)] bg-[rgba(1,2,7,0.5)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--tx-2)]"
          >
            {`# ${draft.script.file} (${draft.script.lang})\n${draft.script.code}`}
          </pre>
          <p data-draft="run-script" className="rounded bg-[rgba(191,120,10,0.18)] px-2 py-1 text-xs text-[#ffcf8d]">
            ⚠ 将执行本机脚本——加入画布并运行即代表信任该来源（02 §12.2#2）
          </p>
        </>
      ) : (
        <p data-draft="weak" className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1 text-xs text-[#ff9db0]">
          ⚠ 无脚本资产（弱节点——不可运行，仅作数据/逻辑占位）
        </p>
      )}

      {error !== null && (
        <div data-draft="error" className="rounded bg-[rgba(120,20,40,0.25)] px-2 py-1.5 text-xs text-[#ff9db0]">
          {error}
        </div>
      )}

      {phase !== 'adopted' ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-draft-action="discard"
            disabled={phase === 'adopting'}
            onClick={() => onDiscard(draft)}
            className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-xs text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-50"
          >
            放弃
          </button>
          <button
            type="button"
            data-draft-action="adopt"
            disabled={phase === 'adopting'}
            onClick={adopt}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--ink-on-accent)] hover:brightness-110 disabled:opacity-50"
          >
            {phase === 'adopting' ? '加入画布中…' : '确认加入画布'}
          </button>
        </div>
      ) : (
        adopted !== null && (
          <div data-draft="adopted" className="flex flex-col gap-2">
            <p className="text-xs text-[var(--tx-2)]">
              已加入画布（{adopted.name} · {adopted.type}）——已定位到新节点并打开编辑抽屉
            </p>
            <NodeTrialPanel adopted={adopted} onTrial={onTrial} />
          </div>
        )
      )}
    </div>
  );
}
