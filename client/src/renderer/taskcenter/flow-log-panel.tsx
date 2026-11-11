// FlowLogPanel —— 画布右下流程实时日志面板（T6-11；TDD-C-10 §3 FlowLogPanel 行——01 A-9.3）。
//   380×300（A-9.3，demo L543）；打开/切流程重放该流程全部历史行（logs.list{flowId} 经注入
//   replayLogs——demo L2966-2980/L1707）；开着时新行实时过滤追加（flowId===currentFlowId——
//   demo L1289-1295）＋自动滚底；✕ 关闭（宿主隐藏面板——挂载位=画布右下，T6-17）。
//   §3 face {flowId}（宿主传值——currentFlowId getter 由应用壳注入，P-3 不 import 画布域）；
//   实时订阅注入 subscribeLogs（logs$ Bus.subscribe）。
//   重放在途竞态：订阅先行、行进 pending 缓冲，重放装载后按键去重合并（同点双源防重——
//   02 §7.1 logs 行无 id，ts|level|msg 复合键）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LogLine } from '../run';
import { LogLineRow } from './log-line-row';

/** 面板宽（A-9.3，demo L543 width:380px） */
export const FLOW_LOG_PANEL_WIDTH = 380;
/** 面板高（demo L543 height:300px） */
export const FLOW_LOG_PANEL_HEIGHT = 300;
/** 空态文案（demo L2974 逐字） */
export const FLOW_LOG_EMPTY_TEXT = '该流程还没有日志 — 点「▶ 运行」';

export interface FlowLogPanelProps {
  /** 当前流程过滤键（宿主注入 currentFlowId getter 的求值结果——切流程换值即清空重放） */
  flowId: string;
  /** 流程名（头部显示——宿主传值） */
  flowName?: string;
  /** 历史行重放注入（LogReplayService.replayLogs——logs.list{flowId}） */
  replayLogs(flowId: string): Promise<readonly LogLine[]>;
  /** 实时行订阅注入（logs$ Bus.subscribe——双路之一） */
  subscribeLogs(fn: (line: LogLine) => void): () => void;
  /** ✕ 关闭回调（宿主隐藏面板） */
  onClose(): void;
}

function lineKey(l: LogLine): string {
  return `${l.ts}|${l.level}|${l.msg}`;
}

export function FlowLogPanel({ flowId, flowName = '', replayLogs, subscribeLogs, onClose }: FlowLogPanelProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<LogLine[]>([]);
  const replayingRef = useRef(false);

  // 打开/切流程：清空＋重放（demo L2966-2980——list.innerHTML='' 后逐行装载）
  useEffect(() => {
    replayingRef.current = true;
    pendingRef.current = [];
    setLines([]);
    let cancelled = false;
    void replayLogs(flowId)
      .then((replayed) => {
        if (cancelled) return;
        const replayedKeys = new Set(replayed.map(lineKey));
        const pending = pendingRef.current.filter((l) => !replayedKeys.has(lineKey(l))); // 双源同行去重
        replayingRef.current = false;
        pendingRef.current = [];
        setLines([...replayed, ...pending]);
      })
      .catch(() => {
        // 重放失败不炸面板（宿主可重试）；重放在途缓冲的实时行 flush 保留——不静默丢弃（T6-16 收口，batch-2 登记②）
        if (!cancelled) {
          replayingRef.current = false;
          setLines(pendingRef.current); // catch flush：缓冲行照常上屏（无重放行可合并，全量保留）
          pendingRef.current = [];
        }
      });
    return () => {
      cancelled = true;
    };
  }, [flowId, replayLogs]);

  // 实时追加：仅当前流程行（demo L1293 `flowId&&flowId===activeFlow` 判据——无 flowId 行归全局 tab）
  useEffect(() => {
    return subscribeLogs((line) => {
      if (line.flowId !== flowId) return;
      if (replayingRef.current) {
        pendingRef.current.push(line); // 重放在途回放缓冲（装载时合并）
        return;
      }
      setLines((prev) => [...prev, line]); // 恰一次追加
    });
  }, [subscribeLogs, flowId]);

  // 自动滚底（demo L1290/L1295 双路同点——重放装载与实时追加统一驱动）
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section
      data-flow-log="panel"
      style={{ width: FLOW_LOG_PANEL_WIDTH, height: FLOW_LOG_PANEL_HEIGHT }}
      className="absolute bottom-0 right-0 z-[18] flex flex-col overflow-hidden rounded-tl-xl border border-[var(--line)] bg-[var(--glass)] shadow-[0_14px_40px_rgba(0,0,0,0.55)] backdrop-blur-[10px]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <b className="text-xs">流程日志</b>
        <span data-flow-log="flow-name" className="font-mono text-[9.5px] text-[var(--tx-3)]">
          {flowName}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          data-flow-log="close"
          aria-label="收起流程日志面板"
          className="rounded-md border border-[var(--line)] px-1.5 text-[11px] text-[var(--tx-3)] transition-colors hover:border-[var(--accent-line)] hover:text-[var(--accent-hi)]"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div data-flow-log="list" ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[10px] leading-[1.7]">
        {lines.length === 0 ? (
          <div data-flow-log="empty" className="px-0 py-5 text-center text-[11px] text-[var(--tx-3)]">
            {FLOW_LOG_EMPTY_TEXT}
          </div>
        ) : (
          lines.map((l, i) => <LogLineRow key={`${lineKey(l)}|${i}`} line={l} />)
        )}
      </div>
    </section>
  );
}
