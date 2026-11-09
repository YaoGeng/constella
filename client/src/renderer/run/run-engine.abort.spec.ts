// AbortCoordinator＋断连分支＋delay 套件（T4-03；TDD-C-03 §3 组件行；02 §10 #8/#10＋X-3；
// demo L1777-1787/L1934-1935 行为源）。
// 断言面：
//   AbortCoordinator 组件级：abort=置位＋killScript×活跃数＋waiting 断点放行；destroySessions
//   幂等恰一次；未注册 run → no-op；
//   引擎级 §6.1h：3 lane 活跃脚本＋1 waiting 断点——置位后 killScript×3、destroyRun 恰一次、
//   断点自动放行（waiting→skipped）、被杀脚本节点 ⊘ 收敛不 error、run.status=aborted＋aborted 计数；
//   引擎级 §6.1i：env:cdpProbe 失败→cdp.* 节点 error＋run 失败终止（status=error、failed=1）
//   且不走 failBranch（下游不派生，X-3 环境级豁免语义位）；probe ok → 正常执行；
//   引擎级 §6.1j：delay 真实计时（墙钟推进后透传下游）＋可中断（中途 abort→⊘ 不交付下游）。
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { AbortCoordinator } from './abort-coordinator';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import type { RunRegistryLike, RunTransport } from './types';

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

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
  const defs = [
    def('trigger.manual', []),
    def('data.transform', ['in']),
    def('delay', ['in']),
    def('cdp.open', ['in']),
    def('human.review', ['in']),
    def('custom.x', ['in']),
  ];
  return { get: (t) => defs.find((d) => d.type === t), isBroken: () => false };
}

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

/** 执行面 fake：脚本 spawn 后挂起（exit 由 killScript 触发）＋kill/destroy/probe 全记录 */
function makeExecTransport(over: { probe?: () => { ok: boolean; detail?: string } } = {}) {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: { nodeRunId: string; input: unknown }[] = [];
  const kills: { nodeRunId: string }[] = [];
  const destroys: { runId: string }[] = [];
  const probes: number[] = [];
  const behaviors = new Map<string, unknown[]>();
  const emit = (nodeRunId: string, ev: Omit<ScriptEvent, 'nodeRunId'>): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, ...ev });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push({ nodeRunId: req.nodeRunId, input: req.input });
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const frames = behaviors.get(nodeId);
      if (frames !== undefined) {
        for (const f of frames) emit(req.nodeRunId, { kind: 'stdout', chunk: `${JSON.stringify(f)}\n` });
        emit(req.nodeRunId, { kind: 'exit', code: 0 });
      } // 无 behavior：挂起等 killScript/手动驱动
      return { ok: true, pid: 1 };
    },
    killScript: async (req) => {
      kills.push({ nodeRunId: req.nodeRunId });
      emit(req.nodeRunId, { kind: 'exit', code: 1 }); // 模拟 main 强杀：进程树退出非 0
      return { ok: true };
    },
    cdpCreateSession: async () => ({ port: 9221, partition: 'persist:f1·main' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async (req) => {
      destroys.push({ runId: req.runId });
      return { ok: true };
    },
    envCdpProbe: async () => {
      probes.push(1);
      return over.probe ? over.probe() : { ok: true };
    },
  };
  return { transport, spawns, kills, destroys, probes, emit, script: (nodeId: string, frames: unknown[]) => behaviors.set(nodeId, frames) };
}

