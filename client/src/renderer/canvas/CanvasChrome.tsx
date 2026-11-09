// CanvasChrome —— 画布宿主装配件（T3-01；C-01 §3 CanvasChrome 行）。
//
// 职责：ReactFlow 画布 + MiniMap / Controls / Background（dots 网格 24px 基准随缩放）/
// 缩放条 25%–200%（demo L1329/L1345 ZMIN/ZMAX）装配。props 装配面——nodes/edges 与变更
// 回调由上层注入（T3-05 flowStore 接线前以空画布交付；InteractionMachine/EditorKeyboard
// 随 T3-04/T3-06 在本宿主上挂载）。
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type ReactFlowProps,
} from '@xyflow/react';
import { useCallback } from 'react';
import { edgeTypes, nodeTypes } from './node-types';

/** 缩放边界（demo L1329/L1345：ZMIN=0.25 / ZMAX=2——即 25%–200%）。 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export interface CanvasChromeProps extends ReactFlowProps {
  nodes?: Node[];
  edges?: Edge[];
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

export function CanvasChrome({ nodes = [], edges = [], ...rest }: CanvasChromeProps) {
  return (
    <div className="cn-canvas-host">
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
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
