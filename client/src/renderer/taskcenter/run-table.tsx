// RunTable —— 任务表渲染（T6-10；TDD-C-10 §3 RunTable 行）。
//   RunRow→行 DOM（01 A-9.1 逐列：状态点色 running 青/waiting 琥珀/error·aborted 红＋流程名＋
//   当前节点多分支「·」连接＋进度 n/m＋CDP 端口 :9221/:9222＋用时 mm:ss）＋空态文案；
//   行内动作=TaskActions（终止/定位注入）；行数据由 runs$ 装配驱动（Panel 传入——用时列
//   1s 心跳刷新经快照重投影，本组件纯渲染）。
//   §3 face {rows,onStop,onGoto}＋activeFlowId 扩展位（RunRow 冻结七字段不含归属判断，
//   定位钮显隐判据 flowId≠activeFlow 需自外部入——demo L2789）。
import { cn } from '../lib/utils';
import { TaskActions } from './task-actions';
import { STATUS_LABEL, STATUS_TONE, fmtElapsed, type RunRow, type StatusTone } from './run-row';

export interface RunTableProps {
  rows: readonly RunRow[];
  /** 终止注入位（贯通 TaskActions.onStop——装配接 C-03 abortRun） */
  onStop: (runId: string) => void;
  /** 定位编排注入位（贯通 TaskActions.onGoto——应用壳/T6-11 脏闸） */
  onGoto: (runId: string) => void;
  /** 定位钮显隐判据（缺省 null=他流程恒显示） */
  activeFlowId?: string | null;
}

/** 状态点色（demo L87-89 dot.ok/.wait/.off 原值——青/琥珀/红＋辉光） */
const TONE_DOT_CLASS: Record<StatusTone, string> = {
  ok: 'bg-[var(--accent)] shadow-[0_0_6px_rgba(103,216,245,0.7)]',
  wait: 'bg-[var(--amber)] shadow-[0_0_6px_rgba(240,179,94,0.7)]',
  off: 'bg-[var(--red)] shadow-[0_0_6px_rgba(255,61,90,0.7)]',
};

/** 空态文案（demo L2773 逐字） */
export const RUN_TABLE_EMPTY_TEXT = '暂无任务 — 点「▶ 运行」启动；并行分支各得独立 CDP 会话，右上角 CDP 列表打开窗口';

export function RunTable({ rows, onStop, onGoto, activeFlowId = null }: RunTableProps) {
  if (rows.length === 0) {
    return (
      <div data-task-center="empty" className="px-2 py-6 text-center text-[11px] leading-5 text-[var(--tx-3)]">
        {RUN_TABLE_EMPTY_TEXT}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-task-center="rows">
      {rows.map((row) => (
        <div
          key={row.runId}
          data-task-row={row.runId}
          className="flex items-center gap-2.5 rounded-[10px] border border-[var(--line)] bg-[rgba(160,200,255,0.03)] px-2.5 py-2"
        >
          <i
            data-task-tone={STATUS_TONE[row.status]}
            aria-hidden
            className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT_CLASS[STATUS_TONE[row.status]])}
          />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-xs font-semibold text-[var(--tx)]">{row.flowName}</b>
            <span data-task-meta className="block truncate font-mono text-[9.5px] text-[var(--tx-3)]">
              {STATUS_LABEL[row.status]}
              {row.currentNodes.length > 0 ? ` · ${row.currentNodes.join(' · ')}` : ''}
              {` · ${row.progress.done}/${row.progress.total}`}
              {row.cdpPorts.length > 0 ? ` · :${row.cdpPorts.join('/:')}` : ''}
            </span>
          </div>
          <span data-task-elapsed={row.runId} className="shrink-0 font-mono text-[10px] text-[var(--tx-2)]">
            {fmtElapsed(row.elapsedMs)}
          </span>
          <TaskActions row={row} activeFlowId={activeFlowId} onStop={onStop} onGoto={onGoto} />
        </div>
      ))}
    </div>
  );
}
