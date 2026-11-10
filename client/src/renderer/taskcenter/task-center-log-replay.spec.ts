// LogReplayService 套件（T6-11；TDD-C-10 §6.1g「重放一致性」＋§8② cron missed 提示行）。
//   g1) runs.list＋runs.get 装载 → records 逐字段一致（runs$ setRuns 后 snapshot 与持久态一致——
//       装配级断言）；
//   g2) restoreRunState → runStore 镜像重建=runs.get node_runs 终态投影（A-6.5 还原数据源；
//       真身 useRunStore.restoreRun 联动——C-03 §4 委托承接面）；每 flow 恰一次（最近 run）；
//   g3) cron missed：settings `cron.lastAliveAt`（ISO 8601——C-M1 §4③）＋flows 提取
//       trigger.cron → (lastAliveAt, now] 自算错过点（A-6.6 只提示不补跑）；首启无键不误报；
//   g4) replayLogs(flowId)：logs.list{flowId} 行序一致＋LogRecord→LogLine 映射（去 id、null→省缺）；
//   g5) nodeName：flows.get 只读快照按 flowId 缓存（每 flow 恰一取）＋实例名解析。
// cron-missed（renderer 自算——语义源=main MissedFireDetector 同口径）：窗口左开右闭、
// 五段式子集解析、DOM/DOW OR、非法表达式跳过、防呆上限截断。
import { describe, expect, it, vi } from 'vitest';
import type { FlowListItem, FlowDoc, LogRecord, NodeRunRecord, RunDetail, RunSummary } from '@constella/shared/ipc';
import { useRunStore, type NodeStatus } from '../run';
import { createLogReplayService, createReplayStorage, projectNodeRunStatuses, type ReplayStorage } from './log-replay-service';
import { computeMissedFires, parseCronExpr, MISSED_FIRE_CAP_PER_FLOW } from './cron-missed';
import { createRunsSource } from './runs-source';
import type { TaskRunRecord } from './run-row';

const T0 = 1_700_000_000_000;
const NOW = T0 + 65_000;

// ————————————————————————————————————————————
// fake storage（C-06 注入面——§6.1 「C-03/C-04/C-05/C-06 注入 fake」）
// ————————————————————————————————————————————

interface StorageFixture {
  runs: RunSummary[];
  details: Record<string, RunDetail>;
  logsByFlow: Record<string, LogRecord[]>;
  flows: Record<string, FlowDoc>;
  settings: Record<string, unknown>;
}

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return { id: 'r1', flowId: 'f4', name: '监控 UP 主', status: 'done', t0: T0, t1: T0 + 60_000, aborted: 0, failed: 0, total: 7, skips: [], createdAt: T0, ...over };
}

function nodeRun(over: Partial<NodeRunRecord> = {}): NodeRunRecord {
  return { id: 'nr1', runId: 'r1', laneId: 'main', nodeId: 'n1', status: 'done', startedAt: T0, endedAt: T0 + 1, output: null, error: null, ...over };
}

function flowDoc(flowId: string, name: string, nodes: Array<{ id: string; name: string; type?: string; params?: Record<string, unknown> }>): FlowDoc {
  return {
    id: flowId,
    name,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? 'custom.code', name: n.name, position: { x: 0, y: 0 }, params: n.params ?? {} })),
    edges: [],
  };
}

function fakeStorage(fx: StorageFixture): ReplayStorage & { flowsGetCount: () => number } {
  let flowsGetCount = 0;
  const storage: ReplayStorage & { flowsGetCount(): number } = {
    runsList: async () => fx.runs,
    runsGet: async (runId) => {
      const d = fx.details[runId];
      if (d === undefined) throw new Error(`runs.get 缺 runId=${runId}`);
      return d;
    },
    logsList: async (flowId) => fx.logsByFlow[flowId] ?? [],
    flowsList: async () =>
      Object.entries(fx.flows).map(([id, f]): FlowListItem => ({ id, name: f.name, orderIdx: 0, createdAt: T0, updatedAt: T0 })),
    flowsGet: async (flowId) => {
      flowsGetCount += 1;
      const f = fx.flows[flowId];
      if (f === undefined) throw new Error(`flows.get 缺 flowId=${flowId}`);
      return f;
    },
    settingsGetAll: async () => fx.settings as never,
    flowsGetCount: () => flowsGetCount,
  };
  return storage;
}

