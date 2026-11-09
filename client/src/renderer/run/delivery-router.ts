// DeliveryRouter＋JoinTracker —— 完成交付与汇合计数（TDD-C-03 §3 组件行；02 §10 #3/#5＋§14；
// demo L1822-1852 行为源；T4-02）。
//   {data}     → 向全部「存活」出边交付（#3）——出边多于一条即扇出，每支新 lane
//                （key=支首节点 id、label=支首节点名，demo L1850）；单存活边继承执行 lane；
//   {branch,meta} → 只发 id===branch 的出边（from 端口===branch），其余存活边死亡（need-1）；
//                下游 input=meta 载荷（NodeOut 去 branch 键）；branch 未命中 N2 outs →
//                branch-miss（调用方按节点 error 处理，02 §14 防拼写错路由）；
//   JoinTracker need/got（demo L1822-1826）：need=入边数、死边 need-1；got===need 且
//   need>0 时节点就绪（汇合=集齐所有存活入边——3 入边 1 死收 2 即执行不等死边，#5；
//   就绪 lane/input=最后到达支，02 §14「汇合=最后到达支」）。
// 死边→下游归零级联 ⊘（skipNode 递归）＝T4-03 DeadEdgeCascader，本组件只做 need-1 记账。
import type { FlowDoc, FlowEdge } from '@constella/shared/ipc';
import type { NodeOut } from '@constella/shared/dsl';
import type { Lane, RunRegistryLike } from './types';
import type { LaneManager } from './lane-manager';

/** 就绪派生目标（got===need 触发；lane=扇出新支或继承/最后到达支） */
export interface DeliveryTarget {
  nodeId: string;
  input: unknown;
  lane: Lane;
}

/** 交付结果：ok=false 仅 branch-miss 一种（02 §14 节点 error 语义） */
export type DeliveryPlan =
  | { ok: true; targets: DeliveryTarget[]; dead: FlowEdge[] }
  | { ok: false; reason: 'branch-miss'; branch: string; outs: readonly string[] };

export interface DeliveryRouterDeps {
  doc: FlowDoc;
  registry: RunRegistryLike;
  /** lane 台账（本组件只构造扇出 lane 值；落表在派生时 assign） */
  lanes: LaneManager;
}

export class DeliveryRouter {
  private readonly need = new Map<string, number>();
  private readonly got = new Map<string, number>();
  private readonly deadEdges = new Set<string>();

  constructor(private readonly deps: DeliveryRouterDeps) {
    for (const n of deps.doc.nodes) {
      this.need.set(n.id, 0);
      this.got.set(n.id, 0);
    }
    for (const e of deps.doc.edges) {
      this.need.set(e.to[0], (this.need.get(e.to[0]) ?? 0) + 1);
    }
  }

  /** 汇合需求（初始=入边数；死边递减） */
  needOf(nodeId: string): number {
    return this.need.get(nodeId) ?? 0;
  }

  /** 已收交付数 */
  gotOf(nodeId: string): number {
    return this.got.get(nodeId) ?? 0;
  }

  isEdgeDead(edgeId: string): boolean {
    return this.deadEdges.has(edgeId);
  }

  /**
   * 死边：收件人需求-1（幂等）。归零级联 ⊘ 归 T4-03 DeadEdgeCascader——本方法只记账。
   */
  killEdge(e: FlowEdge): void {
    if (this.deadEdges.has(e.id)) return;
    this.deadEdges.add(e.id);
    this.need.set(e.to[0], Math.max(0, this.needOf(e.to[0]) - 1));
  }

  /** 节点全部出边死亡（静态不可达 ⊘ 出边预杀，demo L1937）——返回被杀边（日志用） */
  killEdgesOf(nodeId: string): FlowEdge[] {
    const killed = this.outEdges(nodeId).filter((e) => !this.deadEdges.has(e.id));
    for (const e of killed) this.killEdge(e);
    return killed;
  }

  /** {data}：向全部存活出边发 data（02 §14 单语义交付） */
  deliverData(fromId: string, data: unknown, lane: Lane): { targets: DeliveryTarget[]; dead: FlowEdge[] } {
    const live = this.outEdges(fromId).filter((e) => !this.deadEdges.has(e.id));
    return { targets: this.dispatchTo(live, data, lane), dead: [] };
  }

  /** {branch}/emit：只发 id===branch 出边，其余存活边死亡；input=meta 载荷（emit=payload） */
  deliverBranch(fromId: string, branch: string, input: unknown, lane: Lane): DeliveryPlan {
    const def = this.defOf(fromId);
    const outs = (def?.ports.outs ?? []).map((o) => o.id);
    if (!outs.includes(branch)) {
      return { ok: false, reason: 'branch-miss', branch, outs };
    }
    const all = this.outEdges(fromId);
    const dead: FlowEdge[] = [];
    for (const e of all) {
      if (e.from[1] !== branch && !this.deadEdges.has(e.id)) {
        this.killEdge(e);
        dead.push(e);
      }
    }
    const hit = all.filter((e) => e.from[1] === branch && !this.deadEdges.has(e.id));
    return { ok: true, targets: this.dispatchTo(hit, input, lane), dead };
  }

  /** NodeOut 统一入口：{branch,meta} → meta（去 branch 键）随命中边行；{data} → 全存活边 */
  deliver(fromId: string, out: NodeOut, lane: Lane): DeliveryPlan {
    if ('branch' in out) {
      const { branch, ...meta } = out;
      return this.deliverBranch(fromId, branch, meta, lane);
    }
    const r = this.deliverData(fromId, out.data, lane);
    return { ok: true, targets: r.targets, dead: r.dead };
  }

  /** got++ 并检就绪：多支交付=扇出每支新 lane（支首节点）；单支=继承（demo L1850） */
  private dispatchTo(edges: readonly FlowEdge[], input: unknown, inherit: Lane): DeliveryTarget[] {
    const fanout = edges.length > 1;
    const targets: DeliveryTarget[] = [];
    for (const e of edges) {
      const w = e.to[0];
      this.got.set(w, this.gotOf(w) + 1);
      if (this.gotOf(w) === this.needOf(w) && this.needOf(w) > 0) {
        targets.push({ nodeId: w, input, lane: fanout ? { key: w, label: this.nodeName(w) } : inherit });
      }
    }
    return targets;
  }

  private outEdges(nodeId: string): FlowEdge[] {
    return this.deps.doc.edges.filter((e) => e.from[0] === nodeId);
  }

  private nodeName(nodeId: string): string {
    return this.deps.doc.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  }

  private defOf(nodeId: string) {
    const n = this.deps.doc.nodes.find((x) => x.id === nodeId);
    return n === undefined ? undefined : this.deps.registry.get(n.type);
  }
}
