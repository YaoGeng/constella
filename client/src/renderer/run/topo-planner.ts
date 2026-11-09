// TopoPlanner —— 触发器 BFS 可达序＋不可达预标 ⊘（TDD-C-03 §3 组件行；02 §10 #2；T4-01）。
// plan(doc): {order,skips}——order=从全部触发节点（ins=[]）出发的 BFS 可达序（demo L1797-1799
// 同构：按 nodes 序取触发器、按 edges 序扫描出边）；skips=不可达节点（启动即 ⊘、计入
// run.skips 与启动日志）；total=可达数（=order.length，进度分母，02 §7.1 runs.total）。
// 多触发节点混布=全部触发节点入队（05 P4 区头 b 项默认口径，待评审）。
import type { FlowDoc, FlowNode } from '@constella/shared/ipc';
import type { RunRegistryLike } from './types';

/** §3 组件级返回形；total=可达数 */
export interface TopoPlan {
  order: string[];
  skips: string[];
  total: number;
}

/** 触发节点判定（ins=[]，01 A-6-01；未注册类型不视为触发——demo L1795 同口径） */
export function findTriggers(doc: FlowDoc, registry: RunRegistryLike): FlowNode[] {
  return doc.nodes.filter((n) => (registry.get(n.type)?.ports.ins.length ?? 1) === 0);
}

export class TopoPlanner {
  constructor(private readonly registry: RunRegistryLike) {}

  plan(doc: FlowDoc): TopoPlan {
    const triggers = findTriggers(doc, this.registry);
    const seen = new Set(triggers.map((n) => n.id));
    const order = [...seen];
    // BFS：队首出队扫描全部出边，未见下游入队（demo L1797-1799）
    for (let i = 0; i < order.length; i++) {
      const cur = order[i];
      if (cur === undefined) continue;
      for (const e of doc.edges) {
        if (e.from[0] === cur && !seen.has(e.to[0])) {
          seen.add(e.to[0]);
          order.push(e.to[0]);
        }
      }
    }
    const skips = doc.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
    return { order, skips, total: order.length };
  }
}