function makeEnv(docMap: Record<string, FlowDoc>, transport?: RunTransport) {
  const { calls, on, client } = makeStorage();
  let runSeq = 0;
  on('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  on('runs.create', () => ({ id: `r${++runSeq}` }));
  for (const op of ['runs.finish', 'runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append', 'hits.resolve']) on(op, () => undefined);
  on('hits.create', (req) => ({ id: `h:${(req as { args: { nodeId: string } }).args.nodeId}` }));
  const engine = createRunEngine({ storage: client, registry: fakeRegistry(), guardDirty: () => false, ...(transport ? { transport } : {}) });
  return { calls, engine };
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

// ————————————————————————————————————————————
// AbortCoordinator 组件级（02 §10 #8）
// ————————————————————————————————————————————

describe('AbortCoordinator 组件级', () => {
  function makeHooks() {
    const state = { aborted: false, released: 0 };
    const scripts = new Set<string>();
    return {
      scripts,
      state,
      hooks: {
        markAborted: () => {
          state.aborted = true;
        },
        activeScriptRuns: () => [...scripts],
        releaseWaitingHits: () => {
          state.released += 1;
          return 1;
        },
      },
    };
  }

  it('abort：置位＋killScript×活跃数＋断点放行（瞬时扩散三原语）', async () => {
    const fx = makeExecTransport();
    const { hooks, state, scripts } = makeHooks();
    scripts.add('r1:s1');
    scripts.add('r1:s2');
    const co = new AbortCoordinator({ transport: fx.transport });
    co.register('r1', hooks);
    co.abort('r1');
    expect(state.aborted).toBe(true);
    expect(fx.kills.map((k) => k.nodeRunId).sort()).toEqual(['r1:s1', 'r1:s2']); // killScript×活跃数
    expect(state.released).toBe(1);
  });

  it('destroySessions 幂等恰一次（abort 路径与收敛收尾共用）', async () => {
    const fx = makeExecTransport();
    const co = new AbortCoordinator({ transport: fx.transport });
    await co.destroySessions('r1');
    await co.destroySessions('r1');
    expect(fx.destroys).toEqual([{ runId: 'r1' }]); // 恰一次
  });

  it('unregister 后 abort → no-op（收敛收尾已解除注册）', () => {
    const fx = makeExecTransport();
    const { hooks, state } = makeHooks();
    const co = new AbortCoordinator({ transport: fx.transport });
    co.register('r1', hooks);
    co.unregister('r1');
    co.abort('r1');
    expect(state.aborted).toBe(false);
    expect(fx.kills).toEqual([]);
  });

  it('未注册 runId → no-op 返回 false（置位回退由调用方处理）', () => {
    const fx = makeExecTransport();
    const co = new AbortCoordinator({ transport: fx.transport });
    expect(co.abort('rx')).toBe(false);
    expect(fx.kills).toEqual([]);
  });

  it('transport 未注入 → 仍置位放行（本地扩散不阻塞，kill/destroy 静默跳过）', () => {
    const { hooks, state } = makeHooks();
    const co = new AbortCoordinator({});
    co.register('r1', hooks);
    expect(co.abort('r1')).toBe(true);
    expect(state.aborted).toBe(true);
    expect(state.released).toBe(1);
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.1h 终止瞬时扩散（02 §10 #8）
// ————————————————————————————————————————————

describe('RunEngine §6.1h 终止瞬时扩散', () => {
  it('3 lane 活跃脚本＋waiting 断点：置位后 killScript×3＋destroyRun 恰一次＋断点自动放行＋status=aborted', async () => {
    const fx = makeExecTransport();
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [
        flowNode('t1', 'trigger.manual'),
        flowNode('s1', 'custom.x', { name: '脚本一' }),
        flowNode('s2', 'custom.x', { name: '脚本二' }),
        flowNode('s3', 'custom.x', { name: '脚本三' }),
        flowNode('h', 'human.review', { name: '人工确认' }),
      ],
      edges: [edge('t1', 's1'), edge('t1', 's2'), edge('t1', 's3'), edge('t1', 'h')],
    };
    const env = makeEnv({ f1: doc }, fx.transport);
    const events: { nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    // 三脚本已 spawn（挂起中）＋h 已 waiting
    await until(() => fx.spawns.length === 3 && events.some((e) => e.nodeId === 'h' && e.status === 'waiting'));
    env.engine.abortRun(handle!.runId);
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.kills.map((k) => k.nodeRunId).sort()).toEqual(['r1:s1', 'r1:s2', 'r1:s3']); // killScript×活跃数
    expect(fx.destroys).toEqual([{ runId: 'r1' }]); // destroyRun 恰一次
    expect(handle?.statuses).toMatchObject({ s1: 'skipped', s2: 'skipped', s3: 'skipped', h: 'skipped' }); // 断点自动放行＋被杀脚本 ⊘ 不 error
    const hFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:h');
    expect((hFinish as { args: { status: string } }).args.status).toBe('skipped');
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'aborted', aborted: 4 }); // 3 脚本＋1 断点＝被终止计数（移交项 #6）
    const abortLog = env.calls
      .filter((c) => c.op === 'logs.append')
      .map((c) => (c as { args: { msg: string; level: string } }).args)
      .find((a) => a.msg.includes('任务已终止'));
    expect(abortLog).toMatchObject({ level: 'warn' });
    // 终止后不再派生：h 下游无 spawn（h 无下游）；s* 下游无 spawn——t1 已 done 无其他分支
  });

  it('终止不产生新派生：abort 后完成的交付不触发下游 spawn', async () => {
    const fx = makeExecTransport();
    // s 挂起脚本，下游 x；abort 后手动补发 exit 0——已终止不交付（demo L1854/L1910）
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('s', 'custom.x'), flowNode('x', 'custom.x')],
      edges: [edge('t1', 's'), edge('s', 'x')],
    };
    const env = makeEnv({ f1: doc }, fx.transport);
    const handle = await env.engine.startRun('f1');
    await until(() => fx.spawns.length === 1);
    env.engine.abortRun(handle!.runId);
    await flush();
    fx.emit('r1:s', { kind: 'exit', code: 0 }); // 终止后脚本才退出 0——也不交付
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toMatchObject({ s: 'skipped' }); // 终止波及统一 ⊘
    expect(handle?.statuses.x).toBe('skipped'); // M-1：abort 路径 drain 后仍走 converge——未派生节点统一 ⊘ 落 statuses
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:x')).toBe(false); // 不派生（无 spawn）
  });

  it('P-1：abort 时已失败（cdpProbe 断连置 failed）→ drain 后终态=error（failed 优先，demo L1946）', async () => {
    const fx = makeExecTransport({ probe: () => ({ ok: false, detail: '会话进程未连接' }) });
    // t1→c1（probe 失败→failed 置位）＋t1→h（断点挂起——run 不 drain 直到 abort 放行）
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [
        flowNode('t1', 'trigger.manual'),
        flowNode('c1', 'cdp.open', { url: 'https://a.example.com' }),
        flowNode('h', 'human.review', { name: '人工确认' }),
      ],
      edges: [edge('t1', 'c1'), edge('t1', 'h')],
    };
    const env = makeEnv({ f1: doc }, fx.transport);
    const handle = await env.engine.startRun('f1');
    await until(() => handle?.statuses.c1 === 'error'); // 失败已置位（h 仍 waiting 挂起）
    env.engine.abortRun(handle!.runId); // abort 瞬间 flags.failed=true——终态判定移交 drain 后
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toMatchObject({ c1: 'error', h: 'skipped' }); // 断点放行 ⊘＋失败节点 error 保留
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'error', failed: 1 }); // failed 优先于 aborted（P-1）
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.1i CDP 断连失败终止（02 §10 #10＋X-3）
// ————————————————————————————————————————————

describe('RunEngine §6.1i env:cdpProbe 断连分支', () => {
  it('probe 失败→cdp.* 节点 error＋run 失败终止（status=error）且不走 failBranch（下游不派生）', async () => {
    const fx = makeExecTransport({ probe: () => ({ ok: false, detail: '会话进程未连接' }) });
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('c1', 'cdp.open', { url: 'https://a.example.com' }), flowNode('x', 'data.transform')],
      edges: [edge('t1', 'c1'), edge('c1', 'x')],
    };
    const env = makeEnv({ f1: doc }, fx.transport);
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.probes.length).toBeGreaterThanOrEqual(1); // cdp.* 前置探活
    expect(handle?.statuses).toMatchObject({ c1: 'error' }); // cdp.* error
    expect(handle?.statuses.x).toBe('skipped'); // 失败终止：不走 failBranch、下游不派生（X-3）——收敛统一 ⊘
    const c1Finish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:c1');
    expect((c1Finish as { args: { status: string; error: string } }).args).toMatchObject({
      status: 'error',
      error: expect.stringContaining('CDP 环境未连接'),
    });
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'error', failed: 1 }); // run 失败终止（demo L1934-1935）
    const failLog = env.calls
      .filter((c) => c.op === 'logs.append')
      .map((c) => (c as { args: { msg: string; level: string } }).args)
      .find((a) => a.msg.includes('任务失败'));
    expect(failLog).toMatchObject({ level: 'err' });
  });

  it('probe ok → cdp.* 正常执行（探活不拦截健康路径）', async () => {
    const fx = makeExecTransport();
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('c1', 'cdp.open', { params: { url: 'https://a.example.com' } })],
      edges: [edge('t1', 'c1')],
    };
    const env = makeEnv({ f1: doc }, fx.transport);
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toMatchObject({ c1: 'done' });
    expect(fx.destroys).toEqual([{ runId: 'r1' }]); // 收尾序仍统一销毁
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.1j delay 真实计时且可中断（02 §10 #10）
// ————————————————————————————————————————————

