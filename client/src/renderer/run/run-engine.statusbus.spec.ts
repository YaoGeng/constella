// StatusBus＋statuses 双写一致性套件（T4-04；TDD-C-03 §3 StatusBus 行＋§1 补充冻结段
// ＋§6.4；A-6.5；demo L1763-1767 双写语义源）。
// 断言面：
//   组件级：emit→subscribe 事件派发；appendLog=logs.append 落库＋onLog 同点派发
//   （LogLine 形=logs 表行去 id）；nodeRunStart/nodeRunFinish=storage op 恰形；
//   引擎级 §6.4：run 结束后 fake store 断言 runs.finish 字段（status/t1/aborted/failed/
//   total/skips）＋nodeRunStart/nodeRunFinish 序列与 onNodeStatus 事件序列一致（每个
//   running 事件恰对应一次 nodeRunStart 同 nodeId 同序、done/error/skipped 恰对应
//   nodeRunFinish）＋logs.append 计数；
//   runStore 镜像（02 §3.3）：activeRunOfFlow 开/收、lastRunOfFlow.statuses 与
//   RunHandle.statuses 深等、pendingHits 登记/移除（事件管线同点）。
import { describe, expect, it, afterEach } from 'vitest';
import type { FlowDoc, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import { StatusBus } from './status-bus';
import { useRunStore } from './run-store';
import type { NodeStatusEvent, RunRegistryLike, RunTransport } from './types';

// ————————————————————————————————————————————
// fixture
// ——————————————————————————————————————————

function def(type: string, ins: string[], over: Partial<NodeDefinition> = {}): NodeDefinition {
  const custom = type.startsWith('custom.');
  return {
    type,
    kind: custom ? 'custom' : 'builtin',
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins, outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: custom ? { lang: 'ts', file: `scripts/${type}.ts`, entry: 'run' } : null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...over,
  };
}

function fakeRegistry(): RunRegistryLike {
  const defs = [def('trigger.manual', []), def('data.transform', ['in']), def('human.review', ['in']), def('custom.x', ['in'])];
  return { get: (t) => defs.find((d) => d.type === t), isBroken: () => false };
}

function makeStorage() {
  const calls: StorageInvokeReq[] = [];
  const handlers = new Map<string, (req: StorageInvokeReq) => unknown>();
  // 组件级直驱用例的默认 op 面（引擎级用例按需覆写）
  for (const op of ['logs.append', 'runs.nodeRunStart', 'runs.nodeRunFinish']) handlers.set(op, () => undefined);
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

function makeTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      for (const fn of scriptSubs)
        fn({ nodeRunId: req.nodeRunId, kind: 'stdout', chunk: `${JSON.stringify({ type: 'result', out: { data: 'R' } })}\n` });
      for (const fn of scriptSubs) fn({ nodeRunId: req.nodeRunId, kind: 'exit', code: 0 });
      return { ok: true, pid: 1 };
    },
    killScript: async () => ({ ok: true }),
    cdpCreateSession: async () => ({ port: 9221, partition: 'p' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => ({ ok: true }),
  };
  return transport;
}

function makeEnv(doc: FlowDoc) {
  const storage = makeStorage();
  let runSeq = 0;
  storage.on('flows.get', () => doc);
  storage.on('runs.create', () => ({ id: `r${++runSeq}` }));
  for (const op of ['runs.finish', 'runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append', 'hits.resolve']) storage.on(op, () => undefined);
  storage.on('hits.create', (req) => ({ id: `h:${(req as { args: { nodeId: string } }).args.nodeId}` }));
  const engine = createRunEngine({ storage: storage.client, registry: fakeRegistry(), guardDirty: () => false, transport: makeTransport() });
  return { storage, engine };
}

function flowNode(id: string, type: string): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params: {} };
}

function edge(from: string, to: string): { id: string; from: [string, string]; to: [string, string] } {
  return { id: `${from}(out)--${to}`, from: [from, 'out'], to: [to, 'in'] };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  useRunStore.getState().reset();
});

// ————————————————————————————————————————————
// StatusBus 组件级（§3：emit/subscribe/onLog）
// ————————————————————————————————————————————

