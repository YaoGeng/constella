// shell-store —— 应用壳 UI 态（T6-17；02 §3.3 uiStore 的壳层切片：弹窗/面板开合位）。
//   最小实现口径同 taskcenter/ui-store（T6-10 处置说明）：完整 uiStore（toast 队列并入等）
//   归后续卡；本切片只承载 T6-17 挂载面所需开合位＋autoSave 徽标镜像（dispatcher
//   onAutoSaveChange 联动位——demo L2747-2752 updateAsBadge）。
//   工坊预填（workshopPrefill）＝「让 AI 开发」跳工坊事件的载荷面（DrawerShell 经
//   CustomEvent 抛事件——P-3 无 import 边，panToNode 事件锚同款惯例）。
import { create } from 'zustand';

export interface ShellStoreState {
  /** 工坊面板开合位（右栏 rail——demo switchRail('node')） */
  workshopOpen: boolean;
  /** 工坊输入框预填（打开事件携带——demo L2097 chatInput 预填；消费即清） */
  workshopPrefill: string;
  /** 广场弹窗开合位（MarketBrowser） */
  marketOpen: boolean;
  /** 设置弹窗开合位（SettingsDialog 受控 open——T6-12 ⚠ 留位兑现） */
  settingsOpen: boolean;
  /** 流程日志面板开合位（FlowLogPanel 画布右下挂载） */
  flowLogOpen: boolean;
  /** autoSave 底栏徽标镜像（dispatcher.onAutoSaveChange 写入——demo L2747-2752） */
  autoSaveOn: boolean;
  /** InstallConfirm 弹窗在场位（escGate 上层浮层仲裁输入之一） */
  confirmPending: boolean;
  openWorkshop(prefill?: string): void;
  closeWorkshop(): void;
  consumeWorkshopPrefill(): string;
  openMarket(): void;
  closeMarket(): void;
  openSettings(): void;
  closeSettings(): void;
  toggleFlowLog(): void;
  closeFlowLog(): void;
  setAutoSaveOn(on: boolean): void;
  setConfirmPending(pending: boolean): void;
  reset(): void;
}

export const useShellStore = create<ShellStoreState>((set, get) => ({
  workshopOpen: false,
  workshopPrefill: '',
  marketOpen: false,
  settingsOpen: false,
  flowLogOpen: false,
  autoSaveOn: false,
  confirmPending: false,

  openWorkshop: (prefill) => set({ workshopOpen: true, ...(prefill !== undefined ? { workshopPrefill: prefill } : {}) }),
  closeWorkshop: () => set({ workshopOpen: false }),
  consumeWorkshopPrefill: () => {
    const v = get().workshopPrefill;
    if (v !== '') set({ workshopPrefill: '' });
    return v;
  },
  openMarket: () => set({ marketOpen: true }),
  closeMarket: () => set({ marketOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleFlowLog: () => set((s) => ({ flowLogOpen: !s.flowLogOpen })),
  closeFlowLog: () => set({ flowLogOpen: false }),
  setAutoSaveOn: (on) => set({ autoSaveOn: on }),
  setConfirmPending: (pending) => set({ confirmPending: pending }),

  reset: () =>
    set({
      workshopOpen: false,
      workshopPrefill: '',
      marketOpen: false,
      settingsOpen: false,
      flowLogOpen: false,
      autoSaveOn: false,
      confirmPending: false,
    }),
}));
