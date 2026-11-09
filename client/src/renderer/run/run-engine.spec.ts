// RunEngine 骨架套件（T4-01 验收；TDD-C-03 §6.1a/b/c；02 §10 #1/#2/#9）。
// 断言面：
//   a) 三闸违例（脏/同流程重复/缺触发）三例各自拒绝＋toast＋err 日志＋不产生 run，
//      附加拦截（broken 定义/noScript 强节点）同样拒绝（02 §12.4 拦截点表 RunGate 行）；
//   b) 孤立节点启动即 ⊘（statuses 预标＋skipped 事件）、total=可达数、skips 入启动日志；
//      TopoPlanner 组件级 BFS 可达序（多触发混布=全部触发节点入队——05 区头 b 项默认口径）；
//   c) 双流程并行心跳独立（RunLedger 各 run 独立 beat）、abort 后停跳、他流程不受扰，
//      同流程重复拒绝、终止收尾 runs.finish(aborted)＋warn 日志；
//   cron:fired 复查三闸后 startRun（闸违例时 fire 不产生 run）。
// IPC 零 Electron 依赖：storage 经注入 mock bridge（storage-client 消费面）、cron 经注入 Transport。
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FlowDoc, FlowEdge, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createStorageClient, type StorageBridge } from '../storage';
import { RunGate } from './run-gate';
import { RunLedger } from './run-ledger';
import { TopoPlanner } from './topo-planner';
import { createRunEngine } from './run-engine';
import type { RunRegistryLike, RunTransport } from './types';

// ————————————————————————————————————————————
// fixture
// ———————————————————————————————————————————

function def(type: string, ins: string[], kind: 'builtin' | 'custom' = 'builtin', over: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type,
    kind,
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins, outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: kind === 'custom' ? { lang: 'ts', file: `scripts/${type}.ts`, entry: 'run' } : null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...over,
  };
}

/** 注册表注入面：内置 5 类 + broken.y / custom.x（P1 波 registry-core 同语义的最小结构面）；extra=用例自定义定义 */
function fakeRegistry(broken: readonly string[] = [], extra: readonly NodeDefinition[] = []): RunRegistryLike {
  const defs = [
    def('trigger.manual', []),
    def('trigger.cron', []),
    def('data.transform', ['in']),
    def('delay', ['in']),
    def('cdp.open', ['in']),
    def('human.review', ['in']),
    def('custom.x', ['in'], 'custom'),
    def('broken.y', ['in']),
    ...extra,
  ];
  return {
    get: (type) => defs.find((d) => d.type === type),
    isBroken: (type) => broken.includes(type),
  };
}

function node(id: string, type: string, over: Partial<FlowNode> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params: {}, ...over };
}

function edge(from: string, to: string, port = 'out'): FlowEdge {
  return { id: `${from}(${port})--${to}`, from: [from, port], to: [to, 'in'] };
}

/** t1→a→b 主干＋可选附加节点/边 */
function flowDoc(id: string, nodes: FlowNode[], edges: FlowEdge[]): FlowDoc {
  return { id, name: `流程${id}`, nodes, edges };
}

const MAIN_CHAIN: FlowDoc = flowDoc(
  'f1',
  [node('t1', 'trigger.manual'), node('a', 'data.transform'), node('b', 'delay', { params: { ms: 60 } })],
  [edge('t1', 'a'), edge('a', 'b')],
);

/** mock storage（参照 renderer.storage.spec.ts mockBridge 形态——真实 createStorageClient 组装） */
function makeStorage() {
  const calls: StorageInvokeReq[] = [];
  const handlers = new Map<string, (req: StorageInvokeReq) => unknown>();
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      const h = handlers.get(req.op);
      if (h === undefined) throw new Error(`mock bridge 未注册 op：${req.op}`);
      return h(req);
    },
  };
  return { calls, on: (op: string, h: (req: StorageInvokeReq) => unknown) => handlers.set(op, h), client: createStorageClient(bridge) };
}

