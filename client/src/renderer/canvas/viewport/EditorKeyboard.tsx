// EditorKeyboard —— 画布快捷键（T3-06；C-01 §3 EditorKeyboard 行；01 A-3.5；demo L1570-1585）。
//
// Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）撤销重做、Ctrl+S 保存（doSave 编排=T1-08 注入位——onSave
// 未注入时仅 preventDefault 防浏览器默认）、Delete/Backspace 删选中节点（编辑态＋非运行；
// 单历史项=flowStore.setNodes 由 zundo 捕捉）、Esc 关抽屉（run-win/modal 随 P4/P5 域接线）。
// 焦点守卫：matches('input,textarea,select') 时编辑类快捷键不触发（A-3.5）。Space pan 由
// xyflow panActivationKeyCode 承担（T3-04），此处不重复。
import { useEffect } from 'react';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

export interface EditorKeyboardProps {
  /** Ctrl+S 编排注入位（T1-08 SaveOrchestrator doSave——产品壳装配）。 */
  onSave?: () => void;
}

/** 焦点守卫（A-3.5：表单聚焦时编辑快捷键失效；demo matches('input,textarea,select')）。 */
function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('input,textarea,select');
}

export function EditorKeyboard({ onSave }: EditorKeyboardProps) {
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey;
      const { undo, redo, running, dirty } = useFlowStore.getState();
      const { editMode, selection, closeDrawer } = useCanvasStore.getState();
      const guarded = isFormTarget(ev.target);

      if (ev.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (guarded) return; // 表单聚焦：以下编辑类快捷键不触发

      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selection && editMode && !running) {
          ev.preventDefault();
          // 删选中节点＋相邻边（组合 action 单历史项；demo deleteNode 语义）
          useFlowStore.getState().removeNodeCascade(selection);
          useCanvasStore.getState().setSelection(null);
        }
        return;
      }
      if (mod && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
        ev.preventDefault();
        if (!running) undo();
        return;
      }
      if (mod && ((ev.key === 'y' || ev.key === 'Y') || (ev.key === 'Z' && ev.shiftKey))) {
        ev.preventDefault();
        if (!running) redo();
        return;
      }
      if (mod && (ev.key === 's' || ev.key === 'S')) {
        ev.preventDefault();
        if (dirty) onSave?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onSave]);

  return null;
}
