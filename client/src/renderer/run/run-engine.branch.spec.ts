// BranchFilter＋DeadEdgeCascader 套件（T4-03；TDD-C-03 §3 组件行；02 §10 #6 T-1 对称语义）。
// 断言面：
//   BranchFilter 组件级：expr 真实求值（input 字段作作用域）——truthy→'true' 支、falsy→'false'
//   支（对称：求值两侧皆可放行）；非布尔值按真值归约；input null → 空作用域；求值异常
//   （语法错/引用错）→ {ok:false}（调用方按节点 error 处理，非 branch-miss）；
//   DeadEdgeCascader 组件级：死边→下游 need-1 归零级联 ⊘（多级递归）；running/waiting/
//   done/error/skipped 节点不级联；部分交付（got>0）不跳；幂等（重复杀同边单次 ⊘）；
//   引擎级 §6.1f：求值 true→false 支整支级联 ⊘（含下游二级）、反向对称（求值 false→true
//   支级联 ⊘）——两侧对称断言（T-1）；⊘ 有事件＋warn 日志；未命中支不 spawn。
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowEdge, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BranchFilter, DeadEdgeCascader } from './branch-filter';
import { DeliveryRouter } from './delivery-router';
import { LaneManager } from './lane-manager';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine } from './run-engine';
import type { RunRegistryLike, RunTransport } from './types';

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

const MAIN = { key: 'main', label: '主支' } as const;

function edge(from: string, to: string, port = 'out'): FlowEdge {
  return { id: `${from}(${port})--${to}`, from: [from, port], to: [to, 'in'] };
}

function node(id: string): FlowNode {
  return { id, type: `t:${id}`, name: id, position: { x: 0, y: 0 }, params: {} };
}

/** cascader 测试台：router＋statusOf/skipNode 记录器（skipNode=cascader 落地回调位；outsMap=按节点出口集） */
function makeCascade(nodes: FlowNode[], edges: FlowEdge[], statuses: Record<string, string> = {}, outsMap: Record<string, string[]> = {}) {
  const defs = nodes.map(
    (n): NodeDefinition => ({
      type: `t:${n.id}`,
      kind: 'builtin',
      meta: { name: n.id, icon: 'x', category: '数据' },
      ports: { ins: ['in'], outs: (outsMap[n.id] ?? ['out']).map((id) => ({ id, label: id })) },
      paramsSchema: [],
      exec: null,
      version: '1.0.0',
      packageVersion: '1.0.0',
    }),
  );
  const registry: RunRegistryLike = { get: (t) => defs.find((d) => d.type === t), isBroken: () => false };
  const doc: FlowDoc = { id: 'f1', name: '流程', nodes, edges };
  const router = new DeliveryRouter({ doc, registry, lanes: new LaneManager({ runId: 'r1' }) });
  const skipped: string[] = [];
  const cascader = new DeadEdgeCascader({
    doc,
    router,
    statusOf: (id) => statuses[id] as 'running' | 'done' | 'error' | 'skipped' | 'waiting' | undefined,
    skipNode: (id) => {
      statuses[id] = 'skipped';
      skipped.push(id);
    },
  });
  return { router, cascader, skipped, statuses };
}

// ————————————————————————————————————————————
// BranchFilter 组件级（02 §10 #6 T-1 对称语义）
// ————————————————————————————————————————————

