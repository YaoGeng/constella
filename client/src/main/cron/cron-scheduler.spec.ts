// CronScheduler 规格（T4-19 / TDD-C-M1 §6.3b/§6.3d——fake timers；§3 CronScheduler 组件行：
// 分钟粒度常驻 tick＋nextFire、upsert 同 flowId 覆盖、cancel 幂等、start(flows) 提取
// trigger.cron、stop 刷 lastAliveAt、到点恰推一次 onFired——不自行 startRun，闸在 renderer）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler, type CronSettingsKv } from './cron-scheduler';

/** 局部时间（五段式=本地墙钟） */
function at(y: number, m0: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m0, d, h, min, s);
}

/** 内存 settings KV（get/set 记录——lastAliveAt 三写点断言面） */
function makeKv(initial: Record<string, unknown> = {}): CronSettingsKv & { rows: Map<string, string> } {
  const rows = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)] as const),
  );
  return {
    rows,
    get(key: string): unknown {
      const raw = rows.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as unknown);
    },
    set(key: string, value: string | null): void {
      rows.set(key, JSON.stringify(value));
    },
  };
}

/** 最小 flow 注入形（CronFlowSource 字面子集） */
type SpecFlow = {
  id: string;
  nodes: ReadonlyArray<{ type: string; params: Record<string, unknown> }>;
};

const FLOW_WITH_CRON = (cron: string): SpecFlow[] => [
  {
    id: 'f1',
    nodes: [
      { type: 'trigger.manual', params: {} },
      { type: 'trigger.cron', params: { cron } },
    ],
  },
];

describe('CronScheduler start(flows)：注入读 flows/nodes 提取 trigger.cron', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('提取 trigger.cron 注册（trigger.manual/非触发节点不入表）；nextFire=当日 20:00', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.start(FLOW_WITH_CRON('0 20 * * *'));
    expect(scheduler.scheduledFlowIds).toEqual(['f1']);
    expect(scheduler.nextFire('f1')?.getTime()).toBe(at(2026, 10, 9, 20, 0, 0).getTime());
    scheduler.stop();
  });

  it('cron 参数缺失/非字符串的 trigger.cron 不入表；非法表达式跳过且留痕（不拦启动）', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const warn = vi.fn();
    const scheduler = new CronScheduler({ settings: kv, log: warn });
    scheduler.start([
      { id: 'f-missing', nodes: [{ type: 'trigger.cron', params: {} }] },
      { id: 'f-notstr', nodes: [{ type: 'trigger.cron', params: { cron: 123 } }] },
      { id: 'f-bad', nodes: [{ type: 'trigger.cron', params: { cron: '61 * * * *' } }] },
      { id: 'f-empty', nodes: [] },
    ]);
    expect(scheduler.scheduledFlowIds).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1); // 仅非法表达式一条留痕
    expect(String(warn.mock.calls[0]?.[0])).toContain('f-bad');
    scheduler.stop();
  });

  it('同流程多 trigger.cron：首个（nodes 序）入表——C-03 多触发混布口径待评审，flowId 级单注册', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.start([
      { id: 'f1', nodes: [
        { type: 'trigger.cron', params: { cron: '0 9 * * *' } },
        { type: 'trigger.cron', params: { cron: '0 20 * * *' } },
      ] },
    ]);
    expect(scheduler.scheduledFlowIds).toEqual(['f1']);
    expect(scheduler.nextFire('f1')?.getTime()).toBe(at(2026, 10, 10, 9, 0, 0).getTime());
    scheduler.stop();
  });
});

