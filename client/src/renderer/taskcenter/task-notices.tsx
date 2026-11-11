// TaskNotices —— 任务中心提示行（T6-11；TDD-C-10 §8① lane 内存告警行＋§8② cron missed 提示）。
//   §8①：单 lane 会话预算 ≤150MB（01 §12 非功能表；LANE_MEMORY_BUDGET_BYTES=X-01 冻结值），
//   超预算在任务中心告警——数据通道=env:systemInfo payload lanes 数组（✅ T6-16 mock 解除复跑
//   落位：真数据面已 renderer 可达——main domain-channels handleEnvSystemInfo lanes=deps.laneMemory()
//   〔production-assembly→CdpSessionManager.laneMemory 聚合〕，经既有 env:systemInfo 冻结通道；
//   生产装配=assembly/app-runtime 10s 轮询缓存→taskCenterDeps.laneMemories getter 注入本组件
//   ——真形复跑测试见 assembly/app-shell.spec〔runtime＋jsdom UI 两形〕）；
//   §8②：A-6.6「上次计划触发 <时间> 未执行，可手动运行」——只提示不补跑；数据=restoreRunState
//   启动自算 missedFires（log-replay-service——notices store 装配位 setMissed 消费）。
import { LANE_MEMORY_BUDGET_BYTES, type LaneMemory } from '@constella/shared/ipc';
import type { CronMissedNotice } from './log-replay-service';

/** 超预算 lane 过滤（> 预算——恰等于预算不告警） */
export function overBudgetLanes(lanes: readonly LaneMemory[]): LaneMemory[] {
  return lanes.filter((l) => l.workingSetBytes > LANE_MEMORY_BUDGET_BYTES);
}

/** lane 内存告警文案（MB 取整；预算=X-01 冻结 150MB） */
export function laneMemoryAlertText(lane: LaneMemory): string {
  const mb = Math.round(lane.workingSetBytes / (1024 * 1024));
  const budgetMb = Math.round(LANE_MEMORY_BUDGET_BYTES / (1024 * 1024));
  return `「${lane.label}」内存 ${mb}MB 超预算（${budgetMb}MB）`;
}

/** 提示行时间（本地墙钟 YYYY-MM-DD HH:mm——分钟粒度与 cron 对齐） */
export function formatMissedTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** cron missed 提示文案（A-6.6 逐字模板：上次计划触发 <时间> 未执行，可手动运行） */
export function cronMissedText(n: CronMissedNotice): string {
  return `上次计划触发 ${formatMissedTime(n.lastFireAt)} 未执行，可手动运行`;
}

/** cron missed 提示 store（restoreRunState 异步产出 → TaskCenterPanel 渲染面——T6-17 装配位） */
export interface MissedNoticeStore {
  subscribe(fn: () => void): () => void;
  snapshot(): readonly CronMissedNotice[];
  setMissed(list: readonly CronMissedNotice[]): void;
}

export function createMissedNoticeStore(): MissedNoticeStore {
  let list: readonly CronMissedNotice[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => list,
    setMissed(next) {
      list = [...next];
      for (const fn of [...listeners]) fn();
    },
  };
}

export interface TaskNoticesProps {
  /** cron missed 提示（restoreRunState 产出——A-6.6） */
  missed: readonly CronMissedNotice[];
  /** lane 会话内存快照（注入位——生产=env:systemInfo lanes 轮询缓存真数据〔T6-16 复跑落位〕） */
  laneMemories: readonly LaneMemory[];
}

export function TaskNotices({ missed, laneMemories }: TaskNoticesProps) {
  const overLanes = overBudgetLanes(laneMemories);
  if (missed.length === 0 && overLanes.length === 0) return null; // 零提示零占位
  return (
    <div data-task-notices className="mb-2 flex flex-col gap-1">
      {missed.map((m) => (
        <div
          key={`cron-${m.flowId}`}
          data-task-notice="cron-missed"
          className="rounded-[8px] border border-[var(--amber-line)] bg-[rgba(240,179,94,0.06)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--amber)]"
        >
          {cronMissedText(m)}
        </div>
      ))}
      {overLanes.map((l) => (
        <div
          key={`lane-${l.laneKey}`}
          data-task-notice="lane-memory"
          className="rounded-[8px] border border-[var(--red-line)] bg-[rgba(255,61,90,0.06)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--red)]"
        >
          {laneMemoryAlertText(l)}
        </div>
      ))}
    </div>
  );
}
