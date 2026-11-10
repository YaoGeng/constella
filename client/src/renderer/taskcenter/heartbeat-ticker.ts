// HeartbeatTicker —— 任务表用时列 1s 心跳（T6-10；TDD-C-10 §3 HeartbeatTicker 行；
// demo L3088-3098 行为源：单 interval 只刷未结束 run 的用时——t1 已置位行 continue、
// 无未结束 run 停表省电）。
//
// 接口=§3 逐字 start()/stop()/onTick(fn)；tick 载荷=当拍未结束 runId 列表（消费方只刷
// 这些行——RunTable 用时列/runs$ 快照重投影）。未结束集经构造注入的查询位每拍重估：
// 空集拍即自停（start 时已空则不起表）。
export interface HeartbeatTickerDeps {
  /** 未结束 run 查询位（每拍重估——t1 判据见 run-row.isRunUnfinished） */
  getUnfinishedRunIds(): readonly string[];
  /** 间隔（缺省 1000ms；测试可注入短间隔或 fake timers） */
  intervalMs?: number;
}

/** tick 监听器（载荷=当拍未结束 runId 列表） */
export type TickListener = (runIds: readonly string[]) => void;

export class HeartbeatTicker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<TickListener>();

  constructor(private readonly deps: HeartbeatTickerDeps) {}

  /** 起表（幂等；无未结束 run 不起——省电） */
  start(): void {
    if (this.timer !== null) return;
    if (this.deps.getUnfinishedRunIds().length === 0) return;
    this.timer = setInterval(() => this.beat(), this.deps.intervalMs ?? 1000);
  }

  /** 停表（幂等；生命周期收口/runs 全收尾时由装配方调用） */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** §3 onTick(fn)：订阅拍事件，返回退订 */
  onTick(fn: TickListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 表在跑否（测试/装配观测位） */
  get active(): boolean {
    return this.timer !== null;
  }

  private beat(): void {
    const ids = this.deps.getUnfinishedRunIds();
    if (ids.length === 0) {
      this.stop(); // 无未结束 run 即停（省电）
      return;
    }
    for (const fn of [...this.listeners]) fn(ids); // 仅未结束行派 tick（t1 行不刷）
  }
}
