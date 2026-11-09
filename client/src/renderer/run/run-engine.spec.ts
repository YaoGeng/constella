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
import type { FlowDoc, FlowEdge, FlowNode, StorageInvokeReq } from '@constella/shared/ipc';
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

function def(type: string, ins: string[], kind: 'builtin' | 'custom' = 'builtin'): NodeDefinition {
  return {
    type,
    kind,
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins, outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: kind === 'custom' ? { lang: 'ts', file: `scripts/${type}.ts`, entry: 'run' } : null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

/** 注册表注入面：内置 5 类 + broken.y / custom.x（P1 波 registry-core 同语义的最小结构面） */
function fakeRegistry(broken: readonly string[] = []): RunRegistryLike {
  const defs = [
    def('trigger.manual', []),
    def('trigger.cron', []),
    def('data.transform', ['in']),
    def('delay', ['in']),
    def('custom.x', ['in'], 'custom'),
    def('broken.y', ['in']),
  ];
  return {
    get: (type) => defs.find((d) => d.type === type),
    isBroken: (type) => broken.includes(type),
  };
}

function node(id: string, type: string, over: Partial<FlowNode> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params: {}, ...over };
}

function edge(from: string, to: string): FlowEdge {
  return { id: `${from}--${to}`, from: [from, 'out'], to: [to, 'in'] };
}

/** t1→a→b 主干＋可选附加节点/边 */
function flowDoc(id: string, nodes: FlowNode[], edges: FlowEdge[]): FlowDoc {
  return { id, name: `流程${id}`, nodes, edges };
}

const MAIN_CHAIN: FlowDoc = flowDoc('f1', [node('t1', 'trigger.manual'), node('a', 'data.transform'), node('b', 'delay')], [edge('t1', 'a'), edge('a', 'b')]);

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
function makeEnv(docMap: Record<string, FlowDoc>, over: { broken?: readonly string[]; guardDirty?: (flowId: string) => boolean; transport?: RunTransport } = {}) {
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
  on('logs.append', () => undefined);

  const toasts: { level: string; msg: string }[] = [];
  const ledger = new RunLedger(1000);
  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(over.broken ?? []),
    guardDirty: over.guardDirty ?? (() => false),
    notify: (level, msg) => toasts.push({ level, msg }),
    ledger,
    ...(over.transport ? { transport: over.transport } : {}),
  });
  return { calls, engine, ledger, toasts };
}

/** fake Transport：手动收集/触发 cron:fired 订阅 */
function fakeTransport() {
  const subs: ((e: { flowId: string }) => void)[] = [];
  const transport: RunTransport = { onCronFired: (fn) => (subs.push(fn), () => {}) };
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
    expect(logCalls(env.calls).at(-1)).toMatchObject({ op: 'logs.append', args: { level: 'err', msg: '运行失败：该流程已有任务在运行' } });
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
    expect(handle?.statuses).toEqual({ lonely: 'skipped' });
    expect(events).toEqual([{ runId: 'r1', nodeId: 'lonely', status: 'skipped' }]);
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'info', msg: '▶ 任务「流程f1」启动 — 2 个节点入队，1 个未连接节点跳过' } });
  });

  it('无孤立节点：启动日志不含跳过段；onRunLog 同点派发日志行', async () => {
    const env = makeEnv({ f1: MAIN_CHAIN });
    const lines: { level: string; msg: string }[] = [];
    env.engine.onRunLog((l) => lines.push({ level: l.level, msg: l.msg }));
    const handle = await env.engine.startRun('f1');
    expect(handle?.statuses).toEqual({});
    expect(lines.at(-1)).toMatchObject({ level: 'info', msg: '▶ 任务「流程f1」启动 — 3 个节点入队' });
    expect(lines.at(-1)?.msg).not.toContain('跳过');
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
    expect(logCalls(env.calls).at(-1)).toMatchObject({ args: { level: 'warn', msg: expect.stringContaining('任务已终止') } });

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