/** 真身 runStore 绑定（restoreMirror→useRunStore.restoreRun——C-03 §4 委托承接面） */
function realMirror(): (flowId: string, runId: string, statuses: Readonly<Record<string, NodeStatus>>) => void {
  useRunStore.getState().reset();
  return (flowId, runId, statuses) => useRunStore.getState().restoreRun(flowId, runId, statuses);
}

function baseFixture(): StorageFixture {
  return {
    runs: [
      summary({ id: 'r1', flowId: 'f4', name: '监控 UP 主', status: 'done', t1: T0 + 60_000, total: 7, createdAt: T0 }),
      summary({ id: 'r2', flowId: 'f4', name: '监控 UP 主', status: 'error', t1: T0 + 90_000, total: 7, createdAt: T0 + 100_000 }), // f4 最近 run=r2
      summary({ id: 'r3', flowId: 'f9', name: '人工确认', status: 'waiting', t1: null, total: 3, createdAt: T0 + 50_000 }),
    ],
    details: {
      r1: { ...summary({ id: 'r1' }), nodeRuns: [nodeRun({ nodeId: 'n1', status: 'done' }), nodeRun({ nodeId: 'n2', status: 'done' }), nodeRun({ nodeId: 'n3', status: 'skipped' })] },
      r2: { ...summary({ id: 'r2', status: 'error' }), nodeRuns: [nodeRun({ runId: 'r2', nodeId: 'n1', status: 'done' }), nodeRun({ runId: 'r2', nodeId: 'n2', status: 'done' }), nodeRun({ runId: 'r2', nodeId: 'n4', status: 'error' })] },
      r3: { ...summary({ id: 'r3', status: 'waiting' }), nodeRuns: [nodeRun({ runId: 'r3', nodeId: 'h1', status: 'done' }), nodeRun({ runId: 'r3', nodeId: 'h2', status: 'waiting' })] },
    },
    logsByFlow: {
      f4: [
        { id: 3, ts: '2026-11-11T03:00:02.000Z', level: 'err', msg: '第三行', flowId: 'f4', runId: 'r2', laneLabel: null },
        { id: 1, ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '第一行', flowId: 'f4', runId: null, laneLabel: 'main' },
        { id: 2, ts: '2026-11-11T03:00:01.000Z', level: 'ok', msg: '第二行', flowId: 'f4', runId: null, laneLabel: null },
      ],
    },
    flows: {
      f4: flowDoc('f4', '监控 UP 主', [
        { id: 'n1', name: '打开列表' },
        { id: 'n2', name: '抓取视频' },
      ]),
      f9: flowDoc('f9', '人工确认', [
        { id: 'h1', name: '提取名单' },
        { id: 'h2', name: '复核名单' },
      ]),
    },
    settings: {},
  };
}

