// CanvasChrome —— 画布宿主装配件（T3-01 起、T3-04 接入 flowStore 受控与交互状态机；
// C-01 §3 CanvasChrome 行）。
//
// 职责：ReactFlow 画布 + MiniMap / Controls / Background（dots 网格 24px 基准随缩放）/
// 缩放条 25%–200%（demo L1329/L1345 ZMIN/ZMAX）装配；flowStore 受控（nodes/edges/变更回调）
// + InteractionMachine 三态（pan/node/connect；运行闸/吸附/拖动历史合并）。
// props 装配面：显式传入的 nodes/edges/事件覆盖默认 flowStore 接线（测试/e2e 注入位）。
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
  type ReactFlowProps,
} from '@xyflow/react';
import { useCallback } from 'react';
import { edgeTypes, nodeTypes } from './node-types';
import { useFlowStore } from './stores/flow-store';
import { useInteractionMachine } from './interaction/use-interaction-machine';

/** 缩放边界（demo L1329/L1345：ZMIN=0.25 / ZMAX=2——即 25%–200%）。 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export interface CanvasChromeProps extends Omit<ReactFlowProps, 'nodes' | 'edges' | 'onNodeDragStart' | 'onNodeDragStop'> {
  /** 覆盖 flowStore 受控接线（测试注入位；缺省=flowStore.nodes/edges）。 */
  nodes?: Node[];
  edges?: Edge[];
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  onConnect?: OnConnect;
  onNodeDragStart?: OnNodeDrag<Node>;
  onNodeDragStop?: OnNodeDrag<Node>;
}

/** 缩放条：− [100%] ＋（读写 viewport zoom；clamp 到 25%–200%）。 */
function ZoomBar() {
  const { setViewport } = useReactFlow();
  // transform = [x, y, zoom]（xyflow store 内建，订阅不触发整树重渲染）
  const transform = useStore((s) => s.transform);
  const zoom = transform[2];
  const percent = Math.round(zoom * 100);
  const zoomTo = useCallback(
    (delta: number) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta));
      void setViewport({ x: transform[0], y: transform[1], zoom: next });
    },
    [transform, setViewport],
  );

  return (
    <div className="cn-zoombar" data-percent={percent}>
      <button type="button" className="cn-zoombar__btn" aria-label="缩小" onClick={() => zoomTo(-0.1)} disabled={zoom <= ZOOM_MIN}>
        −
      </button>
      <span className="cn-zoombar__value" data-testid="canvas-zoom-percent">
        {percent}%
      </span>
      <button type="button" className="cn-zoombar__btn" aria-label="放大" onClick={() => zoomTo(0.1)} disabled={zoom >= ZOOM_MAX}>
        ＋
      </button>
    </div>
  );
}

export function CanvasChrome({
  nodes: nodesProp,
  edges: edgesProp,
  onNodesChange: onNodesChangeProp,
  onEdgesChange: onEdgesChangeProp,
  onConnect: onConnectProp,
  onNodeDragStart: onNodeDragStartProp,
  onNodeDragStop: onNodeDragStopProp,
  ...rest
}: CanvasChromeProps) {
  const storeNodes = useFlowStore((s) => s.nodes);
  const storeEdges = useFlowStore((s) => s.edges);
  const storeOnNodesChange = useFlowStore((s) => s.onNodesChange);
  const storeOnEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const interaction = useInteractionMachine();

  return (
    <div className="cn-canvas-host">
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodesProp ?? storeNodes}
        edges={edgesProp ?? storeEdges}
        onNodesChange={onNodesChangeProp ?? storeOnNodesChange}
        onEdgesChange={onEdgesChangeProp ?? storeOnEdgesChange}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        /** loose：ins=[] 触发节点无入口 Handle 也可作为连线落点（onConnect 三查拦 no-input，
            demo L1520-1526 「拖到节点上即校验」语义；A-3.2）。 */
        connectionMode={ConnectionMode.Loose}
        panActivationKeyCode={interaction.panActivationKey}
        nodesDraggable={interaction.nodesDraggable}
        snapToGrid={interaction.snapToGrid}
        snapGrid={interaction.snapGrid}
        onConnect={onConnectProp ?? interaction.onConnect}
        onConnectEnd={interaction.onConnectEnd}
        onNodeDragStart={onNodeDragStartProp ?? interaction.onNodeDragStart}
        onNodeDragStop={onNodeDragStopProp ?? interaction.onNodeDragStop}
        onNodeClick={interaction.onNodeClick}
        {...rest}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
        <ZoomBar />
      </ReactFlow>
    </div>
  );
}
