// C-12 MeteorsSatellites（TDD-C-12 §3）：流星/卫星池与点击召唤（demo L4450-4472 + L4726-4732 增量③，1:1 移植）。
// 点击召唤只响应直接点在星空上的 pointerdown（e.target.id !== 'sky' 即返回）——
// UI 命中区冒泡路径不触发（demo L3127 增量③）。
import type { SkyState } from './sky-canvas';
import { TAU, rand } from './utils';

export interface Meteor {
  x: number; y: number;
  dx?: number; dy?: number;
  vx: number; vy: number;
  len?: number; life: number; t: number;
  sat?: boolean;
}

export function spawnMeteor(s: SkyState, x?: number, y?: number): void {   // demo L4451-4462
  const ang = rand(Math.PI * .3, Math.PI * .7);
  const sp = rand(900, 1700);
  const sx = x !== undefined ? x : rand(-s.W * .1, s.W * 1.1);
  const sy = y !== undefined ? y : rand(-s.H * .15, s.H * .6);
  s.meteors.push({
    x: sx - Math.cos(ang) * 60, y: sy - Math.sin(ang) * 60,
    dx: Math.cos(ang), dy: Math.sin(ang),
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    len: rand(140, 330), life: rand(.7, 1.3), t: 0,
  });
}
export function spawnSat(s: SkyState): void {                        // demo L4463-4472
  const ang = rand(0, TAU), sp = rand(45, 90);
  const edge = (Math.random() * 4) | 0;
  let sx, sy;
  if (edge === 0)      { sx = -20;    sy = rand(0, s.H); }
  else if (edge === 1) { sx = s.W + 20; sy = rand(0, s.H); }
  else if (edge === 2) { sx = rand(0, s.W); sy = -20; }
  else                 { sx = rand(0, s.W); sy = s.H + 20; }
  s.meteors.push({ x: sx, y: sy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, sat: true, t: 0, life: 30 });
}

/** 点击空白召唤（demo L4729-4732）：只有直接点在星空上才召唤流星（点在 UI 上不触发） */
export function attachSummon(s: SkyState, win: Window): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.target && (e.target as HTMLElement).id !== 'sky') return;
    if (!s.REDUCED) spawnMeteor(s, e.clientX, e.clientY);
  };
  win.addEventListener('pointerdown', onDown);
  return () => win.removeEventListener('pointerdown', onDown);
}
