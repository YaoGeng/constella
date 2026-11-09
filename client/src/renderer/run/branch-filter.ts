// BranchFilter＋DeadEdgeCascader —— branch 真实求值＋死边级联 ⊘（TDD-C-03 §3 组件行；
// 02 §10 #6 T-1 对称语义＝真实求值、命中边放行、未命中边死亡并向下级联；01 §6-06/PRD；
// demo L1831-1844 级联机制、L1920-1927 skipped 徽标语义（demo 恒走 true 系 mock 未求值
// 产物，不采信）；T4-03）。
//   BranchFilter：logic.branch 的 expr 以 input 字段为作用域真实求值——truthy→'true' 支、
//   falsy→'false' 支（对称：两侧皆可放行）；求值异常（语法错/引用错）→ {ok:false}，
//   调用方按节点 error 处理（非 branch-miss——那是出口 id 校验，02 §14 归 DeliveryRouter）。
//   DeadEdgeCascader：死边→收件人需求-1（demo resolveDown）→ 归零且未在途 → 节点 ⊘
//   （skipNode 落地回调）→ 其出边全部死亡继续向下级联（demo skipNode 递归）。
//   在途保护：running/waiting/done/error/skipped 不级联改写（终态单调、在途归收敛）；
//   部分交付（got>0）不跳——留给 ConvergenceSweeper 统一 ⊘（demo 同款残局语义）。
import type { FlowDoc, FlowEdge } from '@constella/shared/ipc';
import type { NodeStatus } from './types';
import type { DeliveryRouter } from './delivery-router';

/** expr 求值结果：命中支 id（'true'/'false'）；求值异常=节点 error（非 branch-miss） */
export type BranchRoute = { ok: true; branch: string } | { ok: false; message: string };

/** expr 求值（input 字段作作用域；Function 体=非严格模式以支持 with 作用域透传） */
function evaluateExpr(expr: string, input: unknown): unknown {
  const fn = new Function('input', `with (input == null ? {} : input) { return (${expr}); }`);
  return fn(input);
}

export class BranchFilter {
  /**
   * T-1 对称语义求值：truthy → 'true' 支、falsy → 'false' 支（命中支由 DeliveryRouter
   * 按 N2 outs 校验后放行，未命中支死亡级联——两侧对称）。expr 非法 → {ok:false}。
   */
  route(expr: string, input: unknown): BranchRoute {
    let value: unknown;
    try {
      value = evaluateExpr(expr, input);
    } catch (e) {
      return { ok: false, message: `expr 求值失败（${expr}）：${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, branch: value ? 'true' : 'false' };
  }
}

export interface DeadEdgeCascaderDeps {
  doc: FlowDoc;
  router: DeliveryRouter;
  /** 节点当前态（undefined=未启动）；终态与在途不级联改写 */
  statusOf(nodeId: string): NodeStatus | undefined;
  /** 节点 ⊘ 落地回调（statuses＋事件＋warn 日志——从未启动故无 nodeRunStart/Finish） */
  skipNode(nodeId: string): void;
}

export class DeadEdgeCascader {
  constructor(private readonly deps: DeadEdgeCascaderDeps) {}

  /**
   * 死边（幂等）：need-1 记账归 DeliveryRouter；归零且收件人未在途 → ⊘ 并对其出边
   * 递归级联。已死边重复调用仍重检收件人（router 内部记账〔deliverBranch 预杀〕后的
   * 循环接线位以本方法统一走级联）。
   */
  killEdge(e: FlowEdge): void {
    if (!this.deps.router.isEdgeDead(e.id)) this.deps.router.killEdge(e);
    this.settleRecipient(e.to[0]);
  }

  /** 节点全部出边死亡（静态不可达预杀，demo L1937）——返回新杀边（日志用） */
  killEdgesOf(nodeId: string): FlowEdge[] {
    const killed = this.deps.doc.edges.filter((e) => e.from[0] === nodeId && !this.deps.router.isEdgeDead(e.id));
    for (const e of this.deps.doc.edges.filter((e) => e.from[0] === nodeId)) this.killEdge(e);
    return killed;
  }

  /** 收件人结算：需求归零且无部分交付且未在途/未终态 → ⊘＋出边递归（demo resolveDown） */
  private settleRecipient(nodeId: string): void {
    const st = this.deps.statusOf(nodeId);
    if (st !== undefined) return; // running/waiting/done/error/skipped——在途与终态保护
    if (this.deps.router.needOf(nodeId) > 0 || this.deps.router.gotOf(nodeId) > 0) return;
    this.deps.skipNode(nodeId);
    for (const e of this.deps.doc.edges.filter((x) => x.from[0] === nodeId)) this.killEdge(e);
  }
}
