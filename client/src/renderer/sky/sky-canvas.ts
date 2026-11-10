// C-12 SkyCanvas（TDD-C-12 §3）：全屏 fixed canvas 宿主装配（demo L3134-3155 状态面 +
// L430-435 CSS + L4726-4754 交互/尺寸 + L4755-4759 启动序列，1:1 移植）＋ SkyState 类型面。
// 视口重建（demo L4740 注释原文）：attribute 尺寸 = CSS×DPR（上限 2），上下文按 DPR 缩放 ——
// fixed 全屏 canvas 必须显式 CSS width/height:100%，否则高 DPR 真机上按物理像素渲染溢出。
// 结构差（对照表登记）：demo 模块级可变状态 → 每挂载 SkyState（React 卸载生命周期）；
// resize/pointermove/pointerdown 监听与 180ms 防抖于此装配（pointerdown 归 MeteorsSatellites）。
import { SKY_LAYER_KEYS, SKY_DENS_KEYS, type SkyLayerKey, type DensKey } from './types';
import { PALETTE, buildPickPool, makeSprite } from './utils';
import { makeHaloSprite } from './m31-prerender';
import { buildSky } from './galaxy-builder';
import { buildScene } from './scene-builder';
import type { Star, Hero, Pulse, Cluster, BandStar, Mini, GasPuff, MegaPuff, DiskSprite } from './scene-builder';
import type { Meteor } from './meteors-satellites';
import { attachSummon } from './meteors-satellites';
import { createFrameLoop } from './sky-frame-loop';
import { createControlChannel } from './control-channel';
import { createMotionGate, type MotionGate } from './motion-gate';

/* ---------------- SkyState（demo L3139-3155 模块级状态的实例化） ---------------- */
export interface SkyState {
  win: Window;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;                                     // demo L3135（alpha:false）
  sky: HTMLCanvasElement;                                            // 离屏：深空底色+银河带+尘埃消光+星云+微星（demo L3136）
  sctx: CanvasRenderingContext2D;
  airGlow: HTMLCanvasElement;                                        // 每帧背景气晖低分辨率层（消除渐变抖动，demo L3141）
  airCtx: CanvasRenderingContext2D;
  glow: HTMLCanvasElement;                                           // 柔光层（demo L4088）
  gctx: CanvasRenderingContext2D;
  W: number; H: number; DPR: number; ODPR: number;                   // demo L3139
  skyW: number; skyH: number;                                        // demo L3140
  stars: Star[]; heroes: Hero[]; meteors: Meteor[]; pulses: Pulse[]; // demo L3143
  clusters: Cluster[]; gas: GasPuff[];
  mega: MegaPuff[]; minis: Mini[]; miniSprites: HTMLCanvasElement[] | null;   // demo L3144
  bandStars: BandStar[];                                             // demo L3145
  diskBig: DiskSprite | null; diskSmall: DiskSprite | null;          // demo L3146
  haloSprite: HTMLCanvasElement | null;                              // demo L3147
  bandL: number; bandBw: number;                                     // demo L3148
  sprites: HTMLCanvasElement[]; pickPool: number[];                  // demo L3149
  gasSprites: Map<string, HTMLCanvasElement>;                        // demo L3213（模块级 → 实例）
  px: number; py: number; tx: number; ty: number;                    // 视差：平滑值/目标值（demo L3150）
  nextMeteor: number; nextSat: number;                               // demo L3151
  PAUSED: boolean;                                                   // demo L3152
  LAYER: Record<SkyLayerKey, boolean>;                               // demo L3153-3154（12 键全开）
  DENS: Record<DensKey, number>;                                     // demo L3155（DENS..DENS7 全 1 的 Record 化）
  REDUCED: boolean;                                                  // demo L3132（MotionGate 求值）
  last: number;                                                      // demo L4493
  rafId: number;                                                     // 卸载 cancel 用（03 §1 生命周期补齐）
}

/* ---------------- 星空 CSS（demo L430-435 原文；暗角/开场渐隐） ---------------- */
export const SKY_CSS =
  '#sky{position:fixed;inset:0;z-index:0;display:block;width:100%;height:100%;cursor:crosshair}\n' +
  '#vignette{position:fixed;inset:0;z-index:0;pointer-events:none;\n' +
  '  background:radial-gradient(ellipse 95% 95% at 50% 46%,transparent 62%,rgba(1,2,10,.38) 100%)}\n' +
  '#fade{position:fixed;inset:0;z-index:0;pointer-events:none;background:#000;animation:fadeout 2.4s ease .2s forwards}\n' +
  '@keyframes fadeout{to{opacity:0}}';

const SKY_STYLE_SEL = 'style[data-constella-sky]';
function installSkyCss(win: Window): void {
  if (win.document.querySelector(SKY_STYLE_SEL)) return;            // 幂等（重复挂载）
  const el = win.document.createElement('style');
  el.dataset.constellaSky = '1';
  el.textContent = SKY_CSS;
  win.document.head.appendChild(el);
}
function uninstallSkyCss(win: Window): void {
  win.document.querySelector(SKY_STYLE_SEL)?.remove();
}

