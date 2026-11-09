// @vitest-environment jsdom
// EditorKeyboard 用例（T3-06；C-01 §6.2d/e 判据——vitest 层；E2E 层复跑随 canvas-e2e.mjs d/e 场景）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorKeyboard } from './EditorKeyboard';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function mountKeyboard(onSave?: () => void): Promise<Root> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<EditorKeyboard onSave={onSave} />);
  });
  return root;
}

function press(key: string, opts?: KeyboardEventInit & { target?: Element }): void {
  const target = opts?.target ?? document.body;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  Object.defineProperty(ev, 'target', { value: target });
  target.dispatchEvent(ev);
}

const DOC = {
  id: 'f1',
  name: 't',
  nodes: [
    { id: 'a', type: 'llm.chat', name: 'A', position: { x: 0, y: 0 }, params: {} },
    { id: 'b', type: 'llm.chat', name: 'B', position: { x: 200, y: 0 }, params: {} },
  ],
  edges: [{ id: 'e1', from: ['a', 'out'] as const, to: ['b', 'in'] as const }],
};

beforeEach(() => {
  useCanvasStore.setState({ editMode: true, selection: null, drawer: null });
  useFlowStore.getState().loadFlow('f1', DOC);
});

describe('Delete/Backspace 删选中节点（§6.2d）', () => {
  it('删除选中节点＋相邻边（单历史项可撤销）', async () => {
    const root = await mountKeyboard();
    try {
      useCanvasStore.getState().setSelection('a');
      act(() => {
        press('Delete');
      });
      expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['b']);
      expect(useFlowStore.getState().edges).toHaveLength(0);
      expect(useCanvasStore.getState().selection).toBe(null);
      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes).toHaveLength(2); // 单历史项整体回退
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('非编辑态/运行中/无选中不删除', async () => {
    const root = await mountKeyboard();
    try {
      useCanvasStore.setState({ editMode: false, selection: 'a' });
      act(() => {
        press('Delete');
      });
      expect(useFlowStore.getState().nodes).toHaveLength(2);
      useCanvasStore.setState({ editMode: true });
      useFlowStore.getState().setRunning(true);
      useCanvasStore.getState().setSelection('a');
      act(() => {
        press('Backspace');
      });
      expect(useFlowStore.getState().nodes).toHaveLength(2);
      useFlowStore.getState().setRunning(false);
      useCanvasStore.getState().setSelection(null);
      act(() => {
        press('Delete');
      });
      expect(useFlowStore.getState().nodes).toHaveLength(2);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('Ctrl+Z/Y 撤销重做（§6.2e）', () => {
  it('Ctrl+Z undo / Ctrl+Y redo / Ctrl+Shift+Z redo', async () => {
    const root = await mountKeyboard();
    try {
      useFlowStore.getState().setNodes(useFlowStore.getState().nodes.filter((n) => n.id !== 'b'));
      expect(useFlowStore.getState().nodes).toHaveLength(1);
      act(() => {
        press('z', { ctrlKey: true });
      });
      expect(useFlowStore.getState().nodes).toHaveLength(2);
      act(() => {
        press('y', { ctrlKey: true });
      });
      expect(useFlowStore.getState().nodes).toHaveLength(1);
      act(() => {
        press('Z', { ctrlKey: true, shiftKey: true });
      });
      // redo 队列已空：Ctrl+Shift+Z 无操作（仍 1 节点）
      expect(useFlowStore.getState().nodes).toHaveLength(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('运行中禁用（undo/redo no-op）', async () => {
    const root = await mountKeyboard();
    try {
      useFlowStore.getState().setNodes(useFlowStore.getState().nodes.filter((n) => n.id !== 'b'));
      useFlowStore.getState().setRunning(true);
      act(() => {
        press('z', { ctrlKey: true });
      });
      expect(useFlowStore.getState().nodes).toHaveLength(1); // 未回退
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('Ctrl+S 编排注入位（T1-08）与焦点守卫（A-3.5）', () => {
  it('dirty 时 Ctrl+S → onSave 回调触发一次；clean 不触发', async () => {
    let saved = 0;
    const root = await mountKeyboard(() => {
      saved++;
    });
    try {
      useFlowStore.getState().setNodes([]); // dirty
      act(() => {
        press('s', { ctrlKey: true });
      });
      expect(saved).toBe(1);
      useFlowStore.getState().markSaved('v');
      act(() => {
        press('s', { ctrlKey: true });
      });
      expect(saved).toBe(1); // clean 不再触发
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('焦点守卫：input/textarea/select 聚焦时编辑快捷键失效', async () => {
    const root = await mountKeyboard();
    try {
      const input = document.createElement('input');
      document.body.appendChild(input);
      useCanvasStore.getState().setSelection('a');
      act(() => {
        press('Delete', { target: input });
      });
      expect(useFlowStore.getState().nodes).toHaveLength(2); // 未删
      useFlowStore.getState().setNodes(useFlowStore.getState().nodes.filter((n) => n.id !== 'b'));
      act(() => {
        press('z', { ctrlKey: true, target: input });
      });
      expect(useFlowStore.getState().nodes).toHaveLength(1); // 未 undo
      input.remove();
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('Esc → closeDrawer', async () => {
    const root = await mountKeyboard();
    try {
      useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
      act(() => {
        press('Escape');
      });
      expect(useCanvasStore.getState().drawer).toBe(null);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
