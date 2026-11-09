// canvasStore 用例（T3-01；C-01 §3 canvasStore 行——UI 态不入历史的 store 面先行验证）。
import { describe, expect, it } from 'vitest';
import { useCanvasStore } from './canvas-store';

function reset(): void {
  useCanvasStore.setState({
    viewport: null,
    selection: null,
    drawer: null,
    editMode: true,
  });
}

describe('canvasStore（T3-01）', () => {
  it('selection 为单值：新选中直接替换旧值（A-17.3 多选排除 V1）', () => {
    reset();
    const s = useCanvasStore.getState();
    s.setSelection('node-a');
    expect(useCanvasStore.getState().selection).toBe('node-a');
    useCanvasStore.getState().setSelection('node-b');
    expect(useCanvasStore.getState().selection).toBe('node-b');
    useCanvasStore.getState().setSelection(null);
    expect(useCanvasStore.getState().selection).toBe(null);
  });

  it('viewport 可写入并可复位（fitView/panToNode 消费面随 T3-06 接线）', () => {
    reset();
    useCanvasStore.getState().setViewport({ x: 100, y: -40, zoom: 1.5 });
    expect(useCanvasStore.getState().viewport).toEqual({ x: 100, y: -40, zoom: 1.5 });
  });

  it('drawer 开关：openDrawer/closeDrawer', () => {
    reset();
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'n1' });
    expect(useCanvasStore.getState().drawer).toEqual({ mode: 'edit', nodeId: 'n1' });
    useCanvasStore.getState().openDrawer({ mode: 'create', pos: { x: 8, y: 12 } });
    expect(useCanvasStore.getState().drawer?.mode).toBe('create');
    useCanvasStore.getState().closeDrawer();
    expect(useCanvasStore.getState().drawer).toBe(null);
  });

  it('editMode 编辑模式位可切换（运行态编辑闸，A-5.1）', () => {
    reset();
    expect(useCanvasStore.getState().editMode).toBe(true);
    useCanvasStore.getState().setEditMode(false);
    expect(useCanvasStore.getState().editMode).toBe(false);
  });
});
