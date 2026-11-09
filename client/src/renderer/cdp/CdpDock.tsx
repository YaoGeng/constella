// CdpDock —— 画布右上会话 dock（T4-06；TDD-C-04 §1 管理面段＋§3 CdpDock 行；
// demo L665-668/L2822-2847 行为源：按钮=会话数徽标、无会话隐藏；展开=会话列表
// （分支名/去协议头 URL/:端口）；收起态只刷计数；点 item 开对应查看窗）。
//
// 数据源=cdp:listSessions 投影（CdpSessionsModel 只读——lanes 台账 C-M1 写入，本卡零表）；
// 挂载=画布右上（P5 应用壳装配位——本组件只交付件，不触 canvas/）。UI=shadcn copy-in
// 手工基线风格＋tailwind（definition/form/controls.tsx 先例）。
import { useEffect, useState } from 'react';
import type { CdpSessionsModel } from './cdp-sessions-model';
import { stripUrlProtocol } from './cdp-sessions-model';

/** §1 CdpDock 接口（TDD-C-04 §1 逐字：refresh/onLaneChange——Face 后缀避免与本 React 组件
 * 同名冲突；成员签名与 §1 完全一致）。 */
export interface CdpDockFace {
  refresh(): void;
  onLaneChange(fn: () => void): () => void;
}

/** dock 组件 props（model/runId=投影数据源；onOpenSession=dock 点击→SessionViewer.open 接线） */
export interface CdpDockProps {
  model: CdpSessionsModel;
  runId: string;
  onOpenSession(laneKey: string): void;
}

/** §1 CdpDock 面（refresh=投影重查触发——demo syncModeUI 统一触发同源；onLaneChange=订阅） */
export function createCdpDockFace(model: CdpSessionsModel, runId: string): CdpDockFace {
  return {
    refresh: () => {
      void model.refresh(runId).catch(() => {
        /* 通道异常=dock 维持上次投影（隐藏态兜底在组件内）——B-14 不静默吞，留日志面随 P5 */
      });
    },
    onLaneChange: (fn: () => void) => model.onChange(() => fn()),
  };
}

/** 会话 dock 组件（无会话隐藏；徽标=会话数；列表项=laneKey/label/去协议头 URL/:port） */
export function CdpDock({ model, runId, onOpenSession }: CdpDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => model.onChange(() => setTick((t) => t + 1)), [model]);
  useEffect(() => {
    void model.refresh(runId).catch(() => {
      /* 挂载首查失败→空投影（隐藏态）；后续 refresh 由装配点/face 驱动 */
    });
  }, [model, runId]);

  const sessions = model.sessionsOf(runId);
  if (sessions.length === 0) return null; // 无会话隐藏（demo L2829 dock.hidden）

  return (
    <div data-dock="root" className="flex flex-col items-end gap-2">
      <button
        type="button"
        data-dock="toggle"
        title="CDP 会话列表"
        className="flex items-center gap-2 rounded-md border border-[var(--line-2)] bg-[rgba(9,14,28,0.62)] px-3 py-1.5 text-sm text-[var(--tx)] hover:border-[var(--accent)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <span aria-hidden>🌐 CDP</span>
        <i
          data-dock="badge"
          className="min-w-5 rounded-full bg-[var(--accent-tint)] px-1.5 text-center font-mono text-xs not-italic leading-5 text-[var(--accent-hi)]"
        >
          {sessions.length}
        </i>
      </button>
      {expanded && (
        <div
          data-dock="list"
          className="flex w-72 flex-col gap-1 rounded-md border border-[var(--line-2)] bg-[rgba(9,14,28,0.62)] p-2"
        >
          {sessions.map((s) => (
            <button
              type="button"
              key={s.laneKey}
              data-dock-item={s.laneKey}
              title={`打开 CDP 窗口 — ${s.label} :${s.port}`}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--accent-tint)]"
              onClick={() => onOpenSession(s.laneKey)}
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <b data-lane="label" className="truncate text-sm font-semibold text-[var(--tx)]">
                  {s.label}
                </b>
                <span data-lane="url" className="truncate font-mono text-xs text-[var(--tx-3)]">
                  {stripUrlProtocol(s.url)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-[var(--tx-2)]">:{s.port}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
