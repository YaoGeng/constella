// HitCoordinator＋断点套件（T4-04；TDD-C-03 §3 HitCoordinator 行＋§1 补充冻结段＋§6.4；
// 01 A-7.1 对齐 LangGraph interrupt()/Command(resume)；demo L1869-1889/L1991 行为源）。
// 断言面：
//   组件级：hit()=hits.create pending（data_snapshot=上游真实输出 B-4、question/options）＋
//   挂起门闩＋runStore.pendingHits 登记；resume(confirm,merged)=交付合并值＋hits.resolve
//   (resolved,payload=merged)；resume(skip)=原始 input 直发＋hits.resolve(skipped,null)；
//   未知 hitId → false no-op；300ms 轮询（demo L1991）——run 终止后轮询拍自动放行
//   （reject ExecAbortedError＋hits.resolve(skipped)）；releaseAll()=终止即时放行路径
//   （全部 reject＋resolve skipped）；
//   引擎级 §6.4：waiting→hits.create(data_snapshot=上游 output)→resumeHit(confirm) 交付
//   合并值给下游 / resumeHit(skip) 直发原始 input；run 终止→断点放行＋hits.resolve(skipped)。
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FlowDoc, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import { HitCoordinator } from './hit-coordinator';
import { ExecAbortedError } from './exec-dispatcher';
import { useRunStore } from './run-store';
import type { RunRegistryLike, RunTransport } from './types';

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
  const defs = [def('trigger.manual', []), def('data.transform', ['in']), def('human.review', ['in']), def('custom.src', ['in']), def('custom.dst', ['in'])];
  return { get: (t) => defs.find((d) => d.type === t), isBroken: () => false };
}

/** fake storage：hits.create → {id:`h:<nodeId>`}；hits.resolve 记录入 resolves */
function makeStorage() {
  const calls: StorageInvokeReq[] = [];
  const resolves: { id: string; status: string; payload: unknown }[] = [];
  const handlers = new Map<string, (req: StorageInvokeReq) => unknown>();
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      const h = handlers.get(req.op);
      if (h === undefined) throw new Error(`mock bridge 未注册 op：${req.op}`);
      return h(req);
    },
  };
  const on = (op: string, h: (req: StorageInvokeReq) => unknown) => handlers.set(op, h);
  return { calls, resolves, on, client: createStorageClient(bridge) };
}

function makeExecTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: { nodeRunId: string; input: unknown }[] = [];
  const emit = (nodeRunId: string, ev: Omit<ScriptEvent, 'nodeRunId'>): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, ...ev });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push({ nodeRunId: req.nodeRunId, input: req.input });
      // custom.src → 真实上游输出 {jd:...}（B-4 data_snapshot 数据源）；其余 result 直通
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const out = nodeId === 'src' ? { data: { jd: '岗位JD原文' } } : { data: 'ok' };
      emit(req.nodeRunId, { kind: 'stdout', chunk: `${JSON.stringify({ type: 'result', out })}\n` });
      emit(req.nodeRunId, { kind: 'exit', code: 0 });
      return { ok: true, pid: 1 };
    },
    killScript: async () => ({ ok: true }),
    cdpCreateSession: async () => ({ port: 9221, partition: 'p' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => ({ ok: true }),
  };
  return { transport, spawns };
}

