// CanvasModule 半段导出面（T3-01 起；C-01 §1 对外接口契约——随波次增补）。
// xyflow 基础样式经本模块引入（P-3 收窄：@xyflow/react import 面只在 canvas 目录内）。
import '@xyflow/react/dist/style.css';
export { CanvasChrome, ZOOM_MIN, ZOOM_MAX } from './CanvasChrome';
export type { CanvasChromeProps } from './CanvasChrome';
export { nodeTypes, edgeTypes, NodeCard, FlowEdge } from './node-types';
export type { CanvasNodeData } from './node-types';
export { useCanvasStore } from './canvas-store';
export type { CanvasStore, DrawerState } from './canvas-store';
// flowStore（T3-05；C-01 §1 store 面）
export {
  DEFAULT_IN_PORT,
  DEFAULT_OUT_PORT,
  FLOW_EDGE_TYPE,
  FLOW_NODE_TYPE,
  HISTORY_LIMIT,
  toXyEdges,
  toXyNodes,
  useFlowStore,
} from './stores/flow-store';
export type {
  DirtyConfirmHandler,
  FlowHistorySlice,
  FlowState,
} from './stores/flow-store';
// LayoutEngine（T3-07；03 §1 替换点②——布局引擎 import 收窄于 layout/layout-engine.ts）
export {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  layout,
} from './layout/layout-engine';
export type {
  LayoutEdgeInput,
  LayoutNodeInput,
  LayoutOptions,
  PositionedNode,
} from './layout/layout-engine';
