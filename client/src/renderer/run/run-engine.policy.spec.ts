// PolicyRunner＋N6 策略套件（T4-04；TDD-C-03 §3 PolicyRunner 行＋§6.2；02 §8.6/§10＋X-3/X-4）。
// 断言面：
//   组件级：retries=2＋failBranch → 两轮 retry（指数退避 backoff×2^(n-1)）后第三次 onExit
//   返回 failBranch 具名出口；缺省 policy（null）→ 首败即 abort（retries 缺省 0/onFailure
//   缺省 abort）；retries=0 显式禁用 → 首败即 onFailure（X-4：0 是显式有效值）；backoffMs
//   缺省 → DEFAULT_BACKOFF_MS 基数；reset 清计数；
//   引擎级 §6.2a：retries=2 退避重跑恰 2 次（spawns 恰 3）后 failBranch 具名出口交付——
//   failed 支下游派生（lane 继承不变）、其余存活边死边级联 ⊘、节点 done＋output={branch}、
//   run=done 不失败、重试期间无下游交付（重跑不计 done 重复交付）＋退避真实等待（间隔
//   ≥backoff/backoff×2）；
//   引擎级 §6.2b：onFailure=abort（缺省）→ 重试耗尽后节点 error＋run status=error failed=1
//   ＋下游不派生；
//   引擎级 §6.2c：timeoutMs=0 → spawn 请求传 0（不武装看门狗）；policy 缺省 → 30s/0 透传；
//   引擎级 §6.2d：retries=0 首败即入失败处理（spawns 恰 1）；
//   环境级豁免（X-3 成文）：cdpProbe 失败属环境级——带 retries/failBranch policy 也不重试
//   不走 failBranch，直接节点 error＋run 失败终止；退避等待中被终止 → 不再重试（⊘ 收敛）。
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition, RunPolicy } from '@constella/shared/dsl';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import { DEFAULT_BACKOFF_MS, PolicyRunner } from './policy-runner';
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

function fakeRegistry(extra: readonly NodeDefinition[] = []): RunRegistryLike {
  const defs = [def('trigger.manual', []), def('data.transform', ['in']), def('cdp.open', ['in']), ...extra];
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

/**
 * fake 执行面：脚本可编程失败序列（failsLeft=按 nodeId 剩余失败次数——spawn 时若 >0 则
 * exit 1 并减一，否则 result＋exit 0）；spawn 时刻记录（退避间隔断言）。
 */
function makeExecTransport(over: { fails?: Record<string, number>; probe?: () => { ok: boolean; detail?: string } } = {}) {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: { nodeRunId: string; timeoutMs?: number; retries?: number; laneKey?: string; at: number }[] = [];
  const kills: { nodeRunId: string }[] = [];
  const probes: number[] = [];
  const failsLeft = new Map<string, number>(Object.entries(over.fails ?? {}).map(([k, v]) => [k, v]));
  const emit = (nodeRunId: string, ev: Omit<ScriptEvent, 'nodeRunId'>): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, ...ev });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push({ nodeRunId: req.nodeRunId, timeoutMs: req.timeoutMs, retries: req.retries, laneKey: req.laneKey, at: Date.now() });
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const left = failsLeft.get(nodeId) ?? 0;
      if (left > 0) {
        failsLeft.set(nodeId, left - 1);
        emit(req.nodeRunId, { kind: 'exit', code: 1 });
      } else {
        emit(req.nodeRunId, { kind: 'stdout', chunk: `${JSON.stringify({ type: 'result', out: { data: 'R' } })}\n` });
        emit(req.nodeRunId, { kind: 'exit', code: 0 });
      }
      return { ok: true, pid: 1 };
    },
    killScript: async (req) => {
      kills.push({ nodeRunId: req.nodeRunId });
      emit(req.nodeRunId, { kind: 'exit', code: 1 });
      return { ok: true };
    },
    cdpCreateSession: async () => ({ port: 9221, partition: 'persist:f1·main' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => {
      probes.push(1);
      return over.probe ? over.probe() : { ok: true };
    },
  };
  return { transport, spawns, kills, probes };
}

