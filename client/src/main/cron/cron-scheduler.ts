// CronScheduler —— 分钟粒度常驻调度（T4-19 / TDD-C-M1 §3 CronScheduler 组件行＋§4③）。
//
// 语义冻结（§3 组件行＋§4③＋D-5/A-6.6）：
//   - 应用运行期间生效（D-5 ⚠——退出即停，无系统级常驻）；
//   - 分钟粒度 tick：每 60s 巡表，nextAt≤now 的条目**恰推一次** onFired(flowId)（装配层接
//     IpcGateway.send cron:fired {flowId}——不自行 startRun，运行闸在 renderer RunGate，
//     A-6.1/A-6.6 共用闸）后跳到 next(now)——会话内跨边界（睡眠/挂起）不连发，仍恰一次；
//   - upsert(flowId,cron)：同 flowId 覆盖（内存 ScheduleTable 恰一注册）；非法表达式 throw
//     CronInvalidExprError（CRON-INVALID-EXPR）；cancel(flowId)：幂等（未注册 no-op）；
//   - start(flows)：注入读 flows/nodes 提取 trigger.cron（首个 cron 节点入表——flowId 级单
//     注册；⚠ C-03 多触发混布口径待评审，cron:fired 为 flowId 级不受影响）→ missed 检测
//     （读旧 lastAliveAt，MissedFireDetector 结果仅 main 日志留痕——A-6.6 提示不补跑，
//     renderer 启动自算归 C-10）→ **写 lastAliveAt=now** → 起 tick；
//   - stop()：停 tick＋退出前刷写 lastAliveAt=now；幂等；未 start 的 stop 不写键
//     （未运行会话不收缩 missed 窗口）；
//   - settings 键 `cron.lastAliveAt`（C-M1 §4③ 冻结——missed 检测唯一依据）：启动写 now、
//     每次 fire 更新、退出前刷写；值形=ISO 8601 字符串（自拟冻结——JSON 可读且 renderer
//     自算〔C-10〕Date.parse 直用）。settings 表运行时无键域白名单（T1-05 头注），本键不入
//     shared SettingsSchema——main 内直调注入同 main/vault/settings-kv.ts 先例（生产装配
//     经 createDaoSettingsKv 适配，T4-20 组装）。
//
// 组件接口（§3 组件行）：upsert/cancel/start(flows)/stop＋事件 onFired(flowId)＋nextFire。
import { CronParser, type CronSchedule } from './cron-parser';
import { MissedFireDetector } from './missed-fire-detector';

/** settings 键：上次存活时刻（C-M1 §4③——missed 检测唯一依据） */
export const CRON_LAST_ALIVE_AT_KEY = 'cron.lastAliveAt';

/** settings KV main 内直调面（main/vault/settings-kv.ts 先例——生产=createDaoSettingsKv 适配） */
export interface CronSettingsKv {
  /** 读原始 KV 值（JSON 反序列化后；缺键/损坏=null） */
  get(key: string): unknown;
  /** 写 KV（值=ISO 8601 字符串） */
  set(key: string, value: string | null): void;
}

/** start(flows) 注入形：FlowDoc 子集（id＋nodes 的 type/params——提取 trigger.cron 所需最小面） */
export interface CronFlowSource {
  readonly id: string;
  readonly nodes: ReadonlyArray<{
    readonly type: string;
    readonly params: Readonly<Record<string, unknown>>;
  }>;
}

/** tick 周期（分钟粒度——§3 组件行） */
export const CRON_TICK_MS = 60_000;

/** ScheduleTable 行（内存注册表——§4③；flowId 恰一行） */
interface ScheduleEntry {
  readonly cron: string;
  readonly schedule: CronSchedule;
  /** 下一次触发点（epoch ms；不可达=null——永不再推） */
  nextAt: number | null;
}

