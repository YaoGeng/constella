// ViewportController —— 视图控制 hook（T3-06；C-01 §3 ViewportController 行；01 A-3.6；
// demo L1589-1618 fitView/panToNode 语义的 xyflow 装配等价）。
//
// 消费方：header ⌖ 按钮（fitView）、C-10 任务中心/节点库（panToNode 定位＋闪烁）——经应用壳
// 编排（P-3：L3 不 import L4）。
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

/** fitView 边距（demo L1600：pad 56px；headPad 64px 由 xyflow padding 比例近似覆盖）。 */
export const FIT_VIEW_PADDING = 0.15;

/** 空流程复位默认视图（demo L1597：{x:60,y:40,s:1}）。 */
const EMPTY_VIEW = { x: 60, y: 40, zoom: 1 };

export interface ViewportController {
  fitView(): void;
  panToNode(id: string): void;
}

export function useViewportController(): ViewportController {
  const { fitView: rfFitView, setCenter, setViewport, getZoom } = useReactFlow();

  const fitView = useCallback(() => {
    const { nodes } = useFlowStore.getState();
    if (nodes.length === 0) {
      void setViewport(EMPTY_VIEW);
      return;
    }
    void rfFitView({ padding: FIT_VIEW_PADDING, duration: 200 });
  }, [rfFitView, setViewport]);

  const panToNode = useCallback(
    (id: string) => {
      const { nodes } = useFlowStore.getState();
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      // 视野居中（保持当前 zoom）＋闪烁高亮（demo L1608-1618：flash class 重放）
      void setCenter(node.position.x + 96, node.position.y + 40, { zoom: getZoom(), duration: 200 });
      useCanvasStore.getState().setSelection(id);
      const el = document.querySelector(`.react-flow__node[data-id="${id}"] .cn-node`);
      if (el) {
        el.classList.remove('cn-node--flash');
        void (el as HTMLElement).offsetWidth; // 重启动画
        el.classList.add('cn-node--flash');
      }
    },
    [setCenter, getZoom],
  );

  return { fitView, panToNode };
}