describe('CronScheduler lastAliveAt 三写点（settings 键 cron.lastAliveAt——missed 检测唯一依据）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('启动写 now；missed 检测读旧值留痕（提示不补跑——无 cron:fired 推送）', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    const kv = makeKv({ 'cron.lastAliveAt': at(2026, 10, 8, 19, 0, 0).toISOString() });
    const warn = vi.fn();
    const fired = vi.fn();
    const scheduler = new CronScheduler({ settings: kv, log: warn });
    scheduler.onFired(fired);
    scheduler.start(FLOW_WITH_CRON('0 20 * * *'));
    // 启动即写 now（ISO 字符串形）
    expect(kv.get('cron.lastAliveAt')).toBe(at(2026, 10, 9, 21, 0, 0).toISOString());
    // missed 留痕：含今日 20:00 点位（§6.3c 口径在 main 侧的日志呈现）
    const missedLine = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes('f1'));
    expect(missedLine).toBeDefined();
    expect(missedLine).toContain('未执行');
    expect(missedLine).toContain(at(2026, 10, 9, 20, 0, 0).toISOString()); // 今日 20:00（ISO 留痕）
    // 不补跑：错过点不产生任何 onFired
    expect(fired).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('首启无键 → 无 missed 留痕（不误报全历史）', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    const kv = makeKv();
    const warn = vi.fn();
    const scheduler = new CronScheduler({ settings: kv, log: warn });
    scheduler.start(FLOW_WITH_CRON('0 20 * * *'));
    expect(warn).not.toHaveBeenCalled();
    expect(kv.get('cron.lastAliveAt')).toBe(at(2026, 10, 9, 21, 0, 0).toISOString());
    scheduler.stop();
  });
});

describe('CronScheduler tick：分钟粒度到点恰推一次 cron:fired（§6.3b）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('0 20 * * *：19:59:30 起表 → 20:00 边界恰一次 onFired；跨日下一边界再推', () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 30));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((flowId) => fired.push(flowId));
    scheduler.upsert('f9', '0 20 * * *');
    scheduler.start([]);
    expect(scheduler.nextFire('f9')?.getTime()).toBe(at(2026, 10, 9, 20, 0, 0).getTime());

    vi.advanceTimersByTime(60_000); // 20:00:30 tick → due
    expect(fired).toEqual(['f9']);
    // fire 时刷新 lastAliveAt（tick 时刻）
    expect(kv.get('cron.lastAliveAt')).toBe(at(2026, 10, 9, 20, 0, 30).toISOString());

    vi.advanceTimersByTime(60_000); // 20:01:30 → 非边界，恰一次不再推
    expect(fired).toEqual(['f9']);
    vi.advanceTimersByTime(10 * 60_000); // 20:11:30 → 仍非边界
    expect(fired).toEqual(['f9']);

    // 推进至次日 20:00:30（23h49m）→ 第二次推送
    vi.advanceTimersByTime((23 * 60 + 49) * 60_000);
    expect(fired).toEqual(['f9', 'f9']);
    scheduler.stop();
  });

  it('*/5 步进：14:02:30 起表 → 14:05/14:10 各恰一次', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 2, 30));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((flowId) => fired.push(flowId));
    scheduler.upsert('f2', '*/5 * * * *');
    scheduler.start([]);
    vi.advanceTimersByTime(180_000); // 14:05:30（3 次 tick）
    expect(fired).toEqual(['f2']);
    vi.advanceTimersByTime(60_000); // 14:06:30 → 非边界
    expect(fired).toEqual(['f2']);
    vi.advanceTimersByTime(4 * 60_000); // 14:10:30
    expect(fired).toEqual(['f2', 'f2']);
    scheduler.stop();
  });

  it('多流程同刻并列：各恰一次、载荷仅 flowId（不自行 startRun——闸在 renderer）', () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 0));
    const kv = makeKv();
    const fired: Array<{ flowId: string }> = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((flowId) => fired.push({ flowId }));
    scheduler.upsert('f-a', '0 20 * * *');
    scheduler.upsert('f-b', '0 20 * * *');
    scheduler.start([]);
    vi.advanceTimersByTime(120_000); // 20:01:00
    expect(fired).toEqual([{ flowId: 'f-a' }, { flowId: 'f-b' }]);
    scheduler.stop();
  });

  it('同边界两流程仅一注册在表（见 upsert 覆盖组）——tick 期间 upsert 新表达式即时生效', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 2, 30));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((f) => fired.push(f));
    scheduler.upsert('f1', '0 20 * * *');
    scheduler.start([]);
    // 覆盖为 */5：14:05 即触发（若旧表达式仍在则 20:00 才触发）
    scheduler.upsert('f1', '*/5 * * * *');
    vi.advanceTimersByTime(180_000); // 14:05:30
    expect(fired).toEqual(['f1']);
    scheduler.stop();
  });
});

