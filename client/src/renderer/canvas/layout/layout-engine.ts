// LayoutEngine —— @dagrejs/dagre 包装组件（T3-07；C-01 §1/§3 LayoutEngine 行、02 §9.1「一键生成」；
// 03 §1 替换点②：本文件是 renderer 内唯一 dagre import 面——elkjs 替换通道=EPL-2.0+S-9 复验，不在本卡）。
//
// 分层自动排布（替代 demo col/row 手排）；消费方=C-07〔P5〕经应用壳编排（P-3 无 import 边）。
// dagre 3.1.3 API 面（T0-01「3.x 接入注记」实测）：named exports { graphlib, layout }，坐标语义
// 与经典版一致（node.x/y=**中心点**）——输出换算为 xyflow 左上角坐标。
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';

/** 排布输入节点子集（xyflow Node 结构投影）。 */
export interface LayoutNodeInput {
  id: string;
}

/** 排布输入边子集（xyflow Edge 结构投影）。 */
export interface LayoutEdgeInput {
  source: string;
  target: string;
}

/** 排布选项（扩展点①：AI 排布策略参数化——方向/间距随 C-07 规划偏好）。 */
export interface LayoutOptions {
  /** 排布方向（默认 LR——demo 流程语义从左到右）。 */
  rankdir?: 'LR' | 'TB' | 'RL' | 'BT';
  /** 同层节点间距（dagre nodesep，默认 40）。 */
  nodesep?: number;
  /** 层间距（dagre ranksep，默认 80）。 */
  ranksep?: number;
  /** 节点盒宽（默认 192=NodeCard 卡宽，T3-02）。 */
  nodeWidth?: number;
  /** 节点盒高（默认 80）。 */
  nodeHeight?: number;
}

/** 输出形：xyflow 左上角坐标（消费方按 id 回填 position）。 */
export interface PositionedNode {
  id: string;
  position: { x: number; y: number };
}

export const DEFAULT_NODE_WIDTH = 192;
export const DEFAULT_NODE_HEIGHT = 80;

/** 分层自动排布：layout(nodes, edges, opts) → 各节点左上角坐标。 */
export function layout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  opts: LayoutOptions = {},
): PositionedNode[] {
  const {
    rankdir = 'LR',
    nodesep = 40,
    ranksep = 80,
    nodeWidth = DEFAULT_NODE_WIDTH,
    nodeHeight = DEFAULT_NODE_HEIGHT,
  } = opts;

  const g = new graphlib.Graph();
  g.setGraph({ rankdir, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: nodeWidth, height: nodeHeight });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagreLayout(g);

  return nodes.map((n) => {
    const box = g.node(n.id);
    if (!box || typeof box.x !== 'number' || typeof box.y !== 'number') {
      // 未进图的孤立输入兜底：原点堆叠（正常输入面不会走到——nodes 全部 setNode）
      return { id: n.id, position: { x: 0, y: 0 } };
    }
    // dagre 中心点 → xyflow 左上角
    return {
      id: n.id,
      position: { x: box.x - nodeWidth / 2, y: box.y - nodeHeight / 2 },
    };
  });
}
