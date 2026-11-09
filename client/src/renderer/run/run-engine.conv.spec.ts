// ConvergenceSweeper 套件（T4-03；TDD-C-03 §3 组件行；02 §10 #7；demo L1942-1945 行为源）。
// 断言面：
//   组件级：inflight 归零 sweep——非终态（未启动/running/waiting）统一 ⊘、done/error/skipped
//   不改写；终态映射 failed→error、aborted→aborted、否则 done（run=done 不失败）；
//   引擎级 §6.1g：A→B→A 环——环上节点收敛统一 ⊘、run.status=done 不失败、runs.finish
//   落 done＋任务完成日志；
//   收敛收尾序（移交项 #7）：drain/settle 后 runs Map/AbortCoordinator/RunLedger entry
//   统一清理（whenSettled 再查=undefined、ledger.get=undefined）；abort 路径同样清理；
//   部分交付汇合残局（got<need 无死边）由收敛统一 ⊘。
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { ConvergenceSweeper } from './convergence-sweeper';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import { RunLedger } from './run-ledger';
import type { NodeStatus, RunRegistryLike, RunTransport } from './types';

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
  const defs = [def('trigger.manual', []), def('trigger.cron', []), def('data.transform', ['in']), def('delay', ['in']), def('custom.x', ['in'])];
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

function makeExecTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const kills: { nodeRunId: string }[] = [];
  const destroys: { runId: string }[] = [];
  const behaviors = new Map<string, unknown[]>();
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const frames = behaviors.get(nodeId);
      if (frames) {
        for (const f of frames) {
          for (const fn of scriptSubs) fn({ nodeRunId: req.nodeRunId, kind: 'stdout', chunk: `${JSON.stringify(f)}\n` });
        }
      }
      for (const fn of scriptSubs) fn({ nodeRunId: req.nodeRunId, kind: 'exit', code: 0, ms: 5 });
      return { ok: true, pid: 1 };
    },
    killScript: async (req) => {
      kills.push({ nodeRunId: req.nodeRunId });
      return { ok: true };
    },
    cdpCreateSession: async () => ({ port: 9221, partition: 'persist:f1·main' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async (req) => {
      destroys.push({ runId: req.runId });
      return { ok: true };
    },
    envCdpProbe: async () => ({ ok: true }),
  };
  return { transport, kills, destroys, script: (nodeId: string, frames: unknown[]) => behaviors.set(nodeId, frames) };
}

function makeEnv(docMap: Record<string, FlowDoc>, transport?: RunTransport) {
  const { calls, on, client } = makeStorage();
  let runSeq = 0;
  for (const op of ['runs.finish', 'runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append']) on(op, () => undefined);
  on('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  on('runs.create', () => ({ id: `r${++runSeq}` }));
  const ledger = new RunLedger(1000);
  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(),
    guardDirty: () => false,
    ledger,
    ...(transport ? { transport } : {}),
  });
  return { calls, engine, ledger };
}