function makeEnv(docMap: Record<string, FlowDoc>, over: { transport?: RunTransport; defs?: readonly NodeDefinition[] } = {}) {
  const { calls, on, client } = makeStorage();
  let runSeq = 0;
  on('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  on('runs.create', () => ({ id: `r${++runSeq}` }));
  for (const op of ['runs.finish', 'runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append', 'hits.create', 'hits.resolve']) on(op, () => undefined);
  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(over.defs ?? []),
    guardDirty: () => false,
    ...(over.transport ? { transport: over.transport } : {}),
  });
  return { calls, engine };
}

function flowNode(id: string, type: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

function edge(from: string, to: string, port = 'out'): { id: string; from: [string, string]; to: [string, string] } {
  return { id: `${from}(${port})--${to}`, from: [from, port], to: [to, 'in'] };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ————————————————————————————————————————————
// PolicyRunner 组件级（§3：onExit → NextAction）
// ————————————————————————————————————————————

describe('PolicyRunner 组件级', () => {
  const runnerOf = (policy: RunPolicy | null) =>
    new PolicyRunner({ policyOf: () => policy });

  it('retries=2＋failBranch：两轮 retry（指数退避）后第三次 onExit 返回具名出口', () => {
    const p: RunPolicy = { retries: 2, backoffMs: 500, onFailure: { type: 'failBranch', exit: 'failed' } };
    const r = runnerOf(p);
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'retry', attempt: 1, waitMs: 500 }); // backoff×2^0
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'retry', attempt: 2, waitMs: 1000 }); // backoff×2^1
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'failBranch', exit: 'failed' }); // 重试耗尽 → onFailure
  });

  it('缺省 policy（null）→ 首败即 abort（retries 缺省 0/onFailure 缺省 abort，02 §8.6 设计值）', () => {
    const r = runnerOf(null);
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'abort' });
  });

  it('retries=0 显式禁用 → 首败即 onFailure（X-4：0 是显式有效值）', () => {
    const r = runnerOf({ retries: 0, onFailure: { type: 'failBranch', exit: 'halted' } });
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'failBranch', exit: 'halted' });
  });

  it('retries>0 但 onFailure 缺省 → 重试耗尽后 abort（缺省 abort）', () => {
    const r = runnerOf({ retries: 1, backoffMs: 10 });
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'retry', attempt: 1, waitMs: 10 });
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'abort' });
  });

  it('backoffMs 缺省 → DEFAULT_BACKOFF_MS 指数基数', () => {
    const r = runnerOf({ retries: 2 });
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'retry', attempt: 1, waitMs: DEFAULT_BACKOFF_MS });
    expect(r.onExit('x', 'boom')).toEqual({ kind: 'retry', attempt: 2, waitMs: DEFAULT_BACKOFF_MS * 2 });
  });

  it('计数按节点独立＋reset 清零', () => {
    const r = runnerOf({ retries: 1, backoffMs: 1 });
    expect(r.onExit('a', 'e')).toEqual({ kind: 'retry', attempt: 1, waitMs: 1 });
    expect(r.onExit('b', 'e')).toEqual({ kind: 'retry', attempt: 1, waitMs: 1 }); // b 独立计数
    expect(r.onExit('a', 'e')).toEqual({ kind: 'abort' });
    r.reset('a');
    expect(r.onExit('a', 'e')).toEqual({ kind: 'retry', attempt: 1, waitMs: 1 }); // reset 后重新计数
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.2a：retries=2 退避重跑恰 2 次后 failBranch 具名出口交付
// ————————————————————————————————————————————

describe('RunEngine §6.2a retries=2 退避重跑＋failBranch', () => {
  const FAILABLE = def('custom.x', ['in'], {
    ports: { ins: ['in'], outs: [{ id: 'out', label: '正常' }, { id: 'failed', label: '失败' }] },
    policy: { retries: 2, backoffMs: 60, onFailure: { type: 'failBranch', exit: 'failed' } },
  });

  async function runFailable(fails: number) {
    const fx = makeExecTransport({ fails: { x: fails } });
    // x→y（failed 支）＋x→z（out 支）：failBranch 后 y 派生、z 死边级联 ⊘（y/z 用 custom 类型才有 spawn 面）
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x'), flowNode('y', 'custom.y'), flowNode('z', 'custom.y')],
      edges: [edge('t1', 'x'), edge('x', 'y', 'failed'), edge('x', 'z', 'out')],
    };
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [FAILABLE, def('custom.y', ['in'])] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    return { fx, env, handle };
  }

  it('两败一成：重试 2 次内成功 → done 后 {data} 正常交付全存活出边（spawns 恰 3）', async () => {
    const { fx, handle } = await runFailable(2);
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:x')).toHaveLength(3); // 首跑＋2 重跑
    expect(handle?.statuses).toMatchObject({ x: 'done', y: 'done', z: 'done' }); // {data}→全存活出边（重试成功无 failBranch）
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:z')).toBe(true);
  });

  it('三跑全败：failBranch 具名出口交付——spawns 恰 3、failed 支下游派生、out 支级联 ⊘、node done＋output={branch}、run=done', async () => {
    const { fx, env, handle } = await runFailable(3);
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:x')).toHaveLength(3); // 恰 2 次重跑（retries=2）
    expect(handle?.statuses).toMatchObject({ x: 'done', y: 'done', z: 'skipped' }); // failBranch 交付＋死边级联
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:y')).toBe(true); // failed 支下游派生
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:z')).toBe(false); // out 支死亡不派生
    expect(fx.spawns.find((s) => s.nodeRunId === 'r1:y')?.laneKey).toBe('main'); // lane 数据不变（单存活边继承）
    const xFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:x') as {
      args: { status: string; output: unknown };
    };
    expect(xFinish.args).toMatchObject({ status: 'done', output: { branch: 'failed' } }); // B-13 真实 IO 落库
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'done', failed: 0 }); // run 不失败
    const retryLogs = env.calls
      .filter((c) => c.op === 'logs.append')
      .map((c) => (c as { args: { msg: string } }).args.msg)
      .filter((m) => m.includes('重试'));
    expect(retryLogs).toHaveLength(2); // 重试日志恰两条
  });

  it('退避真实等待：两次重试间隔 ≥ backoff 与 backoff×2（指数退避）', async () => {
    const { fx } = await runFailable(3);
    const spawns = fx.spawns.filter((s) => s.nodeRunId === 'r1:x');
    expect(spawns.length).toBe(3);
    const s1 = spawns[0]!;
    const s2 = spawns[1]!;
    const s3 = spawns[2]!;
    expect(s2.at - s1.at).toBeGreaterThanOrEqual(55); // backoffMs=60（容差）
    expect(s3.at - s2.at).toBeGreaterThanOrEqual(115); // 60×2
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.2b/d：onFailure=abort 与 retries=0
// ————————————————————————————————————————————

describe('RunEngine §6.2b/d onFailure=abort 与首败即处理', () => {
  it('§6.2b onFailure=abort（缺省）→ 重试耗尽后节点 error＋run status=error failed=1＋下游不派生', async () => {
    const fx = makeExecTransport({ fails: { x: 2 } });
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x'), flowNode('y', 'data.transform')],
      edges: [edge('t1', 'x'), edge('x', 'y')],
    };
    const env = makeEnv({ f1: doc }, {
      transport: fx.transport,
      defs: [def('custom.x', ['in'], { policy: { retries: 1, backoffMs: 10 } })], // onFailure 缺省 abort
    });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:x')).toHaveLength(2); // 首跑＋1 重跑
    expect(handle?.statuses).toMatchObject({ x: 'error', y: 'skipped' }); // abort 终止：节点 error＋下游 ⊘
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:y')).toBe(false);
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'error', failed: 1 });
  });

  it('§6.2d retries=0 首败即入失败处理（spawns 恰 1）——failBranch 出口直接交付', async () => {
    const fx = makeExecTransport({ fails: { x: 1 } });
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x'), flowNode('y', 'custom.y')],
      edges: [edge('t1', 'x'), edge('x', 'y', 'failed')],
    };
    const env = makeEnv({ f1: doc }, {
      transport: fx.transport,
      defs: [
        def('custom.y', ['in']),
        def('custom.x', ['in'], {
          ports: { ins: ['in'], outs: [{ id: 'out', label: '正常' }, { id: 'failed', label: '失败' }] },
          policy: { retries: 0, onFailure: { type: 'failBranch', exit: 'failed' } },
        }),
      ],
    });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:x')).toHaveLength(1); // 不重试
    expect(handle?.statuses).toMatchObject({ x: 'done', y: 'done' }); // failBranch 交付
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:y')).toBe(true);
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.2c：0 值与缺省透传（spawn 请求口径）
// ————————————————————————————————————————————

describe('RunEngine §6.2c timeoutMs 0 值与缺省', () => {
  it('timeoutMs=0 → spawn 请求传 0（不武装看门狗，X-4）', async () => {
    const fx = makeExecTransport();
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x')],
      edges: [edge('t1', 'x')],
    };
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [def('custom.x', ['in'], { policy: { timeoutMs: 0, retries: 0 } })] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.spawns[0]).toMatchObject({ timeoutMs: 0, retries: 0 });
  });

  it('policy 缺省（null）→ 30s/0 透传（缺省默认，02 §8.6）', async () => {
    const fx = makeExecTransport();
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x')],
      edges: [edge('t1', 'x')],
    };
    const env = makeEnv({ f1: doc }, { transport: fx.transport, defs: [def('custom.x', ['in'])] });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.spawns[0]).toMatchObject({ timeoutMs: 30000, retries: 0 });
  });
});

