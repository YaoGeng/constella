// CanvasSink / FlowSwitcher 导出面（T3-08；C-01 §1「✅ M4 收口会签 #1——签名级」）。
//
// 应用壳装配点注入 C-07/C-08/C-09（P-3 方向不变：L3 不 import L4，经编排注入、无 import 边）。
// 实现=本卡域 flowStore/ViewportController 装配；createAndSwitch 的落盘通道=C-06 flows.create
// （本波 mock 语义：storage 未接——生成 flowId＋loadFlow，「初始版本」真落盘随 P5 C-09 接线，
// 区头 d 项）。
import type { Node } from '@xyflow/react';
import { useFlowStore, FLOW_NODE_TYPE } from '../stores/flow-store';
import type { FlowDoc } from '@constella/shared/ipc';

// ————————————————————————————————————————————
// CanvasSink（落图 seam）
// ————————————————————————————————————————————

export interface NodeDropSpec {
  type: string;
  params?: Record<string, unknown>;
}

export interface PositionedNodeSpec extends NodeDropSpec {
  x: number;
  y: number;
}

export interface CanvasSink {
  /** 批量落节点＝瀑布落点（坐标由调用方按 +36/+40 计——C-08/C-09 复用 WaterfallPlacer 同口径；
   *  单历史项整批一次可撤销＋markDirty）。 */
  dropNodes(specs: PositionedNodeSpec[]): string[];
  /** 视口中心落节点（C-07「加入画布」/节点库新建模板）。 */
  dropAtViewportCenter(spec: NodeDropSpec): string;
  /** 差异卡「应用」改选中节点 params/policy（C-07 ConfirmGate→N6 字段化）。 */
  patchNode(nodeId: string, patch: { params?: Record<string, unknown>; policy?: Record<string, unknown> }): void;
  /** A-5.1 脏标记。 */
  markDirty(): void;
  /** 脏闸询问（02 §3.3；C-09 flow 安装/C-10 定位共用语义）。 */
  guardDirty(action: string): boolean;
}

function specToNode(spec: PositionedNodeSpec, id: string): Node {
  return {
    id,
    type: FLOW_NODE_TYPE,
    position: { x: spec.x, y: spec.y },
    data: { nodeId: id, type: spec.type, params: spec.params ?? {} },
  };
}

let dropSeq = 0;
function newDropId(type: string): string {
  return `n-${type.replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}-${(dropSeq++).toString(36)}`;
}

export interface CanvasSinkDeps {
  /** 视口中心世界坐标（应用壳经 ReactFlow instance screenToFlowPosition 装配）。 */
  viewportCenter(): { x: number; y: number };
}

export function createCanvasSink(deps: CanvasSinkDeps): CanvasSink {
  return {
    dropNodes(specs) {
      const { addNodes } = useFlowStore.getState();
      const nodes = specs.map((s) => specToNode(s, newDropId(s.type)));
      addNodes(nodes); // 单历史项整批
      return nodes.map((n) => n.id);
    },
    dropAtViewportCenter(spec) {
      const { x, y } = deps.viewportCenter();
      const node = specToNode({ ...spec, x, y }, newDropId(spec.type));
      useFlowStore.getState().addNodes([node]);
      return node.id;
    },
    patchNode(nodeId, patch) {
      useFlowStore.getState().patchNode(nodeId, patch);
    },
    markDirty() {
      useFlowStore.getState().markDirty();
    },
    guardDirty(action) {
      return useFlowStore.getState().guardDirty(action);
    },
  };
}

// ————————————————————————————————————————————
// FlowSwitcher（流程创建/切换 seam）
// ————————————————————————————————————————————

export interface FlowSwitcher {
  /** 新流程创建＋「初始版本」落盘＋切换（C-09 flow 安装；落盘真通道随 P5——本波 mock）。 */
  createAndSwitch(name: string, doc: FlowDoc): Promise<string>;
  /** 切流程（脏闸拒绝=false；成功可 panToNode 闪烁）。 */
  switchFlow(flowId: string, opts?: { panToNodeId?: string; doc?: FlowDoc }): boolean;
}

let flowSeq = 0;

export function createFlowSwitcher(): FlowSwitcher {
  return {
    async createAndSwitch(name, doc) {
      const flowId = `flow-${Date.now().toString(36)}-${(flowSeq++).toString(36)}`;
      useFlowStore.getState().loadFlow(flowId, { ...doc, name });
      return flowId;
    },
    switchFlow(flowId, opts) {
      const { guardDirty } = useFlowStore.getState();
      if (!guardDirty(`switch:${flowId}`)) return false;
      useFlowStore.getState().loadFlow(flowId, opts?.doc ?? { name: flowId, nodes: [], edges: [] });
      if (opts?.panToNodeId) {
        document.dispatchEvent(new CustomEvent('constella:panToNode', { detail: opts.panToNodeId }));
      }
      return true;
    },
  };
}
