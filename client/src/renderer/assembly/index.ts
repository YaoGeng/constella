// 装配模块导出面（T5-11——batch-3 硬接线清单落位；T5-03 同波不触本目录，workshop 装配归 T5-03；
// T6-17——产品壳装配件〔app-runtime/app-shell/shell-store/confirm-host/workshop-panel〕落位）。
export { createLandEdgesBinder } from './land-edges';
export { wireRealFlowSwitcher } from './flow-switcher';
export type { AssemblyFlowSwitcherFace, AssemblyStorageFace, RealFlowSwitcherWiring } from './flow-switcher';
export { createMarketAssembly } from './market-assembly';
export type { MarketAssembly, MarketAssemblyBridge, MarketAssemblyDeps } from './market-assembly';
// ———— T6-17 产品壳装配 ————
export { createAppRuntime, createViewportHolder } from './app-runtime';
export type { AppRuntime, AppRuntimeDeps, ViewportFace, ViewportInstanceFace } from './app-runtime';
export { AppShell } from './app-shell';
export type { AppShellProps } from './app-shell';
export { WorkshopPanel } from './workshop-panel';
export type { WorkshopPanelProps } from './workshop-panel';
export { useShellStore } from './shell-store';
export type { ShellStoreState } from './shell-store';
export { createConfirmHost, createNotifyHost } from './confirm-host';
export type { ConfirmHost, ConfirmRequest, NotifyHost } from './confirm-host';