/** 可编程环境：storage（flows/runs/logs 域）＋注入面收集 */
function makeEnv(
  docMap: Record<string, FlowDoc>,
  over: { broken?: readonly string[]; guardDirty?: (flowId: string) => boolean; transport?: RunTransport; defs?: readonly NodeDefinition[] } = {},
) {
  const { calls, on, client } = makeStorage();
  let runSeq = 0;
  on('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  on('runs.create', () => ({ id: `r${++runSeq}` }));
  on('runs.finish', () => undefined);
  on('runs.nodeRunStart', () => undefined);
  on('runs.nodeRunFinish', () => undefined);
  on('logs.append', () => undefined);

  const toasts: { level: string; msg: string }[] = [];
  const ledger = new RunLedger(1000);
  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(over.broken ?? [], over.defs ?? []),
    guardDirty: over.guardDirty ?? (() => false),
    notify: (level, msg) => toasts.push({ level, msg }),
    ledger,
    ...(over.transport ? { transport: over.transport } : {}),
  });
  return { calls, engine, ledger, toasts };
}

/** fake Transport：手动收集/触发 cron:fired 订阅（T4-02 起 RunTransport 扩脚本/会话通道——cron 用例仅消费 cron 面，其余打桩拒绝） */
function fakeTransport() {
  const subs: ((e: { flowId: string }) => void)[] = [];
  const transport: RunTransport = {
    onCronFired: (fn) => (subs.push(fn), () => {}),
    spawnScript: async () => {
      throw new Error('fakeTransport（cron 用例）未实现 spawnScript');
    },
    onScriptEvent: () => () => undefined,
    cdpCreateSession: async () => {
      throw new Error('fakeTransport（cron 用例）未实现 cdpCreateSession');
    },
    cdpNavigate: async () => {
      throw new Error('fakeTransport（cron 用例）未实现 cdpNavigate');
    },
  };
  return { transport, fire: (flowId: string) => subs.forEach((fn) => fn({ flowId })) };
}

const logCalls = (calls: StorageInvokeReq[]) => calls.filter((c) => c.op === 'logs.append');
const createCalls = (calls: StorageInvokeReq[]) => calls.filter((c) => c.op === 'runs.create');

/** 刷 microtask 队列（cron fire → startRun 链无 timer 参与） */
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

// ————————————————————————————————————————————
// §6.1a 三闸违例＋附加拦截（02 §10 #9）
// ————————————————————————————————————————————

describe('RunGate/RunEngine §6.1a 三闸违例', () => {
  it('脏：拒绝＋toast＋err 日志，不产生 run', async () => {
    const env = makeEnv({ f1: MAIN_CHAIN }, { guardDirty: () => true });
    const handle = await env.engine.startRun('f1');
    expect(handle).toBeNull();
    expect(env.toasts).toEqual([{ level: 'err', msg: '有未保存改动 — 先保存再运行' }]);
    const logs = logCalls(env.calls).map((c) => (c as { args: { msg: string; level: string } }).args);
    expect(logs).toContainEqual(expect.objectContaining({ level: 'err', msg: '运行失败：有未保存改动 — 先保存再运行' }));
    expect(createCalls(env.calls)).toHaveLength(0);
  });

  it('同流程重复：f1 运行中再跑 f1 → 拒绝，不产生第二个 run', async () => {
    const env = makeEnv({ f1: MAIN_CHAIN });
    const first = await env.engine.startRun('f1');
    expect(first).not.toBeNull();
    const second = await env.engine.startRun('f1');
    expect(second).toBeNull();
    expect(env.toasts).toEqual([{ level: 'err', msg: '该流程已有任务在运行' }]);
    const dupLog = logCalls(env.calls)
      .map((c) => (c as { args: { msg: string; level: string } }).args)
      .find((a) => a.msg.includes('已有任务在运行'));
    expect(dupLog).toMatchObject({ level: 'err', msg: '运行失败：该流程已有任务在运行' });
    expect(createCalls(env.calls)).toHaveLength(1);
  });

  it('缺触发节点：全入边节点流程 → 拒绝＋err 日志（toast 文案=demo L1796/01 A-6.1）', async () => {
    const noTrigger = flowDoc('f2', [node('a', 'data.transform'), node('b', 'delay')], [edge('a', 'b')]);
    const env = makeEnv({ f2: noTrigger });
    const handle = await env.engine.startRun('f2');
    expect(handle).toBeNull();
    expect(env.toasts).toEqual([{ level: 'err', msg: '流程缺少触发节点（手动/定时）' }]);
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'err', msg: '运行失败：流程缺少触发节点（手动/定时）' } });
    expect(createCalls(env.calls)).toHaveLength(0);
  });

  it('broken 定义拦截：含校验未通过定义的流程 → 拒绝不产生 run', async () => {
    const doc = flowDoc('f3', [node('t1', 'trigger.manual'), node('a', 'broken.y')], [edge('t1', 'a')]);
    const env = makeEnv({ f3: doc }, { broken: ['broken.y'] });
    const handle = await env.engine.startRun('f3');
    expect(handle).toBeNull();
    expect(env.toasts[0]?.msg).toContain('broken.y');
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'err' } });
    expect(createCalls(env.calls)).toHaveLength(0);
  });

  it('noScript 拦截：custom 强节点缺脚本资产 → 拒绝不产生 run（02 §12.4）', async () => {
    const doc = flowDoc('f4', [node('t1', 'trigger.manual'), node('a', 'custom.x', { noScript: true })], [edge('t1', 'a')]);
    const env = makeEnv({ f4: doc });
    const handle = await env.engine.startRun('f4');
    expect(handle).toBeNull();
    expect(env.toasts[0]?.msg).toContain('缺少脚本');
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'err' } });
    expect(createCalls(env.calls)).toHaveLength(0);
  });
});