export interface CronSchedulerDeps {
  /** settings KV（lastAliveAt 三写点） */
  readonly settings: CronSettingsKv;
  /** 时钟（缺省 Date.now） */
  readonly now?: () => number;
  /** 解析器（缺省共享实例） */
  readonly parser?: CronParser;
  /** 日志面（缺省 console.warn——missed 留痕/坏表达式跳过登记走 warn） */
  readonly log?: (...args: unknown[]) => void;
  /** tick 周期（缺省 60_000——分钟粒度） */
  readonly tickMs?: number;
}

/** trigger.cron 节点 → (flowId, cron)：每流程取首个 cron 参数为非空 string 的 trigger.cron 节点 */
export function extractCronTriggers(
  flows: ReadonlyArray<CronFlowSource>,
): Array<{ flowId: string; cron: string }> {
  const out: Array<{ flowId: string; cron: string }> = [];
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.type !== 'trigger.cron') continue;
      const cron = node.params.cron;
      if (typeof cron === 'string' && cron !== '') {
        out.push({ flowId: flow.id, cron });
        break; // flowId 级单注册——首个入表（多 trigger.cron 混布口径=C-03 待评审）
      }
    }
  }
  return out;
}

export class CronScheduler {
  /** 内存 ScheduleTable（flowId → 条目；插入序稳定） */
  private readonly table = new Map<string, ScheduleEntry>();
  private readonly firedSubscribers = new Set<(flowId: string) => void>();
  private readonly parser: CronParser;
  private readonly now: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly tickMs: number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(private readonly deps: CronSchedulerDeps) {
    this.parser = deps.parser ?? new CronParser();
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.warn;
    this.tickMs = deps.tickMs ?? CRON_TICK_MS;
  }

  // ————————————————————————————————————————————
  // 事件（§3 组件行：onFired(flowId)——装配层订阅接 cron:fired 推送）
  // ————————————————————————————————————————————

  /** 订阅到点触发（返回退订函数） */
  onFired(fn: (flowId: string) => void): () => void {
    this.firedSubscribers.add(fn);
    return () => this.firedSubscribers.delete(fn);
  }

  // ————————————————————————————————————————————
  // 注册表面（cron:upsert/cron:cancel 通道消费——cron-channels.ts）
  // ————————————————————————————————————————————

  /** 注册/覆盖（同 flowId 恰一注册）；非法表达式 throw CronInvalidExprError（CRON-INVALID-EXPR） */
  upsert(flowId: string, cron: string): void {
    const parsed = this.parser.parse(cron);
    if (!parsed.ok) throw parsed.error;
    this.table.set(flowId, {
      cron,
      schedule: parsed.schedule,
      nextAt: this.computeNext(parsed.schedule),
    });
  }

  /** 注销（幂等——未注册 no-op） */
  cancel(flowId: string): void {
    this.table.delete(flowId);
  }

  /** 注册表投影（诊断/测试面：已注册 flowId 列表，插入序） */
  get scheduledFlowIds(): string[] {
    return [...this.table.keys()];
  }

  /** 下一次触发点（未注册/不可达 → null） */
  nextFire(flowId: string): Date | null {
    const nextAt = this.table.get(flowId)?.nextAt;
    return nextAt === undefined || nextAt === null ? null : new Date(nextAt);
  }

  // ————————————————————————————————————————————
  // 生命周期（AppRuntime 启动序步骤 8／退出序首步——service-slots CronSchedulerSlot）
  // ————————————————————————————————————————————

