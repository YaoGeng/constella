// DeliveryRouter＋JoinTracker 组件套件（T4-02；TDD-C-03 §3 组件行；02 §10 #3/#5＋§14 NodeOut）。
// 断言面：
//   need/got 汇合计数（demo L1822-1826）：need=入边数初始化、got=0；
//   {data} → 全部存活出边（#3）：2 出边 2 targets、got 递增、扇出每支新 lane（key=支首节点 id、
//   label=支首节点名）、单存活边继承执行 lane；
//   汇合（#5）：need=3 前 2 次交付无 target、第 3 次收齐才返回 target（lane=最后到达支）；
//   死边：killEdge → 收件人 need-1（3 入边 1 死 → 收 2 即就绪）；killEdgesOf=节点出边全死；
//   {branch,meta}（02 §14）：只发 id===branch 出边（下游 input=meta 去 branch 键）、其余存活边
//   死亡计入 dead；branch 未命中 N2 outs → {ok:false,reason:'branch-miss'}＋outs 清单；
//   命中端口但该端口无边 → ok 且 targets 空、其余边仍死亡。
// 归零级联 ⊘（死边→下游跳过递归）＝T4-03 DeadEdgeCascader，不在本套件。
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowEdge, FlowNode } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { DeliveryRouter } from './delivery-router';
import { LaneManager } from './lane-manager';
import type { Lane, RunRegistryLike } from './types';