// ————————————————————————————————————————————
// §6.1b BFS 可达序＋不可达预标 ⊘（02 §10 #2）
// ————————————————————————————————————————————

describe('TopoPlanner §6.1b 触发器 BFS 可达序', () => {
  it('扇出图：order=触发器 BFS 序、skips=不可达、total=可达数', () => {
    const planner = new TopoPlanner(fakeRegistry());
    const doc = flowDoc('f1', [node('t1', 'trigger.manual'), node('a', 'data.transform'), node('b1', 'delay'), node('b2', 'delay'), node('c', 'data.transform'), node('lonely', 'delay')], [edge('t1', 'a'), edge('a', 'b1'), edge('a', 'b2'), edge('b1', 'c')]);
    const plan = planner.plan(doc);
    expect(plan.order).toEqual(['t1', 'a', 'b1', 'b2', 'c']);
    expect(plan.skips).toEqual(['lonely']);
    expect(plan.total).toBe(5);
  });

  it('多触发节点混布=全部触发节点入队（cron 口径默认）', () => {
    const planner = new TopoPlanner(fakeRegistry());
    const doc = flowDoc('f1', [node('t1', 'trigger.manual'), node('t2', 'trigger.cron'), node('a', 'data.transform'), node('b', 'delay'), node('x', 'delay')], [edge('t1', 'a'), edge('t2', 'b')]);
    const plan = planner.plan(doc);
    expect(plan.order.slice(0, 2)).toEqual(['t1', 't2']);
    expect(plan.order).toEqual(['t1', 't2', 'a', 'b']);
    expect(plan.skips).toEqual(['x']);
  });

  it('无孤立节点：skips 空、total=全部节点', () => {
    const planner = new TopoPlanner(fakeRegistry());
    const plan = planner.plan(MAIN_CHAIN);
    expect(plan.order).toEqual(['t1', 'a', 'b']);
    expect(plan.skips).toEqual([]);
    expect(plan.total).toBe(3);
  });
});

