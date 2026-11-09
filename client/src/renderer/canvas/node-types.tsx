// nodeTypes/edgeTypes 单一映射注册面（T3-01；C-01 §1 契约首两条）。
//
// registry 驱动语义：**不逐 type 注册组件**——全部节点共用单键 `constella-node`（NodeCard
// 按 data.type 读 C-05 定义渲染，T3-02 实装）、全部边共用单键 `constella-edge`（FlowEdge，
// T3-03 实装）。本文件是 @xyflow/react 在 renderer 的唯一 nodeTypes/edgeTypes 出口。
import type { EdgeProps, NodeProps, NodeTypes, EdgeTypes } from '@xyflow/react';

/** 节点 data 形（C-01 §3 NodeCard 行：data:{nodeId,type,params}＋序列化语义字段 name/noScript——T3-05 flowStore）。 */
export interface CanvasNodeData extends Record<string, unknown> {
  nodeId: string;
  type: string;
  name?: string;
  params?: Record<string, unknown>;
  /** 无脚本标记（缺 scripts/ 资产的强节点，02 §8.4 运行闸）。 */
  noScript?: boolean;
}

/** 占位 NodeCard（T3-02 替换为 192px 玻璃卡片——本卡只立注册面与 data 契约）。 */
export function NodeCard({ data }: NodeProps) {
  const d = data as CanvasNodeData;
  return <div className="cn-node cn-node--placeholder">{d.type}</div>;
}

/** 占位 FlowEdge（T3-03 替换为双层 path 流光边）。 */
export function FlowEdge(_props: EdgeProps) {
  return null;
}

/** 单一映射（键名随 flowStore 序列化固定，P-3：@xyflow/react import 收窄于 canvas 目录）。 */
export const nodeTypes: NodeTypes = { 'constella-node': NodeCard };
export const edgeTypes: EdgeTypes = { 'constella-edge': FlowEdge };
