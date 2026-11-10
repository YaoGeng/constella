// TaskCenterPanel —— 任务中心抽屉壳（T6-10；TDD-C-10 §3 TaskCenterPanel 行）。
//   右侧全高 480px 抽屉（01 §13 TC-2 裁定；demo L365）＋毛玻璃遮罩；任务/日志双 tab
//   （任务=RunTable；日志=占位——T6-11 GlobalLogTab 填充）；Esc 层级序应答（本层=任务中心
//   抽屉收起：开即应答；escGate()=false=上层浮层在场不应答——A-1.4「CDP 查看窗→抽屉→
//   任务中心→弹窗」全局序接线归应用壳 T6-17）；点遮罩/✕ 收起（demo L2666-2680）。
//   开合态=uiStore 任务中心位（02 §3.3）——§3「无 props（开合态=uiStore）」：数据/动作经
//   TaskCenterProvider 注入（context），本组件零 props。挂载归应用壳（T6-17）。
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { useUiStore } from './ui-store';
import { useRunRows, useTaskCenter } from './task-center-context';
import { RunTable } from './run-table';

/** 抽屉宽（01 §13 TC-2 裁定：采信 demo L365 width:480px，右侧全高非全屏） */
export const TASK_CENTER_WIDTH = 480;

const NOOP = (): void => {};

export function TaskCenterPanel() {
  const open = useUiStore((s) => s.taskCenterOpen);
  const close = useUiStore((s) => s.closeTaskCenter);
  const handle = useTaskCenter();
  const rows = useRunRows();
  const [tab, setTab] = useState<'tasks' | 'logs'>('tasks');

  // Esc 层级序应答（A-1.4）：本层收起仅当抽屉开且无上层浮层在场（escGate 仲裁注入位）
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      if (handle !== null && !handle.escGate()) return; // 上层（CDP 查看窗/节点抽屉）消费
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, handle]);

  return (
    <>
      {open && (
        <div
          data-task-center="shade"
          aria-hidden
          className="fixed inset-0 z-40 bg-[rgba(1,2,7,0.42)] backdrop-blur-[6px]"
          onClick={close}
        />
      )}
      <aside
        data-task-center="panel"
        data-open={open}
        aria-hidden={!open}
        style={{ width: TASK_CENTER_WIDTH }}
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full flex-col border-l border-[var(--line-2)] bg-[var(--glass)] backdrop-blur-[14px] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between px-4 pb-1 pt-3">
          <h2 className="text-sm font-semibold text-[var(--tx)]">任务中心</h2>
          <button
            type="button"
            data-task-center="close"
            aria-label="收起任务中心"
            className="rounded-md border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--tx-2)] hover:border-[var(--accent-line)] hover:text-[var(--accent-hi)]"
            onClick={close}
          >
            ✕
          </button>
        </header>
        <nav className="flex gap-1 px-4 pb-2 pt-1" aria-label="任务中心视图">
          <button
            type="button"
            data-task-center-tab="tasks"
            aria-pressed={tab === 'tasks'}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors',
              tab === 'tasks' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-3)] hover:text-[var(--tx-2)]',
            )}
            onClick={() => setTab('tasks')}
          >
            任务
          </button>
          <button
            type="button"
            data-task-center-tab="logs"
            aria-pressed={tab === 'logs'}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors',
              tab === 'logs' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-3)] hover:text-[var(--tx-2)]',
            )}
            onClick={() => setTab('logs')}
          >
            日志
          </button>
        </nav>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {tab === 'tasks' ? (
            <RunTable
              rows={rows}
              onStop={handle?.abortRun ?? NOOP}
              onGoto={handle?.onGoto ?? NOOP}
              activeFlowId={handle?.activeFlowId() ?? null}
            />
          ) : (
            // 日志 tab 占位（T6-11 GlobalLogTab 填充：级别着色/清空=全局清——demo L377/L2682-2686）
            <div data-task-center="log-placeholder" className="px-2 py-6 text-center text-[11px] leading-5 text-[var(--tx-3)]">
              暂无日志
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