/* ---------------- 视口重建（demo L4741-4752） ---------------- */
export function resize(s: SkyState): void {
  s.W = s.win.innerWidth; s.H = s.win.innerHeight;                  // demo L4742
  if (s.W < 50 || s.H < 50) return;
  if (!s.haloSprite) s.haloSprite = makeHaloSprite();
  s.DPR = Math.min(s.win.devicePixelRatio || 1, 2);                  // DPR 上限 2（demo L4745）
  s.ODPR = Math.min(s.DPR, 1.5);
  s.canvas.width = Math.round(s.W * s.DPR);
  s.canvas.height = Math.round(s.H * s.DPR);
  s.ctx.setTransform(s.DPR, 0, 0, s.DPR, 0, 0);
  buildSky(s);
  buildScene(s);
}

/* ---------------- 挂载/卸载（demo 启动序列 L4755-4759 + 监听段 L4726-4753） ---------------- */
export interface SkyHandle {
  s: SkyState;
  start(): void;
  stop(): void;
  dispose(): void;
}

export function mountSky(canvas: HTMLCanvasElement): SkyHandle {
  const win = window;                                                // renderer 单窗口（demo 同用全局 addEventListener/innerWidth）
  const s: SkyState = {
    win, canvas,
    ctx: canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D,   // demo L3135
    sky: win.document.createElement('canvas'), sctx: null as unknown as CanvasRenderingContext2D,
    airGlow: win.document.createElement('canvas'), airCtx: null as unknown as CanvasRenderingContext2D,
    glow: win.document.createElement('canvas'), gctx: null as unknown as CanvasRenderingContext2D,
    W: 0, H: 0, DPR: 1, ODPR: 1,                                     // demo L3139
    skyW: 0, skyH: 0,
    stars: [], heroes: [], meteors: [], pulses: [], clusters: [], gas: [],   // demo L3143
    mega: [], minis: [], miniSprites: null,                          // demo L3144
    bandStars: [],
    diskBig: null, diskSmall: null,
    haloSprite: null,
    bandL: 0, bandBw: 0,
    sprites: [], pickPool: [],
    gasSprites: new Map(),
    px: 0, py: 0, tx: 0, ty: 0,
    nextMeteor: 1.4, nextSat: 26,                                    // demo L3151
    PAUSED: false,
    LAYER: Object.fromEntries(SKY_LAYER_KEYS.map(k => [k, true])) as Record<SkyLayerKey, boolean>,   // demo L3153-3154
    DENS: Object.fromEntries(SKY_DENS_KEYS.map(k => [k, 1])) as Record<DensKey, number>,            // demo L3155
    REDUCED: false,
    last: win.performance.now(),                                     // demo L4493
    rafId: 0,
  };
  s.sctx = s.sky.getContext('2d') as CanvasRenderingContext2D;
  s.airCtx = s.airGlow.getContext('2d') as CanvasRenderingContext2D;
  s.gctx = s.glow.getContext('2d') as CanvasRenderingContext2D;

  const gate: MotionGate = createMotionGate(win);                    // demo L3132（REDUCED 求值）
  s.REDUCED = gate.reduced();

  buildPickPool(s);                                                  // demo L4756
  s.sprites = PALETTE.map(p => makeSprite(p.c));                     // demo L4757

  installSkyCss(win);
  gate.installCss();                                                 // prefers-reduced-motion 0.01ms 双路降级（demo L579-581）

  // 交互：点在星空上召唤流星（点 UI 不触发，demo L4729-4732）；视差跟随 pointermove（LAYER.parallax 可关，L4733-4737）
  const offSummon = attachSummon(s, win);
  const onMove = (e: PointerEvent) => {
    if (!s.LAYER.parallax) { s.tx = 0; s.ty = 0; return; }
    s.tx = (e.clientX / s.W) * 2 - 1;
    s.ty = (e.clientY / s.H) * 2 - 1;
  };
  win.addEventListener('pointermove', onMove);

  // resize 180ms 防抖重建（demo L4739/L4753）
  let rsTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => { if (rsTimer) clearTimeout(rsTimer); rsTimer = setTimeout(() => resize(s), 180); };
  win.addEventListener('resize', onResize);

  resize(s);                                                         // demo L4758
  const loop = createFrameLoop(s, win);
  const channel = createControlChannel(s, () => resize(s));          // demo L4761-4776（含 __skyReady 触发）
  loop.start();                                                      // demo L4759 requestAnimationFrame(frame)

  return {
    s,
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose() {                                                      // 卸载=cancelAnimationFrame+移除监听（03 §1）
      loop.stop();
      offSummon();
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('resize', onResize);
      if (rsTimer) clearTimeout(rsTimer);
      channel.unregister();
      gate.uninstallCss();
      uninstallSkyCss(win);
    },
  };
}