describe('StatusBus 组件级', () => {
  it('emit → subscribe 订阅方收事件＋退订止损', () => {
    const bus = new StatusBus({ storage: makeStorage().client, now: () => 0 });
    const got: NodeStatusEvent[] = [];
    const unsub = bus.subscribe((e) => got.push(e));
    bus.emit({ runId: 'r1', nodeId: 'a', status: 'running' });
    unsub();
    bus.emit({ runId: 'r1', nodeId: 'a', status: 'done' });
    expect(got).toEqual([{ runId: 'r1', nodeId: 'a', status: 'running' }]);
  });

  it('appendLog：logs.append 落库恰形＋onLog 同点派发（LogLine 形=logs 表行去 id）', async () => {
    const { calls, client } = makeStorage();
    const bus = new StatusBus({ storage: client, now: () => 1_700_000_000_000 });
    const lines: unknown[] = [];
    bus.onLog((l) => lines.push(l));
    await bus.appendLog('info', 'hello', { flowId: 'f1', runId: 'r1', laneLabel: '主支' });
    expect(calls).toEqual([{ op: 'logs.append', args: { level: 'info', msg: 'hello', flowId: 'f1', runId: 'r1', laneLabel: '主支' } }]);
    expect(lines).toEqual([{ ts: new Date(1_700_000_000_000).toISOString(), level: 'info', msg: 'hello', flowId: 'f1', runId: 'r1', laneLabel: '主支' }]);
  });

  it('nodeRunStart/nodeRunFinish：storage op 恰形透传', async () => {
    const { calls, client } = makeStorage();
    const bus = new StatusBus({ storage: client, now: () => 0 });
    await bus.nodeRunStart({ nodeRunId: 'r1:a', runId: 'r1', laneId: 'main', nodeId: 'a' });
    await bus.nodeRunFinish({ nodeRunId: 'r1:a', status: 'done', endedAt: 5, output: { data: 'x' } });
    expect(calls).toEqual([
      { op: 'runs.nodeRunStart', args: { nodeRunId: 'r1:a', runId: 'r1', laneId: 'main', nodeId: 'a' } },
      { op: 'runs.nodeRunFinish', args: { nodeRunId: 'r1:a', status: 'done', endedAt: 5, output: { data: 'x' } } },
    ]);
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.4：双写字段与事件序列一致＋runStore 镜像
// ————————————————————————————————————————————

describe('RunEngine §6.4 statuses 双写一致', () => {
  const DOC: FlowDoc = {
    id: 'f1',
    name: '流程f1',
    nodes: [flowNode('t1', 'trigger.manual'), flowNode('a', 'data.transform'), flowNode('b', 'custom.x')],
    edges: [edge('t1', 'a'), edge('a', 'b')],
  };

  it('runs.finish 字段＋nodeRunStart/Finish 与事件序列一致＋logs.append 计数', async () => {
    const { storage, engine } = makeEnv(DOC);
    const events: NodeStatusEvent[] = [];
    engine.onNodeStatus((e) => events.push(e));
    const handle = (await engine.startRun('f1'))!;
    await engine.whenSettled(handle.runId);
    await flush();
    // runs.finish 字段（02 §7.1：status/t1/aborted/failed/total/skips）
    const finish = storage.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ runId: handle.runId, status: 'done', aborted: 0, failed: 0, total: 3, skips: [] });
    expect(typeof finish?.args.t1).toBe('number');
    // 事件序列：t1/a/b 各 running→done（BFS 执行序）
    expect(events.map((e) => `${e.nodeId}:${e.status}`)).toEqual(['t1:running', 't1:done', 'a:running', 'a:done', 'b:running', 'b:done']);
    // nodeRunStart 序列与 running 事件一致（同 nodeId 同序）
    const starts = storage.calls.filter((c) => c.op === 'runs.nodeRunStart').map((c) => (c as { args: { nodeId: string; runId: string; laneId: string } }).args);
    expect(starts.map((s) => s.nodeId)).toEqual(events.filter((e) => e.status === 'running').map((e) => e.nodeId));
    for (const s of starts) expect(s).toMatchObject({ runId: handle.runId, laneId: 'main' });
    // nodeRunFinish 序列与终态事件一致（done/error/skipped）
    const finishes = storage.calls.filter((c) => c.op === 'runs.nodeRunFinish').map((c) => (c as { args: { nodeRunId: string; status: string } }).args);
    expect(finishes.map((f) => `${f.nodeRunId.split(':')[1]}:${f.status}`)).toEqual(['t1:done', 'a:done', 'b:done']);
    // logs.append：启动日志＋每节点执行/完成日志＋任务完成日志 ≥7
    const logs = storage.calls.filter((c) => c.op === 'logs.append');
    expect(logs.length).toBeGreaterThanOrEqual(7);
  });

  it('onRunLog 导出面：logs.append 双写管线同点派发（M4 #2——每落库行对应一事件行）', async () => {
    const { storage, engine } = makeEnv(DOC);
    const lines: string[] = [];
    engine.onRunLog((l) => lines.push(`${l.level}|${l.msg}`));
    await engine.startRun('f1');
    await flush();
    const logCalls = storage.calls.filter((c) => c.op === 'logs.append').map((c) => (c as { args: { level: string; msg: string } }).args);
    expect(lines).toEqual(logCalls.map((a) => `${a.level}|${a.msg}`)); // 一一对应
  });

  it('runStore 镜像：activeRunOfFlow 开/收＋lastRunOfFlow.statuses 与 RunHandle 深等（02 §3.3/A-6.5）', async () => {
    const { engine } = makeEnv(DOC);
    const handle = (await engine.startRun('f1'))!;
    await engine.whenSettled(handle.runId);
    await flush();
    const store = useRunStore.getState();
    expect(store.activeRunOfFlow.f1).toBeUndefined(); // 收尾解除活跃
    expect(store.lastRunOfFlow.f1).toMatchObject({ runId: handle.runId, statuses: handle.statuses }); // 画面还原数据源（含终态）
    // 运行中镜像：再开一 run 断言活跃登记
    const handle2 = (await engine.startRun('f1'))!;
    expect(useRunStore.getState().activeRunOfFlow.f1).toBe(handle2.runId);
    await engine.abortRun(handle2.runId);
    await engine.whenSettled(handle2.runId);
    await flush();
    expect(useRunStore.getState().activeRunOfFlow.f1).toBeUndefined();
    expect(useRunStore.getState().lastRunOfFlow.f1).toMatchObject({ runId: handle2.runId }); // 最近 run 覆盖
  });
});
