// uiStore —— 最小 zustand 实现（T6-10 交付；02 §3.3 uiStore 行的**任务中心开合位切片**）。
//
// ⚠ 处置说明：02 §3.3 定义完整 uiStore（弹窗/任务中心/广场开关、toast 队列），renderer 此前
// 无实现（canvas/toast.tsx 为画布域自持队列）。本卡按任务卡指示以最小实现交付——仅任务中心
// 开合位；文件落本模块（taskcenter/），已登记给 T6-17 应用壳：并入/上移完整 uiStore 时保留
// 本切片语义（open/close/toggle 三通道），消费方（TaskCenterPanel）经 useUiStore 不变。
import { create } from 'zustand';

export interface UiStoreState {
  /** 任务中心抽屉开合位（TaskCenterPanel 唯一开合数据源——§3「无 props（开合态=uiStore）」） */
  taskCenterOpen: boolean;
  openTaskCenter(): void;
  closeTaskCenter(): void;
  /** 导航「任务中心」点击位（再点导航=关——demo L2670 toggle 语义；挂载归应用壳 T6-17） */
  toggleTaskCenter(): void;
  /** 测试隔离 */
  reset(): void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  taskCenterOpen: false,
  openTaskCenter: () => set({ taskCenterOpen: true }),
  closeTaskCenter: () => set({ taskCenterOpen: false }),
  toggleTaskCenter: () => set((s) => ({ taskCenterOpen: !s.taskCenterOpen })),
  reset: () => set({ taskCenterOpen: false }),
}));
