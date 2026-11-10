// C-12 SkyBackground barrel（TDD-C-12 §1 对外面；应用壳 T6-17 经此消费 <SkyBackground/>）。
// 通道面（window.__skyCtl/__skyReady）不经 barrel——C-11 经 window 通道调用，两端零 import 边（P-3）。
export { SkyBackground } from './sky-background';
export type { SkyLayerKey, DensKey, SkyControl } from './types';
export { SKY_LAYER_KEYS, SKY_DENS_KEYS } from './types';
