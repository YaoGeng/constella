// 装配模块导出面（T5-11——batch-3 硬接线清单落位；T5-03 同波不触本目录，workshop 装配归 T5-03）。
export { createLandEdgesBinder } from './land-edges';
export { wireRealFlowSwitcher } from './flow-switcher';
export type { AssemblyFlowSwitcherFace, AssemblyStorageFace, RealFlowSwitcherWiring } from './flow-switcher';
export { createMarketAssembly } from './market-assembly';
export type { MarketAssembly, MarketAssemblyBridge, MarketAssemblyDeps } from './market-assembly';