describe('RunEngine §6.1b 孤立节点启动即 ⊘', () => {
  it('启动后 statuses 预标 skipped＋事件＋启动日志含 skips 计数', async () => {
    const doc = flowDoc('f1', [node('t1', 'trigger.manual'), node('a', 'data.transform'), node('lonely', 'delay')], [edge('t1', 'a')]);
    const env = makeEnv({ f1: doc });
    const events: { runId: string; nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ runId: e.runId, nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    expect(handle).not.toBeNull();
    await env.engine.whenSettled(handle!.runId); // T4-02 起执行循环在跑——收敛后再断全量
    expect(handle?.statuses).toMatchObject({ lonely: 'skipped', t1: 'done', a: 'done' });
    expect(events[0]).toEqual({ runId: 'r1', nodeId: 'lonely', status: 'skipped' }); // 预标 ⊘ 先于任何执行事件
    const startLog = logCalls(env.calls).map((c) => (c as { args: { msg: string; level: string } }).args).find((a) => a.msg.includes('启动'));
    expect(startLog).toMatchObject({ level: 'info', msg: '▶ 任务「流程f1」启动 — 2 个节点入队，1 个未连接节点跳过' });
  });

  it('无孤立节点：启动日志不含跳过段；onRunLog 同点派发日志行', async () => {
    const env = makeEnv({ f1: MAIN_CHAIN });
    const lines: { level: string; msg: string }[] = [];
    env.engine.onRunLog((l) => lines.push({ level: l.level, msg: l.msg }));
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toEqual({ t1: 'done', a: 'done', b: 'done' });
    const startLine = lines.find((l) => l.msg.includes('启动'));
    expect(startLine).toMatchObject({ level: 'info', msg: '▶ 任务「流程f1」启动 — 3 个节点入队' });
    expect(startLine?.msg).not.toContain('跳过');
    expect(lines.some((l) => l.msg.includes('执行 trigger.manual'))).toBe(true); // 执行循环日志同管线派发
  });
});

// ————————————————————————————————————————————
// §6.1c 流程间并行/同流程互斥＋RunLedger 心跳（02 §10 #1）
// ————————————————————————————————————————————

describe('RunEngine/RunLedger §6.1c 双流程并行心跳独立', () => {
  it('两流程并行：runId 各异、心跳独立推进；abort 一方不影响另一方', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ f1: MAIN_CHAIN, f4: flowDoc('f4', [node('t1', 'trigger.manual'), node('a', 'delay')], [edge('t1', 'a')]) });
    const h1 = await env.engine.startRun('f1');
    const h4 = await env.engine.startRun('f4');
    expect(h1?.runId).toBe('r1');
    expect(h4?.runId).toBe('r2');
    expect(env.ledger.activeOf('f1')?.runId).toBe('r1');
    expect(env.ledger.activeOf('f4')?.runId).toBe('r2');

    await vi.advanceTimersByTimeAsync(3000);
    expect(env.ledger.beatOf('r1')).toBe(3);
    expect(env.ledger.beatOf('r2')).toBe(3);

    env.engine.abortRun('r1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(env.ledger.beatOf('r1')).toBe(3); // 已收尾：停跳
    expect(env.ledger.beatOf('r2')).toBe(5); // 另一流程心跳不受扰
    expect(env.ledger.activeOf('f1')).toBeUndefined();
    expect(env.ledger.activeOf('f4')?.runId).toBe('r2');
  });

  it('abortRun 收尾：runs.finish(status=aborted, skips, total)＋warn 日志；之后同流程可再跑', async () => {
    vi.useFakeTimers();
    const doc = flowDoc('f1', [node('t1', 'trigger.manual'), node('a', 'data.transform'), node('lonely', 'delay')], [edge('t1', 'a')]);
    const env = makeEnv({ f1: doc });
    const h = await env.engine.startRun('f1');
    env.engine.abortRun(h!.runId);
    await vi.advanceTimersByTimeAsync(0);
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ runId: 'r1', status: 'aborted', total: 2, skips: ['lonely'] });
    const abortLog = logCalls(env.calls)
      .map((c) => (c as { args: { msg: string; level: string } }).args)
      .find((a) => a.msg.includes('任务已终止'));
    expect(abortLog).toMatchObject({ level: 'warn' });

    const again = await env.engine.startRun('f1'); // 终止后同流程闸放开
    expect(again?.runId).toBe('r2');
  });

  it('同流程重复拒绝不影响既有 run：f4 仍 active 心跳推进', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ f1: MAIN_CHAIN, f4: MAIN_CHAIN });
    await env.engine.startRun('f1');
    const dup = await env.engine.startRun('f1');
    expect(dup).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(env.ledger.activeOf('f1')?.beat).toBe(2); // 原 run 心跳照常
  });

  it('abortRun 边界：未知 runId / 已收尾 run → no-op 不抛不重复 finish', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ f1: MAIN_CHAIN });
    expect(() => env.engine.abortRun('rx')).not.toThrow();
    const h = await env.engine.startRun('f1');
    env.engine.abortRun(h!.runId);
    env.engine.abortRun(h!.runId);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.calls.filter((c) => c.op === 'runs.finish')).toHaveLength(1);
  });
});