describe('§6.1g 重放一致性（runs.list＋runs.get 装载→runs$ snapshot 逐字段一致）', () => {
  it('g1) restoreRunState → records 逐字段（含 node_runs 终态投影 statuses 附带）；setRuns 后 snapshot=持久态', async () => {
    const storage = fakeStorage(baseFixture());
    const svc = createLogReplayService({ storage, restoreMirror: realMirror(), now: () => NOW });
    const out = await svc.restoreRunState();

    expect(out.records).toEqual([
      { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'done', t0: T0, t1: T0 + 60_000, total: 7, statuses: { n1: 'done', n2: 'done', n3: 'skipped' } },
      { runId: 'r2', flowId: 'f4', flowName: '监控 UP 主', status: 'error', t0: T0, t1: T0 + 90_000, total: 7, statuses: { n1: 'done', n2: 'done', n4: 'error' } },
      { runId: 'r3', flowId: 'f9', flowName: '人工确认', status: 'waiting', t0: T0, t1: null, total: 3, statuses: { h1: 'done', h2: 'waiting' } },
    ]);

    // 装配级：records→createRunsSource.setRuns → snapshot 与持久态逐字段一致（§6.1g 前半句）
    const source = createRunsSource({
      listRuns: () => out.records,
      runStore: useRunStore,
      portsOf: () => [9221],
      nodeName: (f, id) => svc.nodeName(f, id),
      now: () => NOW,
    });
    expect(source.snapshot()).toEqual([
      { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'done', currentNodes: [], progress: { done: 2, total: 7 }, cdpPorts: [9221], elapsedMs: 60_000 },
      { runId: 'r2', flowId: 'f4', flowName: '监控 UP 主', status: 'error', currentNodes: [], progress: { done: 2, total: 7 }, cdpPorts: [9221], elapsedMs: 90_000 },
      { runId: 'r3', flowId: 'f9', flowName: '人工确认', status: 'waiting', currentNodes: ['复核名单'], progress: { done: 1, total: 3 }, cdpPorts: [9221], elapsedMs: NOW - T0 },
    ]);
    source.dispose();
  });

  it('g2) runStore 镜像重建=runs.get node_runs 终态（A-6.5 还原数据源）；每 flow 最近 run 恰一次', async () => {
    const mirror = vi.fn(realMirror());
    const svc = createLogReplayService({ storage: fakeStorage(baseFixture()), restoreMirror: mirror, now: () => NOW });
    await svc.restoreRunState();

    expect(mirror).toHaveBeenCalledTimes(2); // f4（最近=r2）＋f9（r3）
    expect(mirror).toHaveBeenNthCalledWith(1, 'f4', 'r2', { n1: 'done', n2: 'done', n4: 'error' });
    expect(mirror).toHaveBeenNthCalledWith(2, 'f9', 'r3', { h1: 'done', h2: 'waiting' });
    // 真身 runStore 终态：lastRunOfFlow=各 flow 最近 run 镜像（restoreRun 增补 action——C-03 §4 委托承接）
    expect(useRunStore.getState().lastRunOfFlow).toEqual({
      f4: { runId: 'r2', statuses: { n1: 'done', n2: 'done', n4: 'error' } },
      f9: { runId: 'r3', statuses: { h1: 'done', h2: 'waiting' } },
    });
    expect(useRunStore.getState().activeRunOfFlow).toEqual({}); // 还原不占用运行中位（重启后无活跃 run）
  });

  it('g1b) projectNodeRunStatuses：同节点多行（重试）取末行；行序折叠', () => {
    const statuses = projectNodeRunStatuses([
      nodeRun({ nodeId: 'a', status: 'error' }),
      nodeRun({ nodeId: 'a', status: 'done' }),
      nodeRun({ nodeId: 'b', status: 'skipped' }),
    ]);
    expect(statuses).toEqual({ a: 'done', b: 'skipped' });
  });
});

describe('§8② cron missed 提示行（settings 键中转＋renderer 启动自算——A-6.6 只提示不补跑）', () => {
  /** 昨日 19:00 存活 → 今日 21:00 启动；`0 20 * * *` → 今日 20:00 恰一点错过（main §6.3c 同例） */
  function cronFixture(lastAliveAt: string | undefined): StorageFixture {
    const fx = baseFixture();
    fx.flows['f4'] = flowDoc('f4', '监控 UP 主', [
      { id: 't1', name: '定时触发', type: 'trigger.cron', params: { cron: '0 20 * * *' } },
    ]);
    fx.flows['f9'] = flowDoc('f9', '人工确认', [{ id: 'h1', name: '提取名单' }]); // 无 cron：零贡献
    fx.settings = lastAliveAt === undefined ? {} : { 'cron.lastAliveAt': lastAliveAt };
    return fx;
  }

  it('g3) lastAliveAt＋trigger.cron → (lastAliveAt, now] 自算错过点＋提示文案（A-6.6 逐字模板）', async () => {
    // 分钟级表达式规避时区分支（20:00 墙钟例归 cron-missed 单元段）：`*/10` 每 10 分钟，
    // 窗口 (lastAlive, NOW] 内全部对齐点可精确推导（count=floor(now/10m)−floor(lastAlive/10m)）
    const lastAliveMs = NOW - 26 * 3600_000;
    const fx = cronFixture(new Date(lastAliveMs).toISOString());
    fx.flows['f4'] = flowDoc('f4', '监控 UP 主', [
      { id: 't1', name: '定时触发', type: 'trigger.cron', params: { cron: '*/10 * * * *' } },
    ]);
    const svc = createLogReplayService({ storage: fakeStorage(fx), restoreMirror: realMirror(), now: () => NOW });
    const out = await svc.restoreRunState();
    expect(out.missedFires.length).toBe(1);
    const m = out.missedFires[0]!;
    expect(m.flowId).toBe('f4');
    expect(m.flowName).toBe('监控 UP 主');
    expect(m.lastFireAt).toBe(Math.floor(NOW / 600_000) * 600_000); // 末点=≤NOW 最后一个 10 分钟对齐点
    expect(m.count).toBe(Math.floor(NOW / 600_000) - Math.floor(lastAliveMs / 600_000));
    expect(m.truncated).toBe(false);
  });

  it('g3b) 首启无键/坏表达式 → 不误报（A-6.6「首启无键→空窗口」同口径）', async () => {
    const noKey = createLogReplayService({ storage: fakeStorage(cronFixture(undefined)), restoreMirror: realMirror(), now: () => NOW });
    expect((await noKey.restoreRunState()).missedFires).toEqual([]);

    const bad = cronFixture('not-a-date');
    bad.flows['f4'] = flowDoc('f4', '监控 UP 主', [
      { id: 't1', name: '坏表达式', type: 'trigger.cron', params: { cron: '99 * * * *' } }, // 越界非法——跳过
    ]);
    const badSvc = createLogReplayService({ storage: fakeStorage(bad), restoreMirror: realMirror(), now: () => NOW });
    expect((await badSvc.restoreRunState()).missedFires).toEqual([]);
  });

  it('g3c) 多 trigger.cron 混布取首个非空（flowId 级单注册——main extractCronTriggers 同口径）', async () => {
    const fx = cronFixture(new Date(NOW - 3600_000).toISOString());
    fx.flows['f4'] = flowDoc('f4', '监控 UP 主', [
      { id: 't0', name: '空串忽略', type: 'trigger.cron', params: { cron: '' } },
      { id: 't1', name: '首个生效', type: 'trigger.cron', params: { cron: '*/10 * * * *' } },
      { id: 't2', name: '后续忽略', type: 'trigger.cron', params: { cron: '*/5 * * * *' } },
    ]);
    const svc = createLogReplayService({ storage: fakeStorage(fx), restoreMirror: realMirror(), now: () => NOW });
    const out = await svc.restoreRunState();
    expect(out.missedFires.length).toBe(1);
    const lastAliveMs = NOW - 3600_000;
    expect(out.missedFires[0]?.lastFireAt).toBe(Math.floor(NOW / 600_000) * 600_000); // 首个（*/10）生效
    expect(out.missedFires[0]?.count).toBe(Math.floor(NOW / 600_000) - Math.floor(lastAliveMs / 600_000));
  });
});

