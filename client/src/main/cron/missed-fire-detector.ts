// MissedFireDetector —— 启动时错过触发点计算（T4-19 / TDD-C-M1 §3 MissedFireDetector 组件行）。
//
// 语义冻结（§3 组件行＋A-6.6）：
//   - 窗口=(lastAliveAt, now]——左开（上次会话存活的分钟边界归上次会话）、右闭（启动前
//     最后一刻的触发点属错过）；
//   - **提示不补跑**（A-6.6）：本组件只计算错过点，无任何副作用；missed 提示=renderer 启动
//     自算〔C-10 §8②，读同一 settings 键＋flows 自算——语义源与本组件一致〕，本组件结果仅
//     main 侧日志留痕（CronScheduler.start 消费）；
//   - lastAliveAt=null（首启无键）→ 空窗口不误报全历史；
//   - 非法表达式跳过（启动不因单个坏流程中断——与 CronScheduler.start 同口径）；
//   - 防呆上限：单流程错过点超上限即截断（`* * * * *` 长期未运行时不至于无界展开），
//     上限内最后一点携带 truncated:true 供日志留痕（自拟冻结，MISSED_FIRE_CAP_PER_FLOW）。
//
// 组件接口（§3 组件行）：detect(schedules): MissedFire[]——lastAliveAt 依据=§4 settings 键
// `cron.lastAliveAt`（构造注入读得值；写入职责在 CronScheduler 不变）。
import { CronParser } from './cron-parser';

/** 错过触发点（右闭边界内的一个匹配分钟） */
export interface MissedFire {
  readonly flowId: string;
  /** 原表达式（renderer 自算对照/日志用） */
  readonly cron: string;
  /** 错过的计划触发时刻（epoch ms，分钟对齐） */
  readonly fireAt: number;
  /** 截断标记（其后还有被上限丢弃的点——仅日志留痕语义） */
  readonly truncated: boolean;
}

/** detect 入参形（flowId＋表达式；CronScheduler ScheduleTable 投影） */
export interface MissedFireSchedule {
  readonly flowId: string;
  readonly cron: string;
}

/** 单流程错过点防呆上限（自拟冻结——`* * * * *` 约七天量级） */
export const MISSED_FIRE_CAP_PER_FLOW = 10_000;

export interface MissedFireDetectorDeps {
  /** 上次存活时刻（epoch ms；settings 键 cron.lastAliveAt 读得值；null=首启无键） */
  readonly lastAliveAt: number | null;
  /** 当前时刻（缺省 Date.now） */
  readonly now?: () => number;
  /** 解析器（缺省共享实例——纯函数组件） */
  readonly parser?: CronParser;
}

export class MissedFireDetector {
  private readonly parser: CronParser;
  private readonly now: () => number;

  constructor(private readonly deps: MissedFireDetectorDeps) {
    this.parser = deps.parser ?? new CronParser();
    this.now = deps.now ?? Date.now;
  }

  /** 按 (lastAliveAt, now] 计算全部错过点（多流程并列；null 窗口/非法表达式→空贡献） */
  detect(schedules: ReadonlyArray<MissedFireSchedule>): MissedFire[] {
    const lastAliveAt = this.deps.lastAliveAt;
    if (lastAliveAt === null) return [];
    const now = this.now();
    const missed: MissedFire[] = [];
    for (const { flowId, cron } of schedules) {
      const parsed = this.parser.parse(cron);
      if (!parsed.ok) continue; // 坏表达式跳过（启动不中断——同 CronScheduler.start 口径）
      let t = this.parser.next(parsed.schedule, new Date(lastAliveAt));
      let count = 0;
      while (t !== null && t.getTime() <= now) {
        const truncated = count === MISSED_FIRE_CAP_PER_FLOW - 1; // 上限内末点携带标记
        missed.push({ flowId, cron, fireAt: t.getTime(), truncated });
        if (truncated) break; // 丢弃后续点（防呆上限——`* * * * *` 长期未运行不无界展开）
        count += 1;
        t = this.parser.next(parsed.schedule, t);
      }
    }
    return missed;
  }
}