describe('RunLedger 组件级', () => {
  it('心跳启停：open 启跳、全 close 后无遗留 timer', async () => {
    vi.useFakeTimers();
    const ledger = new RunLedger(1000);
    ledger.open({ runId: 'r1', flowId: 'f1', name: '一', t0: 0 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(ledger.beatOf('r1')).toBe(2);
    ledger.close('r1', 'done');
    expect(vi.getTimerCount()).toBe(0); // 无 active → interval 停（省电形态）
    expect(ledger.get('r1')?.status).toBe('done');
  });
});

// ————————————————————————————————————————————
// cron:fired 复查三闸后 startRun（01 A-6.6）
// ————————————————————————————————————————————

describe('RunEngine cron:fired 接线', () => {
  it('fire 经注入 Transport → 复查三闸 → startRun 产生 run', async () => {
    const { transport, fire } = fakeTransport();
    const env = makeEnv({ f1: MAIN_CHAIN }, { transport });
    fire('f1');
    await flushMicrotasks();
    expect(createCalls(env.calls)).toHaveLength(1);
  });

  it('fire 时脏 → 闸拒绝不产生 run＋err 日志（复查共用三闸）', async () => {
    const { transport, fire } = fakeTransport();
    const env = makeEnv({ f1: MAIN_CHAIN }, { transport, guardDirty: () => true });
    fire('f1');
    await flushMicrotasks();
    expect(createCalls(env.calls)).toHaveLength(0);
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'err', msg: expect.stringContaining('未保存') } });
  });
});

// ————————————————————————————————————————————
// 执行循环集成（T4-02：§6.1d/e＋§6.3；lane/扇出/汇合/交付路由/ExecDispatcher）
// ————————————————————————————————————————————

/** fake 执行面传输（engine 级）：脚本行为按 nodeId 编程＋cdp 会话/导航记录 */
function makeExecTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: { nodeRunId: string; input: unknown; laneKey?: string }[] = [];
  const sessions: { runId: string; laneKey: string; label: string; startUrl: string }[] = [];
  const navigations: { runId: string; laneKey: string; url: string }[] = [];
  const behaviors = new Map<string, (push: (frame: unknown) => void, done: () => void, req: { input: unknown }) => void>();
  let portSeq = 9220;
  const push = (nodeRunId: string, frame: unknown): void => {
    const chunk = `${JSON.stringify(frame)}\n`;
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'stdout', chunk });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      const rec = { nodeRunId: req.nodeRunId, input: req.input, laneKey: req.laneKey };
      spawns.push(rec);
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const behavior = behaviors.get(nodeId);
      if (behavior) behavior((frame) => push(req.nodeRunId, frame), () => exit0(req.nodeRunId), rec);
      return { ok: true, pid: 1 };
    },
    cdpCreateSession: async (req) => {
      sessions.push({ runId: req.runId, laneKey: req.laneKey, label: req.label, startUrl: req.startUrl });
      return { port: ++portSeq, partition: `persist:f1·${req.laneKey}` };
    },
    cdpNavigate: async (req) => {
      navigations.push({ runId: req.runId, laneKey: req.laneKey, url: req.url });
      return { ok: true };
    },
  };
  const exit0 = (nodeRunId: string): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'exit', code: 0, ms: 5 });
  };
  /** 行为驱动：spawn 时回放帧＋尾随 exit 0（engine 用例不需要中途暂停） */
  const script = (nodeId: string, frames: unknown[]): void => {
    behaviors.set(nodeId, (pushFrame, done) => {
      for (const f of frames) pushFrame(f);
      done();
    });
  };
  return { transport, spawns, sessions, navigations, exit0, script };
}