describe('replayLogs(flowId)＋nodeName（§3 LogReplayService 行）', () => {
  it('g4) 打开→重放 logs.list{flowId} 行序一致；LogRecord→LogLine 映射（去 id、null 列省缺）', async () => {
    const svc = createLogReplayService({ storage: fakeStorage(baseFixture()), restoreMirror: realMirror(), now: () => NOW });
    const lines = await svc.replayLogs('f4');
    expect(lines).toEqual([
      { ts: '2026-11-11T03:00:02.000Z', level: 'err', msg: '第三行', flowId: 'f4', runId: 'r2' },
      { ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '第一行', flowId: 'f4', laneLabel: 'main' },
      { ts: '2026-11-11T03:00:01.000Z', level: 'ok', msg: '第二行', flowId: 'f4' },
    ]);
    expect(await svc.replayLogs('f-none')).toEqual([]);
  });

  it('g5) nodeName：flows.get 只读快照按 flowId 缓存（restoreRunState 预热后同步读；每 flow 恰一取）', async () => {
    const storage = fakeStorage(baseFixture());
    const svc = createLogReplayService({ storage, restoreMirror: realMirror(), now: () => NOW });
    expect(svc.nodeName('f4', 'n1')).toBe(''); // 未预热回退空串（RunRowProjector 兜底「…」）
    await svc.restoreRunState(); // 预热（flows.list→逐 flow flows.get）
    expect(svc.nodeName('f4', 'n1')).toBe('打开列表');
    expect(svc.nodeName('f4', 'n2')).toBe('抓取视频');
    expect(svc.nodeName('f4', 'zz')).toBe(''); // 缺名回退
    expect(storage.flowsGetCount()).toBe(2); // f4/f9 各恰一取（后续 nodeName 命中缓存）
    expect(svc.nodeName('f4', 'n1')).toBe('打开列表');
    expect(storage.flowsGetCount()).toBe(2);
  });
});

