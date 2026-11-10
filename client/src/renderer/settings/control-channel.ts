// window.__skyCtl / __skyReady 通道面（T6-12；TDD-C-11 §2——L3↔L4 无 import 边：星空渲染
// 本体归 C-12/T6-13，本模块只经 window 通道下发/回放，禁 import sky/canvas〔P-3〕）。
//
// 通道形=demo L4761-4776 事实源（C-12 §1 ControlChannel 行同源）：sky 脚本就绪时暴露
// __skyCtl{layer,dens,pause} 并调用 renderer 预挂的 __skyReady()（若 renderer 先加载）；
// renderer 侧（SettingsDispatcher.install）注册 __skyReady 回调、若 __skyCtl 已在则立即
// 全量回放——两端谁先加载都对齐（01 A-14.2 末条）。
/** 星空控制通道（demo L4761-4775：layer 开关/dens 密度重建/pause 省电暂停） */
export interface SkyCtlChannel {
  /** 星野层/视差开关（12 键：disk/minis/mega/gas/clusters/heroes/stars/band/pulse/meteor/sat/parallax） */
  layer(k: string, v: boolean): void;
  /** 密度重建（k=7 密度短键；p=0.1–1.0，v/100 换算） */
  dens(k: string, p: number): void;
  /** 纯黑背景暂停整帧渲染（省电，demo L4774 PAUSED） */
  pause(v: boolean): void;
}

/** sky 侧就绪回调形（renderer 挂 __skyReady；demo L4776） */
export type SkyReadyCallback = () => void;

/** 读通道（每次调用现读 window——sky 挂载时序无关；不在=未就绪返回 null） */
export function getSkyCtl(): SkyCtlChannel | null {
  const ctl = (globalThis as unknown as Record<string, unknown>).__skyCtl;
  return typeof ctl === 'object' && ctl !== null ? (ctl as SkyCtlChannel) : null;
}

/** 挂 __skyReady 回调（覆盖式——单回调面，demo 同名全局） */
export function setSkyReadyCallback(fn: SkyReadyCallback): void {
  (globalThis as unknown as Record<string, unknown>).__skyReady = fn;
}

/** 卸载 __skyReady 回调（仅当仍为本 dispatcher 所挂时清除——防误删他方回调） */
export function clearSkyReadyCallback(fn: SkyReadyCallback): void {
  const w = globalThis as unknown as Record<string, unknown>;
  if (w.__skyReady === fn) delete w.__skyReady;
}