describe('RunEngine §6.1d 扇出/lane（02 §10 #3/#4）', () => {
  it('2 出边扇出两下游均调度＋每支新 lane 标签=支首节点名＋createSession 每 lane 恰一次', async () => {
    const fx = makeExecTransport();
    const doc = flowDoc(
      'f4',
      [
        node('t1', 'trigger.manual'),
        node('a', 'data.transform'),
        node('b1', 'cdp.open', { name: '北京人社局', params: { url: 'https://bj.example.com' } }),
        node('b2', 'cdp.open', { name: '上海人社局', params: { url: 'https://sh.example.com' } }),
      ],
      [edge('t1', 'a'), edge('a', 'b1'), edge('a', 'b2')],
    );
    const env = makeEnv({ f4: doc }, { transport: fx.transport });
    const events: { nodeId: string; status: string; laneLabel?: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status, ...(e.laneLabel ? { laneLabel: e.laneLabel } : {}) }));
    const handle = await env.engine.startRun('f4');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toEqual({ t1: 'done', a: 'done', b1: 'done', b2: 'done' }); // 两下游均被调度
    expect(fx.sessions).toEqual([
      { runId: 'r1', laneKey: 'b1', label: '北京人社局', startUrl: 'https://bj.example.com' },
      { runId: 'r1', laneKey: 'b2', label: '上海人社局', startUrl: 'https://sh.example.com' },
    ]); // 每 lane createSession 恰一次＋lane 标签=支首节点名
    expect(fx.navigations).toEqual([]); // 首建不走 navigate
    expect(events.filter((e) => e.nodeId === 'b1' && e.status === 'running')[0]?.laneLabel).toBe('北京人社局');
    expect(events.filter((e) => e.nodeId === 'b2' && e.status === 'running')[0]?.laneLabel).toBe('上海人社局');
  });

  it('同 lane 后续 cdp.* 复用会话只更新 URL——createSession 仍恰一次', async () => {
    const fx = makeExecTransport();
    const doc = flowDoc(
      'f1',
      [
        node('t1', 'trigger.manual'),
        node('o1', 'cdp.open', { params: { url: 'https://a.example.com' } }),
        node('o2', 'cdp.open', { params: { url: 'https://b.example.com' } }),
      ],
      [edge('t1', 'o1'), edge('o1', 'o2')],
    );
    const env = makeEnv({ f1: doc }, { transport: fx.transport });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ o1: 'done', o2: 'done' });
    expect(fx.sessions).toHaveLength(1); // 单出边链=同 lane（main）——createSession 恰一次
    expect(fx.sessions[0]).toMatchObject({ laneKey: 'main', startUrl: 'https://a.example.com' });
    expect(fx.navigations).toEqual([{ runId: 'r1', laneKey: 'main', url: 'https://b.example.com' }]);
  });
});

describe('RunEngine §6.1e 汇合（02 §10 #5）', () => {
  it('3 入边 1 死（静态不可达支出边预杀）：收 2 即执行不等死边', async () => {
    const doc = flowDoc(
      'f1',
      [node('t1', 'trigger.manual'), node('t2', 'trigger.cron'), node('u', 'data.transform'), node('w', 'data.transform'), node('j', 'data.transform', { name: '汇合点' })],
      [edge('t1', 'j'), edge('t2', 'j'), edge('u', 'j'), edge('u', 'w'), edge('w', 'u')], // u↔w 环＝两节点均不可达
    );
    const env = makeEnv({ f1: doc });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ u: 'skipped', w: 'skipped', t1: 'done', t2: 'done', j: 'done' }); // j 收 2 即执行
    const jStarts = env.calls.filter((c) => c.op === 'runs.nodeRunStart' && (c as { args: { nodeId: string } }).args.nodeId === 'j');
    expect(jStarts).toHaveLength(1); // 恰执行一次
  });
});

