// flowStore —— 当前流程文档 store（T3-05；C-01 §1/§3/§4、02 §3.3）。
//
// 状态源＝xyflow 受控 nodes/edges（语义字段藏于 node.data / edge 端口句柄），activeFlowId
// 归属当前流程；zundo temporal 撤销重做（**S-1 ④ 三件套**：limit=60 + partialize 白名单只取
// nodes/edges 且剥 xyflow 运行时字段〔measured/selected/dragging 等——否则历史栈被测量 set
// 污染、redo 被清空〕+ 自定义 equality 深比较）。
//
// 脏标记管线（A-5.1）：dirty 由「当前文档 vs 基线快照」深比较派生（markDirty 强制置位、
// markSaved/loadFlow 重置基线）；guardDirty 拦截丢改动动作（confirmHandler 注入位=应用壳
// 对话框，默认 dirty 即拒绝）；app:confirmClose renderer 侧应答＝dirty（通道随 C-M1 T4-13）。
//
// SaveOrchestrator 装配（T1-08）：createSaveContext() 产 SaveContext{serialize,onSaved}——
// P-3 不 import storage 域，装配由上层（AutoSaveScheduler/header）完成。
import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { FlowDoc, FlowEdge, FlowNode } from '@constella/shared/ipc';
import type { CanvasNodeData } from '../node-types';
import type { SaveContext } from '../../storage/save-orchestrator';

/** 注册面单键（node-types.ts 同源——受控节点 type 恒为该键，定义 type 在 data.type）。 */
export const FLOW_NODE_TYPE = 'constella-node';
export const FLOW_EDGE_TYPE = 'constella-edge';

/** 默认端口（B-13：未声明 N7 时回退 out→{data} 契约——出口 'out'/入口 'in'）。 */
export const DEFAULT_OUT_PORT = 'out';
export const DEFAULT_IN_PORT = 'in';

/** 历史 limit（A-5.3：61 次变更栈深恰 60；S-1 以 limit 200 实测同构基线）。 */
export const HISTORY_LIMIT = 60;

/** xyflow 节点运行时字段（partialize 剥除——S-1 ④：测量/选中/拖拽态不入历史）。 */
function stripNodeRuntime(node: Node): Node {
  const { measured: _m, selected: _s, dragging: _d, resizing: _r, ...rest } = node as Node & {
    measured?: unknown;
    selected?: boolean;
    dragging?: boolean;
    resizing?: boolean;
  };
  return rest;
}

/** partialize 产物形（历史快照形）。 */
export interface FlowHistorySlice {
  nodes: Node[];
  edges: Edge[];
}

/** 脏闸确认回调注入位（应用壳对话框——T4-13/P5 接线；默认：dirty 即拒绝）。 */
export type DirtyConfirmHandler = (action: string) => boolean;

export interface FlowState {
  activeFlowId: string | null;
  name: string;
  nodes: Node[];
  edges: Edge[];
  dirty: boolean;
  /** 运行中（runStore 只读 selector 注入位——02 §3.3 形；T4-04 接线，区头 a 项默认态交付）。 */
  running: boolean;
  /** 基线快照 JSON（loadFlow/markSaved 重置；dirty 派生基准）。 */
  baseline: string;
  confirmHandler: DirtyConfirmHandler | null;
  // —— 变更通道（CanvasChrome 受控装配；InteractionMachine 三态随 T3-04 接管节流语义）——
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  setNodes(nodes: Node[]): void;
  setEdges(edges: Edge[]): void;
  // —— 流程生命周期 ——
  /** 切流程/装载（历史按 flowId 归属：换归属+清栈+基线重置，undo 无操作）。 */
  loadFlow(flowId: string | null, doc: FlowDoc): void;
  /** restoreVersion 快照替换（C-06 versions.restore renderer 侧消费——roundtrip 呈 dirty）。 */
  applySnapshot(doc: FlowDoc): void;
  /** 保存周期 onSaved（SaveOrchestrator ctx.onSaved＝清栈+换基线+dirty 复位）。 */
  markSaved(_versionId: string): void;
  // —— 脏标记管线（A-5.1）——
  markDirty(): void;
  guardDirty(action: string): boolean;
  setConfirmHandler(handler: DirtyConfirmHandler | null): void;
  // —— 撤销重做（运行中禁用）——
  undo(): void;
  redo(): void;
  setRunning(running: boolean): void;
  // —— 序列化 ——
  serialize(): FlowDoc;
  /** SaveOrchestrator 注入面（T1-08 SaveContext 产线）。 */
  createSaveContext(): SaveContext;
}

// ————————————————————————————————————————————
// FlowDoc ↔ xyflow 受控形映射（02 §3.3「xyflow 格式＋demo 语义字段」）
// ————————————————————————————————————————————

export function toXyNodes(doc: FlowDoc): Node[] {
  return doc.nodes.map((n: FlowNode) => ({
    id: n.id,
    type: FLOW_NODE_TYPE,
    position: n.position,
    data: {
      nodeId: n.id,
      type: n.type,
      name: n.name,
      params: n.params,
      ...(n.noScript ? { noScript: true } : {}),
    } satisfies CanvasNodeData,
  }));
}

