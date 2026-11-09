// RunLedger —— run 台账＋心跳（TDD-C-03 §1 十条 #1 流程间并行/同流程最多 1 run；T4-01）。
// active（running/waiting）按 flowId 唯一——RunGate 同流程闸的数据源；心跳=单 interval 为全部
// active run 计 beat（任务表 1s 用时刷新的数据源形态，无 active 时停 timer 省电）；close 后
// entry 留账（历史查询）、停跳。执行循环体（lane/汇合/收敛）随 T4-02/T4-03 接入后 status
// 由各组件推进。
export type LedgerStatus = 'running' | 'waiting' | 'done' | 'error' | 'aborted';

export interface LedgerEntry {
  runId: string;
  flowId: string;
  name: string;
  status: LedgerStatus;
  t0: number;
  /** 心跳计数（每拍 +1）——双流程并行时各 entry 独立推进 */
  beat: number;
  lastBeatAt: number;
}

export interface OpenLedgerInput {
  runId: string;
  flowId: string;
  name: string;
  t0: number;
}

export class RunLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** @param heartbeatMs 心跳间隔（缺省 1000ms；测试可注入更短间隔或用 fake timers） */
  constructor(private readonly heartbeatMs = 1000) {}

  /** 记账（run 创建后）＋确保心跳 timer 运转 */
  open(input: OpenLedgerInput): LedgerEntry {
    const entry: LedgerEntry = { ...input, status: 'running', beat: 0, lastBeatAt: input.t0 };
    this.entries.set(input.runId, entry);
    this.ensureTimer();
    return entry;
  }

  /** 收尾（幂等：未记账/已收尾 → undefined 不重复停跳） */
  close(runId: string, status: 'done' | 'error' | 'aborted'): LedgerEntry | undefined {
    const entry = this.entries.get(runId);
    if (entry === undefined || !this.isActive(entry)) return undefined;
    entry.status = status;
    if (this.activeEntries().length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return entry;
  }

  /**
   * 收尾后清理 entry（T4-03 收敛接线，移交项 #7——长生命周期不泄漏）：历史查询走 DB
   * （runs.get＋logs.list 重放归任务中心消费），内存台账只承载 active 心跳。active run 防御性不清。
   */
  forget(runId: string): void {
    const entry = this.entries.get(runId);
    if (entry !== undefined && this.isActive(entry)) return;
    this.entries.delete(runId);
  }

  /** 同流程 active run（RunGate 重复闸查询位）；无 → undefined */
  activeOf(flowId: string): LedgerEntry | undefined {
    return this.activeEntries().find((e) => e.flowId === flowId);
  }

  get(runId: string): LedgerEntry | undefined {
    return this.entries.get(runId);
  }

  /** 心跳计数（未记账 → -1） */
  beatOf(runId: string): number {
    return this.entries.get(runId)?.beat ?? -1;
  }

  /** 停跳清账（生命周期收口——RunEngine.dispose 内部构造时连带调用） */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private isActive(e: LedgerEntry): boolean {
    return e.status === 'running' || e.status === 'waiting';
  }

  private activeEntries(): LedgerEntry[] {
    return [...this.entries.values()].filter((e) => this.isActive(e));
  }

  private ensureTimer(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        const now = Date.now();
        for (const e of this.activeEntries()) {
          e.beat += 1;
          e.lastBeatAt = now;
        }
      }, this.heartbeatMs);
    }
  }
}