describe('RunEngine §6.3 NodeOut 路由（02 §14）', () => {
  const BRANCH_DEF = def('custom.branch', ['in'], 'custom', {
    ports: { ins: ['in'], outs: [{ id: 'true', label: '是' }, { id: 'false', label: '否' }] },
  });

  it('{data} → 全部存活出边交付（下游 input=data）', async () => {
    const fx = makeExecTransport();
    fx.script('a', [{ type: 'result', out: { data: 'X' } }]);
    fx.script('b1', [{ type: 'result', out: { data: null } }]);
    fx.script('b2', [{ type: 'result', out: { data: null } }]);
    const doc = flowDoc(
      'f1',
      [node('t1', 'trigger.manual'), node('a', 'custom.x'), node('b1', 'custom.x'), node('b2', 'custom.x')],
      [edge('t1', 'a'), edge('a', 'b1'), edge('a', 'b2')],
    );
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [BRANCH_DEF] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ a: 'done', b1: 'done', b2: 'done' });
    const inputOf = (id: string): unknown => fx.spawns.find((s) => s.nodeRunId === `r1:${id}`)?.input;
    expect(inputOf('b1')).toBe('X'); // 两下游均收到 data
    expect(inputOf('b2')).toBe('X');
    const aFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:a');
    expect((aFinish as { args: { output: unknown } }).args.output).toEqual({ data: 'X' }); // output={data} 落库
  });

  it('{branch,meta} → 只发 id===branch 出边＋meta 原样入 node_runs.output；未命中边死亡计日志', async () => {
    const fx = makeExecTransport();
    fx.script('b', [{ type: 'result', out: { branch: 'true', score: 9, tag: 'hot' } }]);
    fx.script('c1', [{ type: 'result', out: { data: null } }]);
    const doc = flowDoc(
      'f1',
      [node('t1', 'trigger.manual'), node('b', 'custom.branch'), node('c1', 'custom.x'), node('c2', 'custom.x')],
      [edge('t1', 'b'), edge('b', 'c1', 'true'), edge('b', 'c2', 'false')],
    );
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [BRANCH_DEF] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ b: 'done', c1: 'done' });
    expect(handle?.statuses.c2).toBeUndefined(); // 未命中支不执行（级联 ⊘ 归 T4-03）
    const inputOf = (id: string): unknown => fx.spawns.find((s) => s.nodeRunId === `r1:${id}`)?.input;
    expect(inputOf('c1')).toEqual({ score: 9, tag: 'hot' }); // input=meta（去 branch 键）
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:c2')).toBe(false); // 只发命中边
    const bFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:b');
    expect((bFinish as { args: { output: unknown } }).args.output).toEqual({ branch: 'true', score: 9, tag: 'hot' }); // meta 原样入 output
    const skipLog = logCalls(env.calls).map((c) => (c as { args: { msg: string } }).args).find((a) => a.msg.includes('分支跳过：c2'));
    expect(skipLog).toBeTruthy();
  });

  it('branch 未命中 N2 outs → 节点 error＋run 失败停派生（防拼写错路由）', async () => {
    const fx = makeExecTransport();
    fx.script('b', [{ type: 'result', out: { branch: 'ture' } }]); // 拼写错
    const doc = flowDoc(
      'f1',
      [node('t1', 'trigger.manual'), node('b', 'custom.branch'), node('c1', 'custom.x')],
      [edge('t1', 'b'), edge('b', 'c1', 'true')],
    );
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [BRANCH_DEF] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ b: 'error' });
    expect(handle?.statuses.c1).toBeUndefined(); // 失败终止：不再派生
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:c1')).toBe(false);
    expect(env.toasts[0]).toMatchObject({ level: 'err', msg: expect.stringContaining('任务失败') });
    const bFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:b');
    expect((bFinish as { args: { status: string; error: string } }).args).toMatchObject({ status: 'error', error: expect.stringContaining('出口未命中') });
  });

  it('N5 组合节点：单进程内联展开＋emit 提前出口＋`[lane] ▸ 步骤N` 日志前缀（02 §8.5）', async () => {
    const fx = makeExecTransport();
    const N5_DEF = def('custom.reply', ['in'], 'custom', {
      inner: ['取材·列表复放', '会话判向', '意图识别'],
      ports: { ins: ['in'], outs: [{ id: 'replied', label: '已回复' }, { id: 'escalated', label: '转人工' }, { id: 'skipped', label: '拒答' }] },
    });
    // 单进程内：emit escalated（提前出口）→ 最终 return {data} 汇总（demo L1019-1024 模式）
    fx.script('r', [
      { type: 'emit', branch: 'escalated', payload: { session: 's1' } },
      { type: 'result', out: { data: { handled: 1 } } },
    ]);
    fx.script('e', [{ type: 'result', out: { data: null } }]);
    const doc = flowDoc(
      'f1',
      [node('t1', 'trigger.manual'), node('r', 'custom.reply'), node('e', 'custom.x'), node('p', 'custom.x')],
      [edge('t1', 'r'), edge('r', 'e', 'escalated'), edge('r', 'p', 'replied')],
    );
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [N5_DEF] });
    const events: { nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:r')).toHaveLength(1); // 单进程（inner 共享）
    expect(handle?.statuses).toMatchObject({ r: 'done', e: 'done' });
    expect(handle?.statuses.p).toBeUndefined(); // replied 未 emit——不交付
    const eInput = fx.spawns.find((s) => s.nodeRunId === 'r1:e')?.input;
    expect(eInput).toEqual({ session: 's1' }); // emit payload 交付命中边
    // 提前出口：下游 e 的 running 先于组合节点 r 的 done
    const eRunning = events.findIndex((ev) => ev.nodeId === 'e' && ev.status === 'running');
    const rDone = events.findIndex((ev) => ev.nodeId === 'r' && ev.status === 'done');
    expect(eRunning).toBeGreaterThanOrEqual(0);
    expect(eRunning).toBeLessThan(rDone);
    const stepLogs = logCalls(env.calls).map((c) => (c as { args: { msg: string } }).args).filter((a) => a.msg.includes('▸ 步骤'));
    expect(stepLogs.map((a) => a.msg)).toEqual([
      '[流程f1] ▸ 步骤1 取材·列表复放',
      '[流程f1] ▸ 步骤2 会话判向',
      '[流程f1] ▸ 步骤3 意图识别',
    ]);
    const rFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:r');
    expect((rFinish as { args: { output: unknown } }).args.output).toEqual({ data: { handled: 1 } }); // 最终 {data} 汇总入 output
  });
});