describe('RunEngine §6.1j delay 真实计时可中断', () => {
  it('真实计时：delay ms 后完成并透传 input 给下游（墙钟推进）', async () => {
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('d', 'delay', { params: { ms: 180 } }), flowNode('x', 'data.transform')],
      edges: [edge('t1', 'd'), edge('d', 'x')],
    };
    const env = makeEnv({ f1: doc });
    const t0 = Date.now();
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(170); // 墙钟真实推进（非 mock 即完）
    expect(handle?.statuses).toEqual({ t1: 'done', d: 'done', x: 'done' }); // 计时完整走完透传下游
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'done' });
  });

  it('可中断：中途 abort → ⊘ 收敛不交付下游＋status=aborted', async () => {
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('d', 'delay', { params: { ms: 600 } }), flowNode('x', 'data.transform')],
      edges: [edge('t1', 'd'), edge('d', 'x')],
    };
    const env = makeEnv({ f1: doc });
    const handle = await env.engine.startRun('f1');
    await new Promise((r) => setTimeout(r, 120)); // 计时中段
    env.engine.abortRun(handle!.runId);
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toMatchObject({ d: 'skipped' }); // ⊘ 收敛（50ms 步进自觉退出）
    expect(handle?.statuses.x).toBe('skipped'); // 不交付下游——M-1：converge 兜底统一 ⊘ 落 statuses
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'aborted' });
  });
});
