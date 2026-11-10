// 装配模块（T5-11 / batch-3 转交硬接线清单落位——05 L861）。
//
// land-edges.ts —— FlowMaterializer.landEdges 注入位**真绑定**（T5-04：现「一键生成」画布无边
// ——landEdges 缺省=仅落盘不落边）。实现=flowStore.setEdges **合并写**（既有边保留＋toXyEdges
// 端口元组映射——C-01 消费形）。
//
// ⚠ C-01 会签留痕（T5-04 评审裁定）：「addEdges 并入 CanvasSink 导出面」按 T5-04 评审裁定
// **注入位够 V1.0**——CanvasSink 冻结面（T3-08 导出面五 op）不动，落边合并写留在装配层；
// 若后续会签决定并入（addEdges op），本文件整体替换为 CanvasSink.addEdges 透传，FlowMaterializer
// 注入位签名不变（P-3 替换点同款）。
import type { FlowEdge } from '@constella/shared/ipc';
import { toXyEdges, useFlowStore } from '../canvas/stores/flow-store';

/** landEdges 注入实现（FlowMaterializerDeps.landEdges 消费形——端口元组边→xyflow 受控边） */
export function createLandEdgesBinder(): (edges: FlowEdge[]) => void {
  return (edges) => {
    if (edges.length === 0) return;
    const store = useFlowStore.getState();
    // 合并写：既有边保留（dropNodes 整批后追加——「一键生成」步骤连线落图）
    store.setEdges([...store.edges, ...toXyEdges({ id: '', name: '', nodes: [], edges })]);
  };
}