// ————————————————————————————————————————————
// RunGate 组件级（check 入参/返回形冻结）
// ————————————————————————————————————————————

describe('RunGate 组件级', () => {
  const gate = (over: { dirty?: boolean; active?: boolean; broken?: readonly string[] } = {}) =>
    new RunGate({
      registry: fakeRegistry(over.broken ?? []),
      guardDirty: () => over.dirty ?? false,
      isActiveRun: () => over.active ?? false,
    });

  it('三查全过 → ok', () => {
    expect(gate().check('f1', MAIN_CHAIN)).toEqual({ ok: true });
  });

  it('查序：脏 → 重复 → 缺触发 → broken → noScript（demo L1792-1796 序＋02 §12.4 附加拦截）', () => {
    expect(gate({ dirty: true, active: true }).check('f1', MAIN_CHAIN)).toMatchObject({ ok: false, reason: 'dirty' });
    expect(gate({ active: true }).check('f1', MAIN_CHAIN)).toMatchObject({ ok: false, reason: 'duplicate' });
    const noTrigger = flowDoc('f2', [node('a', 'delay')], []);
    expect(gate().check('f2', noTrigger)).toMatchObject({ ok: false, reason: 'no-trigger' });
    const brokenDoc = flowDoc('f3', [node('t1', 'trigger.manual'), node('a', 'broken.y')], [edge('t1', 'a')]);
    expect(gate({ broken: ['broken.y'] }).check('f3', brokenDoc)).toMatchObject({ ok: false, reason: 'broken-def' });
    const noScriptDoc = flowDoc('f4', [node('t1', 'trigger.manual'), node('a', 'custom.x', { noScript: true })], [edge('t1', 'a')]);
    expect(gate().check('f4', noScriptDoc)).toMatchObject({ ok: false, reason: 'no-script' });
  });
});
