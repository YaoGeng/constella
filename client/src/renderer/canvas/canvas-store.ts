// canvasStore —— 画布 UI 态 store（T3-01；C-01 §3 canvasStore 行、02 §3.3）。
//
// 职责：viewport / selection（单值——A-17.3 多选排除 V1）/ drawer 态 / 编辑模式位。
// **不入历史**（zundo temporal 只挂 flowStore 的 nodes/edges——T3-05；画布 UI 态
// 参与 undo 会把「选中了谁」混进文档历史，S-1 ④ 同源规避）。
import { create } from 'zustand';
import type { Viewport } from '@xyflow/react';

/** 抽屉态（C-01 §3 DrawerShell 行接口：{mode,nodeId?,pos?}——宿主随 T3-08 落位，本卡先立 store 形）。 */
export interface DrawerState {
  mode: 'create' | 'edit' | 'readonly';
  nodeId?: string;
  /** create 态落点（世界坐标；双击空白按世界坐标开抽屉——demo L1561-1569 语义，T3-08 消费）。 */
  pos?: { x: number; y: number };
}

export interface CanvasStore {
  viewport: Viewport | null;
  /** 选中节点单值：setSelection 直接替换（多选 V2 候选，A-17.3）。 */
  selection: string | null;
  drawer: DrawerState | null;
  /** 编辑模式位（运行态编辑闸——InteractionMachine/DrawerShell 消费，A-5.1）。 */
  editMode: boolean;
  setViewport(viewport: Viewport): void;
  setSelection(nodeId: string | null): void;
  openDrawer(drawer: DrawerState): void;
  closeDrawer(): void;
  setEditMode(editMode: boolean): void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  viewport: null,
  selection: null,
  drawer: null,
  editMode: true,
  setViewport: (viewport) => set({ viewport }),
  setSelection: (nodeId) => set({ selection: nodeId }),
  openDrawer: (drawer) => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  setEditMode: (editMode) => set({ editMode }),
}));