export function toXyEdges(doc: FlowDoc): Edge[] {
  return doc.edges.map((e: FlowEdge) => ({
    id: e.id,
    type: FLOW_EDGE_TYPE,
    source: e.from[0],
    sourceHandle: e.from[1],
    target: e.to[0],
    targetHandle: e.to[1],
  }));
}

function snapshotOf(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify({ nodes: nodes.map(stripNodeRuntime), edges });
}

export const useFlowStore = create<FlowState>()(
  temporal(
    (set, get) => ({
      activeFlowId: null,
      name: '未命名流程',
      nodes: [],
      edges: [],
      dirty: false,
      running: false,
      baseline: snapshotOf([], []),
      confirmHandler: null,

      onNodesChange: (changes) => {
        const { nodes, baseline } = get();
        const next = applyNodeChanges(changes, nodes);
        set({ nodes: next, dirty: snapshotOf(next, get().edges) !== baseline });
      },
      onEdgesChange: (changes) => {
        const { edges, nodes, baseline } = get();
        const next = applyEdgeChanges(changes, edges);
        set({ edges: next, dirty: snapshotOf(nodes, next) !== baseline });
      },
      setNodes: (nodes) => {
        const { edges, baseline } = get();
        set({ nodes, dirty: snapshotOf(nodes, edges) !== baseline });
      },
      setEdges: (edges) => {
        const { nodes, baseline } = get();
        set({ edges, dirty: snapshotOf(nodes, edges) !== baseline });
      },

      loadFlow: (flowId, doc) => {
        const nodes = toXyNodes(doc);
        const edges = toXyEdges(doc);
        set({
          activeFlowId: flowId,
          name: doc.name,
          nodes,
          edges,
          dirty: false,
          baseline: snapshotOf(nodes, edges),
        });
        // 历史按 flowId 归属：切流程清栈（undo 对新流程无操作）
        useFlowStore.temporal.getState().clear();
      },
      applySnapshot: (doc) => {
        const nodes = toXyNodes(doc);
        const edges = toXyEdges(doc);
        // restoreVersion 恢复完整文档快照（含 name；id 归属不变——restore 的就是当前流程的历史版本）
        set({ name: doc.name, nodes, edges, dirty: true });
      },
      markSaved: () => {
        const { nodes, edges } = get();
        set({ dirty: false, baseline: snapshotOf(nodes, edges) });
        useFlowStore.temporal.getState().clear();
      },

      markDirty: () => set({ dirty: true }),
      guardDirty: (action) => {
        const { dirty, confirmHandler } = get();
        if (!dirty) return true;
        return confirmHandler ? confirmHandler(action) : false;
      },
      setConfirmHandler: (confirmHandler) => set({ confirmHandler }),

      undo: () => {
        if (get().running) return;
        const t = useFlowStore.temporal.getState();
        if (t.pastStates.length === 0) return;
        t.undo();
        const { nodes, edges, baseline } = get();
        set({ dirty: snapshotOf(nodes, edges) !== baseline });
      },
      redo: () => {
        if (get().running) return;
        const t = useFlowStore.temporal.getState();
        if (t.futureStates.length === 0) return;
        t.redo();
        const { nodes, edges, baseline } = get();
        set({ dirty: snapshotOf(nodes, edges) !== baseline });
      },
      setRunning: (running) => set({ running }),

      serialize: () => {
        const { activeFlowId, name, nodes, edges } = get();
        return {
          ...(activeFlowId ? { id: activeFlowId } : {}),
          name,
          nodes: nodes.map((n) => {
            const d = n.data as CanvasNodeData;
            const out: FlowNode = {
              id: n.id,
              type: d.type,
              name: d.name ?? d.type,
              position: n.position,
              params: d.params ?? {},
            };
            if (d.noScript) out.noScript = true;
            return out;
          }),
          edges: edges.map((e) => ({
            id: e.id,
            from: [e.source, (e.sourceHandle as string) ?? DEFAULT_OUT_PORT] as const,
            to: [e.target, (e.targetHandle as string) ?? DEFAULT_IN_PORT] as const,
          })),
        };
      },
      createSaveContext: (): SaveContext => ({
        serialize: () => get().serialize(),
        onSaved: (versionId) => get().markSaved(versionId),
      }),
    }),
    {
      // —— zundo 三件套（S-1 ④ 强制）——
      limit: HISTORY_LIMIT,
      // ① partialize 白名单：只取 nodes/edges，且逐节点剥 measured/selected/dragging/resizing
      partialize: (state): FlowHistorySlice => ({
        nodes: state.nodes.map(stripNodeRuntime),
        edges: state.edges,
      }),
      // ② 自定义 equality：深比较（剥字段后无差异则不压栈——纯测量 set 不产生历史项）
      equality: (past, current) => JSON.stringify(past) === JSON.stringify(current),
    },
  ),
);
