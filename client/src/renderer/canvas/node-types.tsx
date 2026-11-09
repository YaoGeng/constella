// nodeTypes/edgeTypes 单一映射注册面（T3-01 起；C-01 §1 契约首两条）。
//
// registry 驱动语义：**不逐 type 注册组件**——全部节点共用单键 `constella-node`（NodeCard
// 按 data.type 读 C-05 定义渲染，T3-02 实装）、全部边共用单键 `constella-edge`（FlowEdge，
// T3-03 实装）。本文件是 @xyflow/react 在 renderer 的唯一 nodeTypes/edgeTypes 出口。
import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { NodeCard } from './nodes/NodeCard';
import { FlowEdge } from './edges/FlowEdge';

export { NodeCard } from './nodes/NodeCard';
export { FlowEdge } from './edges/FlowEdge';

/** 节点 data 形（C-01 §3 NodeCard 行：data:{nodeId,type,params}＋序列化语义字段 name/noScript——T3-05 flowStore）。 */
export interface CanvasNodeData extends Record<string, unknown> {
  nodeId: string;
  type: string;
  name?: string;
  params?: Record<string, unknown>;
  /** 无脚本标记（缺 scripts/ 资产的强节点，02 §8.4 运行闸）。 */
  noScript?: boolean;
}

/** 单一映射（键名随 flowStore 序列化固定，P-3：@xyflow/react import 收窄于 canvas 目录）。 */
export const nodeTypes: NodeTypes = { 'constella-node': NodeCard };
export const edgeTypes: EdgeTypes = { 'constella-edge': FlowEdge };
