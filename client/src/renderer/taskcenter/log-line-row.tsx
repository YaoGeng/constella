// LogLineRow —— 日志行共享渲染件（T6-11；demo L376-377 .log-line/.lt/.lm 结构＋四级着色）。
//   GlobalLogTab（任务中心日志 tab）与 FlowLogPanel（画布右下流程面板）同一点色语言。
import { cn } from '../lib/utils';
import type { LogLine } from '../run';

/** 级别→消息色（demo L377 逐条：info=tx-2/ok=accent/err=red/warn=amber） */
export const LOG_LINE_LEVEL_CLASS = {
  info: 'text-[var(--tx-2)]',
  ok: 'text-[var(--accent)]',
  err: 'text-[var(--red)]',
  warn: 'text-[var(--amber)]',
} as const;

export function LogLineRow({ line }: { line: LogLine }) {
  return (
    <div data-log-line={line.level} className="flex gap-2 font-mono text-[10.5px] leading-[1.8]">
      <span data-log-ts className="shrink-0 text-[var(--tx-3)]">
        {line.ts}
      </span>
      <span data-log-msg className={cn('min-w-0 break-all', LOG_LINE_LEVEL_CLASS[line.level])}>
        {line.msg}
      </span>
    </div>
  );
}