  /** 启动：提取 trigger.cron 注册 → missed 检测（旧值留痕）→ 写 lastAliveAt=now → 起 tick */
  start(flows: ReadonlyArray<CronFlowSource> = []): void {
    if (this.started) throw new Error('CronScheduler.start 已调用（单次语义）');
    this.started = true;

    // 1) 注入读 flows/nodes 提取 trigger.cron（坏表达式跳过＋留痕——不拦启动）
    for (const { flowId, cron } of extractCronTriggers(flows)) {
      const parsed = this.parser.parse(cron);
      if (!parsed.ok) {
        this.log(
          `[constella-main] cron 表达式非法，跳过注册: flowId=${flowId} cron=${JSON.stringify(cron)}（${parsed.error.message}）`,
        );
        continue;
      }
      this.table.set(flowId, {
        cron,
        schedule: parsed.schedule,
        nextAt: this.computeNext(parsed.schedule),
      });
    }

    // 2) missed 检测：窗口=(旧 lastAliveAt, now]——结果仅 main 日志留痕（A-6.6 提示不补跑）
    const prevAliveAt = this.readLastAliveAt();
    if (prevAliveAt !== null) {
      const schedules = [...this.table.entries()].map(([flowId, e]) => ({ flowId, cron: e.cron }));
      const missed = new MissedFireDetector({
        lastAliveAt: prevAliveAt,
        now: this.now,
        parser: this.parser,
      }).detect(schedules);
      this.logMissed(missed);
    }

    // 3) 启动写 now（§4③ 三写点之一）
    this.writeLastAliveAt(this.now());

    // 4) 分钟粒度常驻 tick
    this.interval = setInterval(() => this.tick(), this.tickMs);
  }

  /** 退出：停 tick＋退出前刷写 lastAliveAt=now（§4③ 三写点之二）；幂等；未 start 不写键 */
  stop(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (!this.started) return;
    this.started = false;
    this.writeLastAliveAt(this.now()); // 退出前刷写（三写点之三）
  }

  // ————————————————————————————————————————————
  // 内部

  /** 巡表：nextAt≤now 恰推一次 → 跳 next(now)（会话内跨边界不连发）；有 fire 即刷新 lastAliveAt */
  private tick(): void {
    const now = this.now();
    let firedAny = false;
    for (const [flowId, entry] of this.table) {
      if (entry.nextAt === null || entry.nextAt > now) continue;
      for (const fn of this.firedSubscribers) fn(flowId);
      entry.nextAt = this.computeNext(entry.schedule, now);
      firedAny = true;
    }
    if (firedAny) this.writeLastAliveAt(now); // 每次 fire 更新（三写点之二）
  }

  private computeNext(schedule: CronSchedule, fromMs?: number): number | null {
    const next = this.parser.next(schedule, new Date(fromMs ?? this.now()));
    return next === null ? null : next.getTime();
  }

  private readLastAliveAt(): number | null {
    const raw = this.deps.settings.get(CRON_LAST_ALIVE_AT_KEY);
    if (typeof raw !== 'string' || raw === '') return null;
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms; // 损坏值按首启处理（不拦启动）
  }

  private writeLastAliveAt(ms: number): void {
    this.deps.settings.set(CRON_LAST_ALIVE_AT_KEY, new Date(ms).toISOString());
  }

  /** missed 留痕（每流程一行汇总——A-6.6 文案「上次计划触发 <时间> 未执行，可手动运行」） */
  private logMissed(missed: ReadonlyArray<{ flowId: string; fireAt: number; truncated: boolean }>): void {
    if (missed.length === 0) return;
    const byFlow = new Map<string, { count: number; firstAt: number; lastAt: number; truncated: boolean }>();
    for (const m of missed) {
      const agg = byFlow.get(m.flowId);
      if (agg === undefined) {
        byFlow.set(m.flowId, { count: 1, firstAt: m.fireAt, lastAt: m.fireAt, truncated: m.truncated });
      } else {
        agg.count += 1;
        agg.lastAt = m.fireAt;
        agg.truncated = agg.truncated || m.truncated;
      }
    }
    for (const [flowId, a] of byFlow) {
      this.log(
        `[constella-main] cron missed: flowId=${flowId} 上次计划触发 ${new Date(a.lastAt).toISOString()} 未执行，可手动运行` +
          `（错过 ${a.count} 点：${new Date(a.firstAt).toISOString()} … ${new Date(a.lastAt).toISOString()}` +
          `${a.truncated ? '；超上限截断' : ''}；A-6.6 不补跑）`,
      );
    }
  }
}
