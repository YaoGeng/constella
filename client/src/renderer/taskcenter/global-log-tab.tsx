// GlobalLogTab —— 全局日志列表（T6-11；TDD-C-10 §3 GlobalLogTab 行——01 A-9.2）。
//   每行「时间 级别着色 消息」（demo L1278-1296 全局面板 #logList 形；着色 L377）；
//   清空=全局清（A-9.2——清空钮跟 tab 走，归 TaskCenterPanel 头部；本组件纯渲染缓冲快照）。
//   数据面：logs$ Bus snapshot（经 TaskCenterProvider 注入——useGlobalLogLines）。
import type { LogLine } from '../run';
import { LogLineRow } from './log-line-row';

/** 初态空文案（demo L739 逐字） */
export const GLOBAL_LOG_EMPTY_TEXT = '暂无日志 — 跑一个任务试试';
/** 清空后空文案（demo L2684 逐字） */
export const GLOBAL_LOG_CLEARED_TEXT = '已清空';

export interface GlobalLogTabProps {
  /** 全局缓冲快照（logs$ Bus snapshot——publish/clear 产生新引用驱动重渲染） */
  lines: readonly LogLine[];
  /** 清空后空态判据（logs$ Bus wasCleared——缺省 false=初态文案） */
  cleared?: boolean;
}

export function GlobalLogTab({ lines, cleared = false }: GlobalLogTabProps) {
  if (lines.length === 0) {
    return (
      <div data-task-center="log-empty" className="px-2 py-6 text-center text-[11px] leading-5 text-[var(--tx-3)]">
        {cleared ? GLOBAL_LOG_CLEARED_TEXT : GLOBAL_LOG_EMPTY_TEXT}
      </div>
    );
  }
  return (
    <div data-task-center="log-list" className="flex flex-col px-1">
      {lines.map((line, i) => (
        <LogLineRow key={`${line.ts}|${i}`} line={line} />
      ))}
    </div>
  );
}