describe('CronScheduler upsert/cancel（§6.3d）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('upsert 同 flowId 覆盖：恰一注册、nextFire 随新表达式', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.upsert('f1', '0 20 * * *');
    scheduler.upsert('f1', '0 9 * * *');
    expect(scheduler.scheduledFlowIds).toEqual(['f1']); // 恰一注册
    expect(scheduler.nextFire('f1')?.getTime()).toBe(at(2026, 10, 10, 9, 0, 0).getTime());
    scheduler.stop();
  });

  it('upsert 非法表达式 → throw code=CRON-INVALID-EXPR（不注册）', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const scheduler = new CronScheduler({ settings: kv });
    expect(() => scheduler.upsert('f1', '61 * * * *')).toThrowError(
      expect.objectContaining({ code: 'CRON-INVALID-EXPR' }) as Error,
    );
    expect(scheduler.scheduledFlowIds).toEqual([]);
    scheduler.stop();
  });

  it('cancel：注销后 nextFire=null、tick 不再推；幂等（重复 cancel/未注册 cancel 均 no-op）', () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 0));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((f) => fired.push(f));
    scheduler.upsert('f9', '0 20 * * *');
    scheduler.cancel('f9');
    scheduler.cancel('f9'); // 幂等
    scheduler.cancel('never-registered'); // 未注册 cancel 亦 no-op
    scheduler.start([]);
    expect(scheduler.nextFire('f9')).toBeNull();
    vi.advanceTimersByTime(120_000); // 跨过 20:00 边界
    expect(fired).toEqual([]);
    scheduler.stop();
  });
});

describe('CronScheduler stop/生命周期', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stop：停 tick（不再推）＋退出前刷写 lastAliveAt=now；幂等', () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 30));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((f) => fired.push(f));
    scheduler.upsert('f9', '0 20 * * *');
    scheduler.start([]);
    scheduler.stop();
    scheduler.stop(); // 幂等
    vi.advanceTimersByTime(120_000); // 跨过 20:00 边界 → 已停
    expect(fired).toEqual([]);
    expect(kv.get('cron.lastAliveAt')).toBe(at(2026, 10, 9, 19, 59, 30).toISOString());
  });

  it('未 start 直接 stop no-op（不写键——未运行会话不收缩 missed 窗口）；重复 start 报错（单次语义）', () => {
    vi.setSystemTime(at(2026, 10, 9, 14, 0, 0));
    const kv = makeKv();
    const scheduler = new CronScheduler({ settings: kv });
    expect(() => scheduler.stop()).not.toThrow();
    expect(kv.get('cron.lastAliveAt')).toBeNull(); // 未运行不写存活基线
    scheduler.start([]);
    expect(() => scheduler.start([])).toThrowError(/单次/);
    scheduler.stop();
  });

  it('upsert 先于 start：入表待启（start 后起 tick 正常调度）', () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 30));
    const kv = makeKv();
    const fired: string[] = [];
    const scheduler = new CronScheduler({ settings: kv });
    scheduler.onFired((f) => fired.push(f));
    scheduler.upsert('f9', '0 20 * * *'); // start 前注册
    scheduler.start([]);
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual(['f9']);
    scheduler.stop();
  });
});