function flowNode(id: string, type: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

function edge(from: string, to: string): { id: string; from: [string, string]; to: [string, string] } {
  return { id: `${from}(out)--${to}`, from: [from, 'out'], to: [to, 'in'] };
}

/** 刷 microtask 队列（drain 后收尾序的 fire-and-forget 链落地） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ————————————————————————————————————————————
// ConvergenceSweeper 组件级（02 §10 #7）
// ————————————————————————————————————————————

describe('ConvergenceSweeper 组件级', () => {
  function makeSweeper(statuses: Record<string, string>, flags: { aborted: boolean; failed: boolean }) {
    const swept: string[] = [];
    const sweeper = new ConvergenceSweeper({
      nodeIds: Object.keys(statuses).length > 0 ? Object.keys(statuses) : ['a', 'b'],
      statusOf: (id) => statuses[id] as NodeStatus | undefined,
      skipNode: (id) => {
        statuses[id] = 'skipped';
        swept.push(id);
      },
      isAborted: () => flags.aborted,
      isFailed: () => flags.failed,
    });
    return { sweeper, swept, statuses };
  }

  it('非终态统一 ⊘：未启动/running/waiting → skipped；done/error/skipped 不改写', () => {
    const fx = makeSweeper({ a: 'done', b: 'error', c: 'skipped', d: undefined as unknown as string, e: 'running', f: 'waiting' }, { aborted: false, failed: false });
    const out = fx.sweeper.sweep();
    expect(fx.swept).toEqual(['d', 'e', 'f']);
    expect(fx.statuses).toEqual({ a: 'done', b: 'error', c: 'skipped', d: 'skipped', e: 'skipped', f: 'skipped' });
    expect(out.status).toBe('done');
    expect(out.swept).toEqual(['d', 'e', 'f']);
  });

  it('终态映射：failed → error（失败终止不因收敛翻 done）', () => {
    const fx = makeSweeper({ a: 'error' }, { aborted: true, failed: true });
    expect(fx.sweeper.sweep().status).toBe('error');
  });

  it('终态映射：aborted 且未失败 → aborted', () => {
    const fx = makeSweeper({ a: 'skipped' }, { aborted: true, failed: false });
    expect(fx.sweeper.sweep().status).toBe('aborted');
  });

  it('终态映射：正常收敛 → done（run=done 不失败，02 §10 #7）', () => {
    const fx = makeSweeper({ a: 'done' }, { aborted: false, failed: false });
    expect(fx.sweeper.sweep().status).toBe('done');
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.1g 环收敛（02 §10 #7）
// ————————————————————————————————————————————

describe('RunEngine §6.1g 环收敛统一 ⊘', () => {
  it('A→B→A 环：环上节点收敛统一 ⊘、run.status=done 不失败（runs.finish=done＋完成日志）', async () => {
    // t1→A 且 A→B→B→A 环：A 需 2 条入边（t1 与 B），t1 交付仅 1 条——B 永远等 A → 环残局
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('A', 'data.transform'), flowNode('B', 'data.transform')],
      edges: [edge('t1', 'A'), edge('A', 'B'), edge('B', 'A')],
    };
    const fx = makeExecTransport();
    const env = makeEnv({ f1: doc }, fx.transport);
    const events: { nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toEqual({ t1: 'done', A: 'skipped', B: 'skipped' }); // 环统一 ⊘
    expect(events).toContainEqual({ nodeId: 'A', status: 'skipped' });
    expect(events).toContainEqual({ nodeId: 'B', status: 'skipped' });
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ runId: 'r1', status: 'done', total: 3 }); // run=done 不失败
    const doneLog = env.calls
      .filter((c) => c.op === 'logs.append')
      .map((c) => (c as { args: { msg: string; level: string } }).args)
      .find((a) => a.msg.includes('任务完成'));
    expect(doneLog).toMatchObject({ level: 'ok' });
    expect(fx.destroys).toEqual([{ runId: 'r1' }]); // 收尾序统一销毁 lane 会话（恰一次）
  });

  it('部分交付残局（got<need 无死边）：环搁浅节点与其下游 stranding 由收敛统一 ⊘、run=done', async () => {
    // t1→u2 且 u2→u3→u2 环：u2 需 2 条入边（t1 与 u3），t1 仅交付 1 条——u2 搁浅，
    // 其下游 j（唯一入边来自 u2）无交付亦无死边 → 两者均由收敛 sweep 兜底 ⊘
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('u2', 'data.transform'), flowNode('u3', 'data.transform'), flowNode('j', 'data.transform')],
      edges: [edge('t1', 'u2'), edge('u2', 'u3'), edge('u3', 'u2'), edge('u2', 'j')],
    };
    const env = makeEnv({ f1: doc });
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(handle?.statuses).toEqual({ t1: 'done', u2: 'skipped', u3: 'skipped', j: 'skipped' }); // 搁浅＋下游 stranding 统一 ⊘
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'done' }); // 依赖缺失不失败（02 §10 #7）
  });
});

// ————————————————————————————————————————————
// 收敛收尾清理（移交项 #7：drain/settle 后统一清理策略）
// ————————————————————————————————————————————

describe('RunEngine 收敛收尾清理（移交项 #7）', () => {
  it('run 完成收敛后：runs Map/AbortCoordinator 注销＋ledger entry 清理（whenSettled 再查=undefined）', async () => {
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('a', 'data.transform')],
      edges: [edge('t1', 'a')],
    };
    const env = makeEnv({ f1: doc });
    const handle = await env.engine.startRun('f1');
    expect(env.ledger.get('r1')?.status).toBe('running'); // 运行期在账
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(env.ledger.get('r1')).toBeUndefined(); // 收尾后 entry 清理（历史走 DB 重放，任务中心消费）
    expect(env.engine.whenSettled('r1')).toBeUndefined(); // runs Map 同步清理
    expect(env.ledger.activeOf('f1')).toBeUndefined(); // 闸放开
    const again = await env.engine.startRun('f1'); // 清理后同流程可再跑
    expect(again?.runId).toBe('r2');
  });

  it('abort 路径同样清理：drain 后 runs/ledger 收口', async () => {
    const doc: FlowDoc = {
      id: 'f1',
      name: '流程f1',
      nodes: [flowNode('t1', 'trigger.manual'), flowNode('d', 'delay', { ms: 400 })],
      edges: [edge('t1', 'd')],
    };
    const env = makeEnv({ f1: doc });
    const handle = await env.engine.startRun('f1');
    await new Promise((r) => setTimeout(r, 60)); // d 进入计时
    env.engine.abortRun(handle!.runId);
    await env.engine.whenSettled(handle!.runId);
    await flush();
    expect(env.ledger.get('r1')).toBeUndefined();
    expect(env.engine.whenSettled('r1')).toBeUndefined();
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ status: 'aborted', aborted: 1 }); // d 计时中被终止＝aborted 计数 1（移交项 #6）
  });
});
