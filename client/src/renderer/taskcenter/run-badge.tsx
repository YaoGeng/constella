// RunBadge —— 任务中心导航徽标（T6-10；TDD-C-10 §1「导航徽标：running 计数 n>0 显示」；
// demo L2763-2767 renderNavBadge 行为源：b.hidden=!n）。渲染件归应用壳（T6-17 导航挂载），
// 数据=runningCountOf(rows)（run-row 导出）——消费面与 runs$ 快照同源。
export interface RunBadgeProps {
  count: number;
}

export function RunBadge({ count }: RunBadgeProps) {
  if (count <= 0) return null; // 0→隐藏（A-1.1）
  return (
    <i
      data-task-center-badge
      aria-label={`${count} 个任务运行中`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent-tint)] px-1.5 font-mono text-xs not-italic leading-5 text-[var(--accent-hi)]"
    >
      {count}
    </i>
  );
}