function def(type: string, ins: string[], outs: string[] = ['out']): NodeDefinition {
  return {
    type,
    kind: 'builtin',
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins, outs: outs.map((id) => ({ id, label: id })) },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

function registryOf(defs: readonly NodeDefinition[]): RunRegistryLike {
  return { get: (type) => defs.find((d) => d.type === type), isBroken: () => false };
}

function node(id: string, name = id): FlowNode {
  return { id, type: `t:${id}`, name, position: { x: 0, y: 0 }, params: {} };
}

function edge(from: string, to: string, port = 'out'): FlowEdge {
  return { id: `${from}(${port})--${to}`, from: [from, port], to: [to, 'in'] };
}

/** 构造 router（doc 节点 type=t:<id>，定义按 outsMap 注册出口集） */
function makeRouter(nodes: FlowNode[], edges: FlowEdge[], outsMap: Record<string, string[]> = {}) {
  const defs = nodes.map((n) => def(`t:${n.id}`, ['in'], outsMap[n.id] ?? ['out']));
  const doc: FlowDoc = { id: 'f1', name: '流程', nodes, edges };
  const lanes = new LaneManager({ runId: 'r1' });
  return { router: new DeliveryRouter({ doc, registry: registryOf(defs), lanes }), doc };
}

const MAIN: Lane = { key: 'main', label: '主支' };

describe('DeliveryRouter＋JoinTracker 组件级', () => {
  it('need/got 初始化：need=入边数（触发节点 0）、got=0', () => {
    const { router } = makeRouter([node('t'), node('a')], [edge('t', 'a')]);
    expect(router.needOf('t')).toBe(0);
    expect(router.needOf('a')).toBe(1);
    expect(router.gotOf('a')).toBe(0);
  });

  it('{data} → 全部存活出边：2 出边 2 targets＋got 递增；扇出每支新 lane=支首节点（key=id/label=节点名）', () => {
    const { router } = makeRouter([node('a'), node('b1', '北京人社局'), node('b2', '上海人社局')], [edge('a', 'b1'), edge('a', 'b2')]);
    const r = router.deliverData('a', 'X', MAIN);
    expect(r.targets).toEqual([
      { nodeId: 'b1', input: 'X', lane: { key: 'b1', label: '北京人社局' } },
      { nodeId: 'b2', input: 'X', lane: { key: 'b2', label: '上海人社局' } },
    ]);
    expect(router.gotOf('b1')).toBe(1);
    expect(router.gotOf('b2')).toBe(1);
  });

  it('{data} 单存活出边 → 继承执行节点 lane（非扇出不换 lane）', () => {
    const { router } = makeRouter([node('a'), node('b')], [edge('a', 'b')]);
    const r = router.deliverData('a', 'X', MAIN);
    expect(r.targets).toEqual([{ nodeId: 'b', input: 'X', lane: MAIN }]);
  });

  it('死出边不交付：killEdge 后仅存活边获数据', () => {
    const { router } = makeRouter([node('a'), node('b1'), node('b2')], [edge('a', 'b1'), edge('a', 'b2')]);
    router.killEdge(edge('a', 'b1'));
    const r = router.deliverData('a', 'X', MAIN);
    expect(r.targets.map((t) => t.nodeId)).toEqual(['b2']);
  });

  it('汇合：need=3 前 2 次交付无 target、第 3 次收齐才返回（lane=最后到达支）', () => {
    const { router } = makeRouter(
      [node('j', '汇合点'), node('u1'), node('u2'), node('u3')],
      [edge('u1', 'j'), edge('u2', 'j'), edge('u3', 'j')],
    );
    expect(router.deliverData('u1', 1, MAIN).targets).toEqual([]);
    const laneU2: Lane = { key: 'u2', label: '支二' };
    expect(router.deliverData('u2', 2, laneU2).targets).toEqual([]);
    const laneU3: Lane = { key: 'u3', label: '支三' };
    expect(router.deliverData('u3', 3, laneU3).targets).toEqual([{ nodeId: 'j', input: 3, lane: laneU3 }]);
  });

  it('3 入边 1 死：killEdge 后 need=2，收 2 即就绪不等死边（02 §10 #5）', () => {
    const { router } = makeRouter(
      [node('j'), node('u1'), node('u2'), node('u3')],
      [edge('u1', 'j'), edge('u2', 'j'), edge('u3', 'j')],
    );
    router.killEdge(edge('u3', 'j'));
    expect(router.needOf('j')).toBe(2);
    expect(router.deliverData('u1', 1, MAIN).targets).toEqual([]);
    expect(router.deliverData('u2', 2, MAIN).targets).toEqual([{ nodeId: 'j', input: 2, lane: MAIN }]);
  });

  it('killEdge 幂等：重复杀同一边 need 不重复减', () => {
    const { router } = makeRouter([node('a'), node('b')], [edge('a', 'b')]);
    router.killEdge(edge('a', 'b'));
    router.killEdge(edge('a', 'b'));
    expect(router.needOf('b')).toBe(0);
  });

  it('killEdgesOf：节点全部出边死亡（静态不可达 ⊘ 预杀），返回被杀边', () => {
    const { router } = makeRouter([node('a'), node('b1'), node('b2')], [edge('a', 'b1'), edge('a', 'b2')]);
    const killed = router.killEdgesOf('a');
    expect(killed.map((e) => e.id)).toEqual(['a(out)--b1', 'a(out)--b2']);
    expect(router.needOf('b1')).toBe(0);
    expect(router.isEdgeDead('a(out)--b1')).toBe(true);
  });

  it('{branch,meta} → 只发 id===branch 出边（input=meta 去 branch 键），其余存活边死亡计入 dead', () => {
    const { router } = makeRouter(
      [node('b', '判向'), node('yes', '真支'), node('no', '假支')],
      [edge('b', 'yes', 'true'), edge('b', 'no', 'false')],
      { b: ['true', 'false'] },
    );
    const r = router.deliverBranch('b', 'true', { score: 0.9 }, MAIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targets).toEqual([{ nodeId: 'yes', input: { score: 0.9 }, lane: MAIN }]);
    expect(r.dead.map((e) => e.id)).toEqual(['b(false)--no']);
    expect(router.needOf('no')).toBe(0); // 死边 → 下游需求-1
  });

  it('deliver 统一入口：{branch,meta} 帧 meta 原样随行（其余键即 meta）', () => {
    const { router } = makeRouter([node('b'), node('esc', '升级')], [edge('b', 'esc', 'escalated')], { b: ['escalated', 'replied'] });
    const r = router.deliver('b', { branch: 'escalated', reason: '无法应答', sessionId: 7 }, MAIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targets).toEqual([{ nodeId: 'esc', input: { reason: '无法应答', sessionId: 7 }, lane: MAIN }]);
  });

  it('branch 未命中 N2 outs → {ok:false, reason:"branch-miss"}＋outs 清单（02 §14 防拼写错路由）', () => {
    const { router } = makeRouter([node('b'), node('yes')], [edge('b', 'yes', 'true')], { b: ['true', 'false'] });
    const r = router.deliverBranch('b', 'ture', null, MAIN); // 拼写错
    expect(r).toEqual({ ok: false, reason: 'branch-miss', branch: 'ture', outs: ['true', 'false'] });
  });

  it('branch 命中端口但该端口无边 → ok、targets 空、其余存活边仍死亡', () => {
    const { router } = makeRouter([node('b'), node('no')], [edge('b', 'no', 'false')], { b: ['true', 'false'] });
    const r = router.deliverBranch('b', 'true', 'X', MAIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targets).toEqual([]);
    expect(r.dead.map((e) => e.id)).toEqual(['b(false)--no']);
  });
});