// ————————————————————————————————————————————
// 环境级故障豁免（X-3 成文）
// ————————————————————————————————————————————

describe('RunEngine 环境级故障豁免（X-3）', () => {
  it('cdpProbe 失败属环境级：带 retries/failBranch policy 也不重试不走 failBranch——直接 error＋run 失败终止', async () => {
    const fx = makeExecTransport({ probe: () => ({ ok: false, detail: '会话进程未连接' }) });
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('c1', 'cdp.open', { url: 'https://a.example.com' }), flowNode('y', 'data.transform')],
      edges: [edge('t1', 'c1'), edge('c1', 'y')],
    };
    const env = makeEnv({ f1: doc }, {
      transport: fx.transport,
      defs: [def('cdp.open', ['in'], {
        ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }, { id: 'failed', label: '失败' }] },
        policy: { retries: 3, backoffMs: 10, onFailure: { type: 'failBranch', exit: 'failed' } },
      })],
    });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.probes).toHaveLength(1); // 不重试（豁免：环境级失败不进 N6 重试编排）
    expect(handle?.statuses).toMatchObject({ c1: 'error', y: 'skipped' }); // 不走 failBranch：直接 error＋下游 ⊘
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'error', failed: 1 }); // run 失败终止（02 §10 #10）
  });

  it('退避等待中被终止 → 不再重试（⊘ 收敛，终止指令不走 failBranch）', async () => {
    // x 恒失败＋retries=2/backoffMs=500——首次失败进入退避后 abort
    const fx = makeExecTransport({ fails: { x: 99 } });
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('x', 'custom.x')],
      edges: [edge('t1', 'x')],
    };
    const env = makeEnv({ f1: doc }, {
      transport: fx.transport,
      defs: [def('custom.x', ['in'], {
        ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }, { id: 'failed', label: '失败' }] },
        policy: { retries: 2, backoffMs: 500, onFailure: { type: 'failBranch', exit: 'failed' } },
      })],
    });
    const handle = await env.engine.startRun('f1');
    await new Promise((r) => setTimeout(r, 80)); // 首败已入退避（500ms 窗口中段）
    env.engine.abortRun(handle!.runId);
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(fx.spawns.filter((s) => s.nodeRunId === 'r1:x')).toHaveLength(1); // 退避中被终止：不再重跑
    expect(handle?.statuses).toMatchObject({ x: 'skipped' }); // ⊘ 收敛（不走 failBranch）
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'aborted' });
  });
});