describe('createReplayStorage（C-06 storageClient 适配——T6-17 装配面）', () => {
  it('op 映射：runs.list/runs.get/logs.list/flows.list/flows.get/settings.getAll 逐面转发', async () => {
    const calls: Array<{ op: string; args: unknown }> = [];
    const client = {
      invoke: async (op: string, args?: unknown): Promise<unknown> => {
        calls.push({ op, args });
        if (op === 'runs.list') return { items: [summary()] };
        if (op === 'runs.get') return { ...summary(), nodeRuns: [] };
        if (op === 'logs.list') return [];
        if (op === 'flows.list') return [];
        if (op === 'flows.get') return flowDoc('f4', 'n', []);
        return {};
      },
    } as unknown as import('../storage').StorageClient;
    const storage = createReplayStorage(client);
    await storage.runsList();
    await storage.runsGet('r1');
    await storage.logsList('f4');
    await storage.flowsList();
    await storage.flowsGet('f4');
    await storage.settingsGetAll();
    expect(calls.map((c) => c.op)).toEqual(['runs.list', 'runs.get', 'logs.list', 'flows.list', 'flows.get', 'settings.getAll']);
    expect(calls[1]?.args).toEqual({ runId: 'r1' });
    expect(calls[2]?.args).toEqual({ flowId: 'f4' });
    expect(calls[4]?.args).toEqual({ id: 'f4' });
    expect(calls[3]?.args).toBeUndefined(); // 无参 op={op} 形（storageClient 面同构）
  });
});

// ————————————————————————————————————————————
// cron-missed（renderer 自算单元——语义源=main MissedFireDetector/CronParser 同口径）
// ————————————————————————————————————————————

describe('cron-missed parseCronExpr（五段式子集——main CronParser 同口径）', () => {
  it('`*`/列表/区间/步进/周 7→0 归一', () => {
    expect(parseCronExpr('*/10 * * * *')?.minute.has(30)).toBe(true);
    expect(parseCronExpr('*/10 * * * *')?.minute.has(35)).toBe(false);
    expect(parseCronExpr('0 20 * * *')?.minute.has(0)).toBe(true);
    expect(parseCronExpr('0 20 * * *')?.hour.has(20)).toBe(true);
    expect(parseCronExpr('1,15 * * * *')?.minute.has(15)).toBe(true);
    expect(parseCronExpr('5-9 * * * *')?.minute.has(7)).toBe(true);
    expect(parseCronExpr('* * * * 7')?.dayOfWeek?.has(0)).toBe(true); // 7 归一周日
    expect(parseCronExpr('5/15 * * * *')?.minute.has(50)).toBe(true); // 单值基数=值..max（Vixie）
    expect(parseCronExpr('* * * * *')?.dayOfMonth).toBeNull(); // 字面 * 非受限
  });

  it('非法形 → null（跳过不中断——启动口径）', () => {
    expect(parseCronExpr('99 * * * *')).toBeNull(); // 越界
    expect(parseCronExpr('* * * *')).toBeNull(); // 段数≠5
    expect(parseCronExpr('a * * * *')).toBeNull(); // 非数字
    expect(parseCronExpr('9-5 * * * *')).toBeNull(); // 倒序区间
    expect(parseCronExpr('*/0 * * * *')).toBeNull(); // 步进 0
    expect(parseCronExpr('1,*,3 * * * *')).toBeNull(); // 列表元素不得为 *
  });
});

describe('cron-missed computeMissedFires（窗口=(lastAliveAt, now] 左开右闭）', () => {
  it('每 10 分钟表达式：窗口内全部对齐点＋末点；左开（存活边界分不误报）右闭（启动前一刻属错过）', () => {
    const base = Math.floor(1_700_000_000_000 / 600_000) * 600_000; // 对齐 10 分钟格（墙钟分钟=格点）
    const fires = computeMissedFires(base, [{ flowId: 'f4', cron: '*/10 * * * *' }], () => base + 35 * 60_000);
    expect(fires.map((f) => f.fireAt)).toEqual([base + 10 * 60_000, base + 20 * 60_000, base + 30 * 60_000]); // base 自身（左开）不入
    expect(fires.every((f) => !f.truncated)).toBe(true);
    expect(computeMissedFires(base, [{ flowId: 'f4', cron: '*/10 * * * *' }], () => base + 9 * 60_000)).toEqual([]); // 窗口内无点
  });

  it('非法表达式跳过；空窗口不误报；防呆上限截断（`* * * * *`）', () => {
    const base = 1_700_000_000_000;
    expect(computeMissedFires(base, [{ flowId: 'f4', cron: 'bad' }], () => base + 3600_000)).toEqual([]);
    const capped = computeMissedFires(base, [{ flowId: 'f4', cron: '* * * * *' }], () => base + (MISSED_FIRE_CAP_PER_FLOW + 5) * 60_000);
    expect(capped.length).toBe(MISSED_FIRE_CAP_PER_FLOW);
    expect(capped.at(-1)?.truncated).toBe(true); // 上限内末点携带截断标记
  });
});
