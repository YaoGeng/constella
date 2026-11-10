// TaskActions —— 任务行内动作（T6-10；TDD-C-10 §3 TaskActions 行）。
//   终止：仅 running 行显示（demo L2788 data-act=stop）——点击经注入 onStop(runId) 单次派发
//   （装配位接 C-03 abortRun，02 §10 #8 终止扩散；「恰一次」由本侧单次派发＋注入方幂等双保证）；
//   定位：仅 flowId≠activeFlow 行显示（demo L2789 data-act=goto）——注入位 onGoto(runId)，
//   脏闸检查/切流程/还原/panToNode 编排归应用壳（T6-17）；脏闸冻结形态（dirty→toast 拒绝）
//   归 T6-11——本卡只留注入位。
import { STATUS_LABEL, type RunRow } from './run-row';

export interface TaskActionsProps {
  row: RunRow;
  /** 定位钮显隐判据（flowId≠activeFlow 才显示；缺省 null=他流程恒显示） */
  activeFlowId?: string | null;
  /** 终止注入位（装配接 C-03 abortRun(runId)） */
  onStop: (runId: string) => void;
  /** 定位编排注入位（应用壳——脏闸归 T6-11 冻结形态） */
  onGoto: (runId: string) => void;
}

export function TaskActions({ row, activeFlowId = null, onStop, onGoto }: TaskActionsProps) {
  return (
    <div className="flex shrink-0 gap-1" data-task-actions={row.runId}>
      {row.status === 'running' && (
        <button
          type="button"
          data-task-act="stop"
          data-run-id={row.runId}
          title={`终止「${row.flowName}」（${STATUS_LABEL[row.status]}）`}
          className="inline-flex h-[22px] items-center rounded-md border border-[var(--red-line)] px-2 text-[11px] tracking-wide text-[var(--red)] transition-colors hover:bg-[var(--red-tint)]"
          onClick={() => onStop(row.runId)}
        >
          终止
        </button>
      )}
      {row.flowId !== activeFlowId && (
        <button
          type="button"
          data-task-act="goto"
          data-run-id={row.runId}
          title={`定位到流程「${row.flowName}」`}
          className="inline-flex h-[22px] items-center rounded-md border border-[var(--line)] px-2 text-[11px] tracking-wide text-[var(--tx-2)] transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
          onClick={() => onGoto(row.runId)}
        >
          定位
        </button>
      )}
    </div>
  );
}
