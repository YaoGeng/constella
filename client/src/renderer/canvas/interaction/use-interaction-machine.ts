// InteractionMachine —— 画布交互状态机（T3-04；C-01 §3 InteractionMachine 行；01 A-3.4/A-5.1；
// demo L1457-1493 三态语义的 xyflow 装配等价：pan/node/connect 三态互斥、运行中 node 仅选中
// 不可拖＋编辑闸、20px 网格吸附、连线落点三查、单次拖动合并为一条历史项）。
//
// 形态：返回 ReactFlow props 集（onConnect/onNodeDrag*/nodesDraggable/snap…），由 CanvasChrome
// 展开（P-3：@xyflow/react import 收窄于 canvas 目录）。
import { useCallback, useRef } from 'react';
import { type Connection, type NodeMouseHandler, type OnConnectEnd, type OnNodeDrag } from '@xyflow/react';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore, FLOW_EDGE_TYPE, DEFAULT_IN_PORT, DEFAULT_OUT_PORT } from '../stores/flow-store';
import { useCanvasToast } from '../toast';
import { useCanvasRegistry, useSnap } from '../registry-context';
import {
  validateConnection,
  violationMessage,
  type NodeRef,
} from './connect-validator';

let edgeSeq = 0;
function newEdgeId(): string {
  return `e-${Date.now().toString(36)}-${(edgeSeq++).toString(36)}`;
}

/** 一次拖动恰一条历史项（demo L1491 首次移动压栈语义的 zundo 实现）：dragStart 起 pause
 *  （拖动中间帧不入栈），dragStop 以「基线→终态」双 set 合并——resume 后首 set 与 pause 前
 *  prevState 相等不压栈、次 set 压入拖前基线，undo 恰回拖前（zundo 2.3 API=pause/resume）。 */
export function useInteractionMachine() {
  const toast = useCanvasToast();
  const registry = useCanvasRegistry();
  const snap = useSnap();
  const dragBaseline = useRef<{ nodes: ReturnType<typeof useFlowStore.getState>['nodes'] } | null>(null);

  /** 共享三查＋建边（onConnect 与 onConnectEnd 兜底同源；A-3.4）。 */
  const runConnectionCheck = useCallback(
    (from: NodeRef, to: NodeRef) => {
      const { nodes, edges, running, setEdges } = useFlowStore.getState();
      const { editMode } = useCanvasStore.getState();
      if (running || !editMode) {
        toast('编辑模式下才能建立连线');
        return;
      }
      const targetType = nodes.find((n) => n.id === to.nodeId)?.data?.type as string | undefined;
      const def = targetType ? registry?.get(targetType) : undefined;
      const result = validateConnection(from, to, {
        targetHasInput: (def?.ports.ins.length ?? 1) > 0,
        edges: edges.map((e) => ({
          from: [e.source, (e.sourceHandle as string) ?? DEFAULT_OUT_PORT] as const,
          to: [e.target, (e.targetHandle as string) ?? DEFAULT_IN_PORT] as const,
        })),
      });
      if (result !== 'ok') {
        toast(violationMessage(result, def?.meta.name ?? targetType ?? to.nodeId));
        return;
      }
      setEdges([
        ...edges,
        {
          id: newEdgeId(),
          type: FLOW_EDGE_TYPE,
          source: from.nodeId,
          sourceHandle: from.portId,
          target: to.nodeId,
          targetHandle: to.portId,
        },
      ]);
    },
    [registry, toast],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target) return;
      runConnectionCheck(
        { nodeId: source, portId: sourceHandle ?? DEFAULT_OUT_PORT },
        { nodeId: target, portId: targetHandle ?? DEFAULT_IN_PORT },
      );
    },
    [runConnectionCheck],
  );

  /** onConnectEnd 兜底（demo L1520-1526「拖到节点上 mouseup 即校验」语义）：xyflow onConnect 仅在
   * drop 命中 handle 时触发；drop 到节点 body（如 ins=[] 触发节点无 handle）走此处手动三查。
   * state.toNode 在 body 落点为 null（xyflow 仅 handle hover 填充）——以 event.target 最近节点
   * wrapper 的 data-id 定位目标（xyflow DOM 契约）。 */
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || state.toHandle) return; // 已走 onConnect 三查
      const fromHandle = state.fromHandle;
      if (!fromHandle?.nodeId) return;
      const nodeEl = (event.target as Element | null)?.closest('.react-flow__node');
      const toId = nodeEl?.getAttribute('data-id');
      if (!toId) return; // 未落在节点上：静默取消（demo return）
      runConnectionCheck(
        { nodeId: fromHandle.nodeId, portId: fromHandle.id ?? DEFAULT_OUT_PORT },
        { nodeId: toId, portId: DEFAULT_IN_PORT },
      );
    },
    [runConnectionCheck],
  );

  const onNodeDragStart: OnNodeDrag = useCallback(() => {
    dragBaseline.current = { nodes: useFlowStore.getState().nodes };
    useFlowStore.temporal.getState().pause();
  }, []);

  const onNodeDragStop: OnNodeDrag = useCallback(() => {
    const baseline = dragBaseline.current;
    dragBaseline.current = null;
    if (!baseline) {
      useFlowStore.temporal.getState().resume();
      return;
    }
    const { nodes: finalNodes, setNodes } = useFlowStore.getState();
    // 仍处 pause（dragStart 起）：静默恢复基线（中间帧不入栈）；resume 后单次 set 终态——
    // zundo 以「setState 旧值」为 pastState（2.3 源码实证，无内部缓存），故恰压入拖前基线一条。
    setNodes(baseline.nodes);
    useFlowStore.temporal.getState().resume();
    setNodes(finalNodes);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    // 运行中仅选中（demo L1472；拖拽已被 nodesDraggable=false 阻断）
    useCanvasStore.getState().setSelection(node.id);
  }, []);

  // 闸门订阅（hooks 恒定调用序——不可短路组合）
  const editMode = useCanvasStore((s) => s.editMode);
  const running = useFlowStore((s) => s.running);

  return {
    /** pan 态：xyflow 内建空白拖拽＋Space 按住平移（panActivationKeyCode，demo L1474 语义）。 */
    panActivationKey: 'Space' as const,
    /** node 态闸门：运行中或非编辑态不可拖（仅选中；A-5.1 编辑闸）。 */
    nodesDraggable: editMode && !running,
    /** 20px 网格吸附（demo L1493；xyflow snapToGrid 等价——拖动中实时吸附）。 */
    snapToGrid: snap,
    snapGrid: [20, 20] as [number, number],
    /** connect 态：落点三查（违例 toast 逐字文案/合法建边单历史项）＋ body 落点兜底。 */
    onConnect,
    onConnectEnd,
    /** 拖动历史合并（S-1 ④ 配套：中间帧不入栈）。 */
    onNodeDragStart,
    onNodeDragStop,
    onNodeClick,
  };
}