describe('BranchFilter 组件级', () => {
  const filter = new BranchFilter();

  it('expr 求值 truthy → true 支（input 字段作作用域）', () => {
    expect(filter.route('price < 199', { price: 129 })).toEqual({ ok: true, branch: 'true' });
  });

  it('expr 求值 falsy → false 支（对称放行，demo mock 恒 true 系原型产物不采信）', () => {
    expect(filter.route('price < 199', { price: 500 })).toEqual({ ok: true, branch: 'false' });
  });

  it('非布尔结果按真值归约：price=129 → true 支、price=0 → false 支', () => {
    expect(filter.route('price', { price: 129 })).toEqual({ ok: true, branch: 'true' });
    expect(filter.route('price', { price: 0 })).toEqual({ ok: true, branch: 'false' });
  });

  it('复合表达式与嵌套字段：item.price < item.max && ok', () => {
    expect(filter.route('item.price < item.max && ok', { item: { price: 1, max: 2 }, ok: true })).toEqual({ ok: true, branch: 'true' });
    expect(filter.route('item.price < item.max && ok', { item: { price: 3, max: 2 }, ok: true })).toEqual({ ok: true, branch: 'false' });
  });

  it('input null/undefined → 空作用域（字段未声明=引用错，自然 JS 语义报 eval-error 不臆测分支）', () => {
    const r = filter.route('price < 199', null);
    expect(r.ok).toBe(false); // with({}) 下 price 未声明 → ReferenceError（字段缺失显式失败，防数据形状错配静默走 false）
  });

  it('求值异常 → {ok:false}（语法错）——调用方按节点 error 处理', () => {
    const r = filter.route('price <', { price: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('expr');
  });

  it('求值异常 → {ok:false}（引用错：未定义标识符）', () => {
    const r = filter.route('nope.toFixed(2)', {});
    expect(r.ok).toBe(false);
  });
});

// ————————————————————————————————————————————
// DeadEdgeCascader 组件级（死边→need-1 归零级联 ⊘）
// ————————————————————————————————————————————

describe('DeadEdgeCascader 组件级', () => {
  it('死边→下游 need-1 归零即 ⊘ 并继续向下级联（多级递归）', () => {
    const fx = makeCascade([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    fx.cascader.killEdge(edge('a', 'b'));
    expect(fx.skipped).toEqual(['b', 'c']); // b 归零 ⊘ → 其出边 b→c 死 → c 归零 ⊘
    expect(fx.router.needOf('c')).toBe(0);
  });

  it('未归零不跳：2 入边杀 1 → need=1 保持等待（不 ⊘）', () => {
    const fx = makeCascade([node('a'), node('a2'), node('j')], [edge('a', 'j'), edge('a2', 'j')]);
    fx.cascader.killEdge(edge('a', 'j'));
    expect(fx.skipped).toEqual([]);
    expect(fx.router.needOf('j')).toBe(1);
  });

  it('部分交付（got>0）不级联跳过——留给收敛统一 ⊘', () => {
    const fx = makeCascade([node('u1'), node('u2'), node('j')], [edge('u1', 'j'), edge('u2', 'j')]);
    fx.router.deliverData('u1', 'X', MAIN); // got[j]=1、need=2
    fx.cascader.killEdge(edge('u2', 'j')); // need=1、got=1 → 不跳（无新交付触发就绪）
    expect(fx.skipped).toEqual([]);
    expect(fx.router.needOf('j')).toBe(1);
    expect(fx.router.gotOf('j')).toBe(1);
  });

  it('running/waiting/done/error/skipped 节点不级联改写（终态与在途保护）', () => {
    for (const st of ['running', 'waiting', 'done', 'error', 'skipped'] as const) {
      const fx = makeCascade([node('a'), node('b')], [edge('a', 'b')], { b: st });
      fx.cascader.killEdge(edge('a', 'b'));
      expect(fx.skipped).toEqual([]);
      expect(fx.statuses.b).toBe(st);
    }
  });

  it('幂等：重复杀同边只 ⊘ 一次', () => {
    const fx = makeCascade([node('a'), node('b')], [edge('a', 'b')]);
    fx.cascader.killEdge(edge('a', 'b'));
    fx.cascader.killEdge(edge('a', 'b'));
    expect(fx.skipped).toEqual(['b']);
    expect(fx.router.needOf('b')).toBe(0);
  });

  it('已由 router 记账的死边（deliverBranch 内部杀）再经 killEdge 仍触发下游级联', () => {
    const fx = makeCascade([node('b'), node('c1'), node('c2')], [edge('b', 'c1', 'true'), edge('b', 'c2', 'false')], {}, { b: ['true', 'false'] });
    const plan = fx.router.deliverBranch('b', 'true', null, MAIN); // router 内部已杀 false 边（need-1）
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(fx.skipped).toEqual([]); // router 只记账不级联
    for (const e of plan.dead) fx.cascader.killEdge(e); // 循环接线位：dead 边经 cascader 走级联
    expect(fx.skipped).toEqual(['c2']); // c2 need 1→0 → ⊘
  });

  it('killEdgesOf：节点全部出边死亡并级联（静态不可达预杀，深度优先序），返回新杀边', () => {
    const fx = makeCascade([node('a'), node('b1'), node('b2'), node('d')], [edge('a', 'b1'), edge('a', 'b2'), edge('b1', 'd')]);
    const killed = fx.cascader.killEdgesOf('a');
    expect(killed.map((e) => e.id)).toEqual(['a(out)--b1', 'a(out)--b2']);
    expect(fx.skipped).toEqual(['b1', 'd', 'b2']); // b1 ⊘ → 其出边 d 深度优先级联 ⊘ → b2（demo 逐边 resolveDown 同序）
  });
});

// ————————————————————————————————————————————
// 引擎级 §6.1f（02 §10 #6：branch 求值两侧对称级联）
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

const BRANCH_DEF = def('logic.branch', ['in'], {
  ports: { ins: ['in'], outs: [{ id: 'true', label: '是' }, { id: 'false', label: '否' }] },
});

function fakeRegistry(): RunRegistryLike {
  const defs = [
    def('trigger.manual', []),
    def('data.transform', ['in']),
    def('delay', ['in']),
    def('human.review', ['in']),
    def('custom.x', ['in']),
    BRANCH_DEF,
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

/** 执行面 fake：脚本按 nodeId 编程回放帧＋kill/destroy/probe 记录 */
function makeExecTransport(over: { probeOk?: boolean } = {}) {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: { nodeRunId: string; input: unknown }[] = [];
  const kills: { nodeRunId: string }[] = [];
  const destroys: { runId: string }[] = [];
  const probes: number[] = [];
  const behaviors = new Map<string, unknown[]>();
  const push = (nodeRunId: string, frame: unknown): void => {
    const chunk = `${JSON.stringify(frame)}\n`;
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'stdout', chunk });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push({ nodeRunId: req.nodeRunId, input: req.input });
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const frames = behaviors.get(nodeId);
      if (frames) {
        for (const f of frames) push(req.nodeRunId, f);
        for (const fn of scriptSubs) fn({ nodeRunId: req.nodeRunId, kind: 'exit', code: 0, ms: 5 });
      }
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
    envCdpProbe: async () => {
      probes.push(1);
      return { ok: over.probeOk ?? true };
    },
  };
  return { transport, spawns, kills, destroys, probes, script: (nodeId: string, frames: unknown[]) => behaviors.set(nodeId, frames) };
}

function makeEnv(doc: FlowDoc, transport: RunTransport) {
  const { calls, on, client } = makeStorage();
  let runSeq = 0;
  on('flows.get', () => doc);
  on('runs.create', () => ({ id: `r${++runSeq}` }));
  on('runs.finish', () => undefined);
  on('runs.nodeRunStart', () => undefined);
  on('runs.nodeRunFinish', () => undefined);
  on('logs.append', () => undefined);
  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(),
    guardDirty: () => false,
    transport,
  });
  return { calls, engine };
}

function flowNode(id: string, type: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

/** t1→a(产出 price)→b(branch)→true:c1→d1 / false:c2→d2 */
function branchFlow(expr: string): FlowDoc {
  return {
    id: 'f1',
    name: '流程f1',
    nodes: [
      flowNode('t1', 'trigger.manual'),
      flowNode('a', 'custom.x'),
      flowNode('b', 'logic.branch', { expr }),
      flowNode('c1', 'custom.x'),
      flowNode('c2', 'custom.x'),
      flowNode('d1', 'custom.x'),
      flowNode('d2', 'custom.x'),
    ],
    edges: [
      { id: 't1(out)--a', from: ['t1', 'out'], to: ['a', 'in'] },
      { id: 'a(out)--b', from: ['a', 'out'], to: ['b', 'in'] },
      { id: 'b(true)--c1', from: ['b', 'true'], to: ['c1', 'in'] },
      { id: 'b(false)--c2', from: ['b', 'false'], to: ['c2', 'in'] },
      { id: 'c1(out)--d1', from: ['c1', 'out'], to: ['d1', 'in'] },
      { id: 'c2(out)--d2', from: ['c2', 'out'], to: ['d2', 'in'] },
    ],
  };
}

describe('RunEngine §6.1f branch 求值两侧对称级联（T-1）', () => {
  it('expr 求值 true：false 边及下游整支级联 ⊘（徽标语义=statuses+事件＋warn 日志）、true 支执行', async () => {
    const fx = makeExecTransport();
    fx.script('a', [{ type: 'result', out: { data: { price: 129 } } }]);
    fx.script('c1', [{ type: 'result', out: { data: null } }]);
    fx.script('d1', [{ type: 'result', out: { data: null } }]);
    const env = makeEnv(branchFlow('price < 199'), fx.transport);
    const events: { nodeId: string; status: string }[] = [];
    env.engine.onNodeStatus((e) => events.push({ nodeId: e.nodeId, status: e.status }));
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ t1: 'done', a: 'done', b: 'done', c1: 'done', d1: 'done' });
    expect(handle?.statuses).toMatchObject({ c2: 'skipped', d2: 'skipped' }); // 未命中支整支 ⊘
    expect(fx.spawns.map((s) => s.nodeRunId)).toEqual(['r1:a', 'r1:c1', 'r1:d1']); // b=内置求值不 spawn；c2/d2 不执行
    expect(events).toContainEqual({ nodeId: 'c2', status: 'skipped' });
    expect(events).toContainEqual({ nodeId: 'd2', status: 'skipped' });
    const logs = env.calls.filter((c) => c.op === 'logs.append').map((c) => (c as { args: { msg: string; level: string } }).args);
    expect(logs.some((l) => l.msg.includes('分支跳过：c2'))).toBe(true); // 命中路由即时死边日志
    expect(logs.some((l) => l.level === 'warn' && l.msg.includes('c2'))).toBe(true); // 级联 ⊘ warn（demo L1840 语义）
  });

  it('反向对称：expr 求值 false → false 支放行、true 支整支级联 ⊘（demo 恒 true 不采信）', async () => {
    const fx = makeExecTransport();
    fx.script('a', [{ type: 'result', out: { data: { price: 500 } } }]);
    fx.script('c2', [{ type: 'result', out: { data: null } }]);
    fx.script('d2', [{ type: 'result', out: { data: null } }]);
    const env = makeEnv(branchFlow('price < 199'), fx.transport);
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ b: 'done', c2: 'done', d2: 'done' });
    expect(handle?.statuses).toMatchObject({ c1: 'skipped', d1: 'skipped' }); // 对称：true 支整支 ⊘
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:c1')).toBe(false);
    expect(fx.spawns.some((s) => s.nodeRunId === 'r1:d1')).toBe(false);
  });

  it('expr 求值异常 → 节点 error＋run 失败停派生（两侧均不交付）', async () => {
    const fx = makeExecTransport();
    fx.script('a', [{ type: 'result', out: { data: { price: 129 } } }]);
    const env = makeEnv(branchFlow('price <'), fx.transport); // 语法错
    const handle = await env.engine.startRun('f1');
    await env.engine.whenSettled(handle!.runId);
    expect(handle?.statuses).toMatchObject({ b: 'error' });
    expect(handle?.statuses.c1).toBe('skipped'); // 失败停派生：两侧均不交付、收敛统一 ⊘
    expect(handle?.statuses.c2).toBe('skipped');
    const bFinish = env.calls.find((c) => c.op === 'runs.nodeRunFinish' && (c as { args: { nodeRunId: string } }).args.nodeRunId === 'r1:b');
    expect((bFinish as { args: { status: string; error: string } }).args).toMatchObject({ status: 'error', error: expect.stringContaining('expr') });
  });
});