function makeEnv(docMap: Record<string, FlowDoc>) {
  const storage = makeStorage();
  const fx = makeExecTransport();
  let runSeq = 0;
  storage.on('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  storage.on('runs.create', () => ({ id: `r${++runSeq}` }));
  for (const op of ['runs.finish', 'runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append']) storage.on(op, () => undefined);
  storage.on('hits.create', (req) => ({ id: `h:${(req as { args: { nodeId: string } }).args.nodeId}` }));
  storage.on('hits.resolve', (req) => {
    const a = (req as { args: { id: string; status: string; payload: unknown } }).args;
    storage.resolves.push({ id: a.id, status: a.status, payload: a.payload });
    return undefined;
  });
  const engine = createRunEngine({ storage: storage.client, registry: fakeRegistry(), guardDirty: () => false, transport: fx.transport });
  return { storage, fx, engine };
}

function flowNode(id: string, type: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

function edge(from: string, to: string): { id: string; from: [string, string]; to: [string, string] } {
  return { id: `${from}(out)--${to}`, from: [from, 'out'], to: [to, 'in'] };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** 轮询等待条件成立（真实计时；上限 2s 防挂死） */
async function until(cond: () => boolean, stepMs = 5, timeoutMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('until() 超时');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

afterEach(() => {
  useRunStore.getState().reset();
  vi.useRealTimers();
});

// ————————————————————————————————————————————
// HitCoordinator 组件级（§3：hit/resume）
// ————————————————————————————————————————————

describe('HitCoordinator 组件级', () => {
  function makeCoord(over: { isRunOver?: () => boolean; pollMs?: number } = {}) {
    const storage = makeStorage();
    storage.on('hits.create', (req) => ({ id: `h:${(req as { args: { nodeId: string } }).args.nodeId}` }));
    storage.on('hits.resolve', (req) => {
      const a = (req as { args: { id: string; status: string; payload: unknown } }).args;
      storage.resolves.push({ id: a.id, status: a.status, payload: a.payload });
      return undefined;
    });
    const coord = new HitCoordinator({
      runId: 'r1',
      storage: storage.client,
      now: () => 0,
      isRunOver: over.isRunOver ?? (() => false),
      ...(over.pollMs !== undefined ? { pollMs: over.pollMs } : {}),
    });
    return { storage, coord };
  }

  it('hit()：hits.create pending（data_snapshot=上游真实输出＋question/options）＋挂起门闩＋pendingHits 登记', async () => {
    const { storage, coord } = makeCoord();
    const p = coord.hit('h', { jd: '上游输出' }, '请确认以下信息', ['选项A', '选项B']);
    await flush(); // hits.create microtask
    const create = storage.calls.find((c) => c.op === 'hits.create') as { args: Record<string, unknown> } | undefined;
    expect(create?.args).toMatchObject({
      runId: 'r1',
      nodeId: 'h',
      question: '请确认以下信息',
      options: ['选项A', '选项B'],
      dataSnapshot: { jd: '上游输出' }, // B-4：上游真实输出
    });
    expect(useRunStore.getState().pendingHits['h:h']).toMatchObject({ runId: 'r1', nodeId: 'h' });
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false); // 门闩关闭：挂起中
    void coord.resume('h:h', { kind: 'skip' }); // 收尾放行（避免悬挂 promise）
    await p;
  });

  it('resume(confirm,merged)：交付合并值＋hits.resolve(resolved,payload=merged)', async () => {
    const { storage, coord } = makeCoord();
    const p = coord.hit('h', { jd: '原始' }, 'q', []);
    await flush();
    expect(coord.resume('h:h', { kind: 'confirm', merged: { jd: '原始', picks: [1] } })).toBe(true);
    await expect(p).resolves.toEqual({ jd: '原始', picks: [1] }); // 合并值交付（01 A-7.1）
    expect(storage.resolves).toEqual([{ id: 'h:h', status: 'resolved', payload: { jd: '原始', picks: [1] } }]);
    expect(useRunStore.getState().pendingHits['h:h']).toBeUndefined(); // 登记移除
  });

  it('resume(skip)：原始 input 直发＋hits.resolve(skipped,payload=null)', async () => {
    const { storage, coord } = makeCoord();
    const p = coord.hit('h', { jd: '原始' }, 'q', []);
    await flush();
    expect(coord.resume('h:h', { kind: 'skip' })).toBe(true);
    await expect(p).resolves.toEqual({ jd: '原始' }); // 原始 input 直发（01 A-7.1）
    expect(storage.resolves).toEqual([{ id: 'h:h', status: 'skipped', payload: null }]);
  });

  it('resume 未知 hitId → false no-op', async () => {
    const { coord } = makeCoord();
    expect(coord.resume('h:none', { kind: 'skip' })).toBe(false);
  });

  it('run 终止 300ms 轮询自动放行（demo L1991）：reject ExecAbortedError＋hits.resolve(skipped)', async () => {
    vi.useFakeTimers();
    let over = false;
    const { storage, coord } = makeCoord({ isRunOver: () => over, pollMs: 300 });
    const p = coord.hit('h', { jd: 'x' }, 'q', []);
    await vi.advanceTimersByTimeAsync(299);
    const assertion = expect(p).rejects.toBeInstanceOf(ExecAbortedError);
    over = true; // run 终止
    await vi.advanceTimersByTimeAsync(300); // 下一轮询拍放行（finish(null) 语义）
    await assertion;
    expect(storage.resolves).toEqual([{ id: 'h:h', status: 'skipped', payload: null }]);
    expect(useRunStore.getState().pendingHits['h:h']).toBeUndefined();
  });

  it('releaseAll()：终止即时放行路径——全部 reject＋resolve skipped，返回放行数', async () => {
    const { storage, coord } = makeCoord();
    const p1 = coord.hit('h1', 'in1', 'q', []);
    const p2 = coord.hit('h2', 'in2', 'q', []);
    await flush();
    const a1 = expect(p1).rejects.toBeInstanceOf(ExecAbortedError);
    const a2 = expect(p2).rejects.toBeInstanceOf(ExecAbortedError);
    expect(coord.releaseAll()).toBe(2);
    await a1;
    await a2;
    expect(storage.resolves.map((r) => r.status)).toEqual(['skipped', 'skipped']);
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.4：waiting→hits.create→resumeHit 两态
// ————————————————————————————————————————————

describe('RunEngine §6.4 断点挂起与 resumeHit 两态', () => {
  const DOC: FlowDoc = {
    id: 'f1',
    name: '流程f1',
    nodes: [
      flowNode('t1', 'trigger.manual'),
      flowNode('src', 'custom.src'),
      flowNode('h', 'human.review', { question: '请确认JD与筛选', options: ['要', '不要'] }),
      flowNode('dst', 'custom.dst'),
    ],
    edges: [edge('t1', 'src'), edge('src', 'h'), edge('h', 'dst')],
  };

  async function startAndWaitHit() {
    const env = makeEnv({ f1: DOC });
    const events: { nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    await until(() => events.some((e) => e.nodeId === 'h' && e.status === 'waiting'));
    return { ...env, events, handle: handle! };
  }

  it('waiting＋hits.create pending（data_snapshot=上游真实输出，B-4）', async () => {
    const { storage, handle, events } = await startAndWaitHit();
    expect(handle.statuses).toMatchObject({ h: 'waiting' });
    const create = storage.calls.find((c) => c.op === 'hits.create') as { args: Record<string, unknown> } | undefined;
    expect(create?.args).toMatchObject({
      runId: handle.runId,
      nodeId: 'h',
      question: '请确认JD与筛选',
      options: ['要', '不要'],
      dataSnapshot: { jd: '岗位JD原文' }, // 上游 src 的真实输出（非 mock 占位）
    });
    expect(useRunStore.getState().pendingHits[`h:h`]).toMatchObject({ runId: handle.runId, nodeId: 'h' });
  });

  it('resumeHit(confirm,merged)：合并值交付下游＋hits.resolve(resolved)＋run=done', async () => {
    const { storage, fx, engine, handle } = await startAndWaitHit();
    engine.resumeHit('h:h', { kind: 'confirm', merged: { jd: '岗位JD原文', filters: ['本科'], notes: '补充' } });
    await engine.whenSettled(handle.runId);
    await flush();
    expect(handle.statuses).toMatchObject({ h: 'done', dst: 'done' });
    const dstSpawn = fx.spawns.find((s) => s.nodeRunId === `${handle.runId}:dst`);
    expect(dstSpawn?.input).toEqual({ jd: '岗位JD原文', filters: ['本科'], notes: '补充' }); // 合并值交付（A-7.1/B-4）
    expect(storage.resolves).toEqual([
      { id: 'h:h', status: 'resolved', payload: { jd: '岗位JD原文', filters: ['本科'], notes: '补充' } },
    ]);
    const finish = storage.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'done' });
  });

  it('resumeHit(skip)：原始 input 直发下游（不走合并）＋hits.resolve(skipped)', async () => {
    const { storage, fx, engine, handle } = await startAndWaitHit();
    engine.resumeHit('h:h', { kind: 'skip' });
    await engine.whenSettled(handle.runId);
    await flush();
    expect(handle.statuses).toMatchObject({ h: 'done', dst: 'done' });
    const dstSpawn = fx.spawns.find((s) => s.nodeRunId === `${handle.runId}:dst`);
    expect(dstSpawn?.input).toEqual({ jd: '岗位JD原文' }); // 原始 input 直发
    expect(storage.resolves).toEqual([{ id: 'h:h', status: 'skipped', payload: null }]);
  });

  it('run 终止→断点自动放行（finish(null) 语义）＋hits.resolve(skipped)＋节点 ⊘', async () => {
    const { storage, engine, handle } = await startAndWaitHit();
    engine.abortRun(handle.runId);
    await engine.whenSettled(handle.runId);
    await flush();
    expect(handle.statuses).toMatchObject({ h: 'skipped' }); // ⊘ 收敛（不交付下游）
    expect(storage.resolves).toEqual([{ id: 'h:h', status: 'skipped', payload: null }]); // 断点落 skipped
    expect(useRunStore.getState().pendingHits['h:h']).toBeUndefined();
  });

  it('resumeHit 未知 hitId → no-op（run 不受扰）', async () => {
    const { engine, handle } = await startAndWaitHit();
    engine.resumeHit('h:none', { kind: 'skip' });
    await flush();
    expect(handle.statuses).toMatchObject({ h: 'waiting' }); // 仍挂起
    engine.resumeHit('h:h', { kind: 'skip' }); // 收尾
    await engine.whenSettled(handle.runId);
  });
});
