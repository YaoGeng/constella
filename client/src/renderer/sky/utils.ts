// C-12 工具/精灵/拾取池（demo L3130-3131 常量 + L3157-3228 工具段，1:1 移植；
// 03 §7 分段清单的工具支撑段，无独立 §3 组件行——对照表登记于本文件）。
// 与 demo 的唯一结构差：模块级可变状态（pickPool/gasSprites 缓存）挂到每挂载实例的
// SkyState 上（React 挂载/卸载生命周期要求；几何/取值逐行未动）。

export const TAU = Math.PI * 2;            // demo L3130
export const BAND_ANGLE = -0.48;           // 银河带倾角（弧度），demo L3131

/* ---------------- 工具（demo L3157-3164） ---------------- */
export const rand = (a: number, b: number) => a + Math.random() * (b - a);   // demo L3158
export function gauss(): number {           // Box-Muller 正态分布，demo L3159-3164
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// 真实恒星色温谱：O/B 蓝 → A 白 → G 黄白 → K 金 → M 橙红（demo L3166-3176）
export interface PaletteEntry { c: string; w: number; rgb?: string }
export const PALETTE: PaletteEntry[] = [
  { c: '150,190,255', w: 3 },
  { c: '200,222,255', w: 6 },
  { c: '235,242,255', w: 7 },
  { c: '255,255,255', w: 5 },
  { c: '255,246,224', w: 6 },
  { c: '255,226,190', w: 4 },
  { c: '255,198,152', w: 2 },
  { c: '255,172,140', w: 1 },
];

/** 拾取池宿主（SkyState 的结构性子集） */
export interface PickPoolHolder { pickPool: number[] }

export function buildPickPool(s: PickPoolHolder): void {   // demo L3177-3181
  s.pickPool = [];
  PALETTE.forEach((p, i) => { for (let k = 0; k < p.w; k++) s.pickPool.push(i); });
  PALETTE.forEach(p => { p.rgb = 'rgb(' + p.c + ')'; });
}
export const pickColor = (s: PickPoolHolder) =>
  PALETTE[s.pickPool[(Math.random() * s.pickPool.length) | 0] ?? 0]!.c;   // demo L3182

/* ---------------- 精灵贴图（demo L3184-3218） ---------------- */
// 预渲染星点光晕贴图（白核 + 色温晕），demo L3185-3198
export function makeSprite(col: string): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0.00, 'rgba(255,255,255,1)');
  gr.addColorStop(0.10, 'rgba(255,255,255,.95)');
  gr.addColorStop(0.24, 'rgba(' + col + ',.6)');
  gr.addColorStop(0.52, 'rgba(' + col + ',.14)');
  gr.addColorStop(1.00, 'rgba(' + col + ',0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return s;
}

// 气体云絮贴图：纯色柔边衰减（无白核），demo L3200-3212
export function makeGlowSprite(col: string): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(' + col + ',.9)');
  gr.addColorStop(.35, 'rgba(' + col + ',.38)');
  gr.addColorStop(.7, 'rgba(' + col + ',.1)');
  gr.addColorStop(1, 'rgba(' + col + ',0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return s;
}

/** 云絮缓存宿主（SkyState 的结构性子集；demo L3213 模块级 Map → 每挂载实例） */
export interface GasSpriteHolder { gasSprites: Map<string, HTMLCanvasElement> }
export function gasSprite(s: GasSpriteHolder, col: string): HTMLCanvasElement {   // demo L3214-3218
  let c = s.gasSprites.get(col);
  if (!c) { c = makeGlowSprite(col); s.gasSprites.set(col, c); }
  return c;
}

/** 柔和径向光斑（demo L3220-3228） */
export function blob(
  g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number,
): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(' + col + ',' + a + ')');
  gr.addColorStop(1, 'rgba(' + col + ',0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}
