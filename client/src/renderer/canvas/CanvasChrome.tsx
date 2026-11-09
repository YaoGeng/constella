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
  ReactFlowProvider,
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
import { useCallback, useEffect, useRef } from 'react';
import { edgeTypes, nodeTypes } from './node-types';
import { useCanvasStore } from './canvas-store';
import { useFlowStore, FLOW_NODE_TYPE } from './stores/flow-store';
import { useInteractionMachine } from './interaction/use-interaction-machine';
import { EditorKeyboard } from './viewport/EditorKeyboard';
import { DrawerShell, type DrawerShellProps } from './drawer/DrawerShell';

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
  /** Ctrl+S 编排注入位（T1-08 doSave——EditorKeyboard 消费）。 */
  onSave?: () => void;
  /** DrawerShell 编排注入位（create 落图/动作区——应用壳装配；缺省=视口中心最小落图）。 */
  drawer?: DrawerShellProps;
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
  onSave,
  drawer: drawerProps,
  ...rest
}: CanvasChromeProps) {
  return (
    <ReactFlowProvider>
      <CanvasChromeInner
        nodesProp={nodesProp}
        edgesProp={edgesProp}
        onNodesChangeProp={onNodesChangeProp}
        onEdgesChangeProp={onEdgesChangeProp}
        onConnectProp={onConnectProp}
        onNodeDragStartProp={onNodeDragStartProp}
        onNodeDragStopProp={onNodeDragStopProp}
        onSave={onSave}
        drawerProps={drawerProps}
        rest={rest}
      />
    </ReactFlowProvider>
  );
}

interface CanvasChromeInnerProps {
  nodesProp?: Node[];
  edgesProp?: Edge[];
  onNodesChangeProp?: (changes: NodeChange[]) => void;
  onEdgesChangeProp?: (changes: EdgeChange[]) => void;
  onConnectProp?: OnConnect;
  onNodeDragStartProp?: OnNodeDrag<Node>;
  onNodeDragStopProp?: OnNodeDrag<Node>;
  onSave?: () => void;
  drawerProps?: DrawerShellProps;
  rest: ReactFlowProps;
}

function CanvasChromeInner({
  nodesProp,
  edgesProp,
  onNodesChangeProp,
  onEdgesChangeProp,
  onConnectProp,
  onNodeDragStartProp,
  onNodeDragStopProp,
  onSave,
  drawerProps,
  rest,
}: CanvasChromeInnerProps) {
  const storeNodes = useFlowStore((s) => s.nodes);
  const storeEdges = useFlowStore((s) => s.edges);
  const storeOnNodesChange = useFlowStore((s) => s.onNodesChange);
  const storeOnEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const interaction = useInteractionMachine();
  const { screenToFlowPosition } = useReactFlow();
  const hostRef = useRef<HTMLDivElement>(null);

  /** 空白双击开 create 抽屉（demo L1568：按世界坐标）。原生 **capture** 监听：d3-zoom 即便
   *  doubleClickZoom=false 仍会在冒泡层拦截 dblclick（React 合成 onDoubleClick 收不到，
   *  e2e 实证 2026-11-09），capture 先于其到达；判定=非节点命中且落在 pane 上（pane 是
   *  xyflow 根容器，节点也在其内）。 */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onDbl = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target || target.closest('.react-flow__node')) return;
      if (!target.closest('.react-flow__pane')) return;
      const { editMode } = useCanvasStore.getState();
      const { running } = useFlowStore.getState();
      if (running || !editMode) return;
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      useCanvasStore.getState().openDrawer({ mode: 'create', pos: { x: p.x, y: p.y } });
    };
    el.addEventListener('dblclick', onDbl, true);
    return () => el.removeEventListener('dblclick', onDbl, true);
  }, [screenToFlowPosition]);

  return (
    <div className="cn-canvas-host" ref={hostRef}>
      {/* 双击节点开 edit 抽屉（demo L1561-1566） */}
      <ReactFlow
        onNodeDoubleClick={(_, node) => {
          const { editMode } = useCanvasStore.getState();
          const { running } = useFlowStore.getState();
          useCanvasStore.getState().openDrawer(running || !editMode ? { mode: 'readonly', nodeId: node.id } : { mode: 'edit', nodeId: node.id });
        }}
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
        /** 关闭 xyflow 双击缩放（缩放=wheel＋缩放条；抽屉双击语义优先）。 */
        zoomOnDoubleClick={false}
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
      <DrawerShell
        onCreate={
          drawerProps?.onCreate ??
          ((type) => {
            // 缺省落图：双击落点（drawer.pos）或视口中心
            const { drawer } = useCanvasStore.getState();
            const pos = drawer?.pos ?? { x: 60, y: 60 };
            const id = `n-${type}-${Date.now().toString(36)}`;
            useFlowStore.getState().addNodes([
              {
                id,
                type: FLOW_NODE_TYPE,
                position: pos,
                data: { nodeId: id, type, params: {} },
              },
            ]);
            useCanvasStore.getState().closeDrawer();
          })
        }
        onSave={drawerProps?.onSave}
        onDelete={drawerProps?.onDelete}
        onLibraryUpsert={drawerProps?.onLibraryUpsert}
        onTryRun={drawerProps?.onTryRun}
      >
        {drawerProps?.children}
      </DrawerShell>
      <EditorKeyboard onSave={onSave} />
    </div>
  );
}
