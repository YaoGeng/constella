// C-12 SceneBuilder（TDD-C-12 §3）：buildScene 动态实体（demo L4255-4449，入口 L4257，1:1 移植）。
// 动态实体布点（demo L4256 注释原文）：闪烁星场(DENS) / 亮星星芒(DENS3) / 呼吸星云 / 动态星团(DENS4)
// / 银道微星(DENS2) / 迷你星系(DENS5，best-candidate 均匀采样防扎堆) / 流星卫星。
// 结构差：实体池挂 SkyState；DENS..DENS7 → s.DENS.stars/band/heroes/clusters/minis/mega/gas。
import type { SkyState } from './sky-canvas';
import { TAU, BAND_ANGLE, rand, gauss, pickColor } from './utils';
import { dustAt } from './noise-field';
import { makeMiniDiskSprite, type DiskSprite } from './m31-prerender';

/* ---------------- 场景实体类型（demo 对象字面量的形状化） ---------------- */
export interface Star { x: number; y: number; r: number; pi: number; base: number; tw: number; ph: number; par: number; glint: boolean }
export interface Hero { x: number; y: number; r: number; col: string; spike: number; tw: number; ph: number; par: number; diag: boolean; streak: boolean }
export interface Pulse { fx: number; fy: number; col: string; rf: number; sp: number; ph: number }
export interface ClusterMember { dx: number; dy: number; pi: number; sz: number; ssz: number; base: number; tw: number; ph: number; glint: boolean }
export interface Cluster { x: number; y: number; occ: number; members: ClusterMember[]; haloR: number; par: number; hb: number; hph: number }
export interface BandStar { u: number; v: number; pi: number; sz: number; base: number; tw: number; ph: number; glint: boolean; occ: number }
export interface Mini {
  sp: HTMLCanvasElement; cx: number; cy: number; sc: number; tilt: number; sq: number;
  r0: number; rw: number; al: number; bA: number; bW: number; bP: number;
  sB: number; sW: number; sP: number;
}
export interface PuffPhase {
  ox: number; oy: number; w1: number; w2: number; p1: number; p2: number;
  bA: number; bW: number; bP: number;
}
export interface GasPuff extends PuffPhase { bx: number; by: number; r: number; col: string; a: number }
export interface MegaPuff extends PuffPhase { sx: number; sy: number; r: number; col: string; a: number }
export type { DiskSprite }

export function buildScene(s: SkyState): void {                      // demo L4257
  s.stars = [];
  for (let i = 0, n = Math.min(2200, s.W * s.H / 1400 * s.DENS.stars | 0); i < n; i++) {
    const roll = Math.random();
    const r = roll < .78 ? rand(.45, .85) : roll < .94 ? rand(.9, 1.6) : roll < .99 ? rand(1.6, 2.3) : rand(2.3, 3);
    s.stars.push({
      x: rand(0, s.W), y: rand(0, s.H), r,
      pi: s.pickPool[(Math.random() * s.pickPool.length) | 0] ?? 0,
      base: r > 2.2 ? rand(.75, .95) : r > 1.4 ? rand(.5, .8) : rand(.25, .6),
      tw: rand(.4, 2.4), ph: rand(0, TAU),
      par: rand(.25, 1),
      glint: Math.random() < .06,
    });
  }
  s.heroes = [];
  for (let i = 0, n = Math.min(30, (14 + (s.W * s.H / 140000 | 0)) * s.DENS.heroes | 0); i < n; i++) {
    s.heroes.push({
      x: rand(s.W * .04, s.W * .96), y: rand(s.H * .05, s.H * .95),
      r: rand(1.0, 2.3), col: pickColor(s),
      spike: rand(14, 36),
      tw: rand(.3, 1.2), ph: rand(0, TAU),
      par: rand(.8, 1.4),
      diag: Math.random() < .3,
      streak: Math.random() < .35,
    });
  }
  s.pulses = [
    { fx: .78, fy: .24, col: '170,60,255',  rf: .34, sp: .13, ph: 0 },
    { fx: .16, fy: .7,  col: '30,170,255',  rf: .3,  sp: .09, ph: 2 },
    { fx: .55, fy: .52, col: '255,60,170',  rf: .24, sp: .11, ph: 4 },
    { fx: .38, fy: .16, col: '40,230,220',  rf: .2,  sp: .08, ph: 1.2 },
  ];

  s.clusters = [];
  const cN = Math.max(0, Math.round(4 * s.DENS.clusters));
  for (let c = 0; c < cN; c++) {
    const x = rand(-s.bandL * .6, s.bandL * .8);
    const y = Math.random() < .7 ? gauss() * s.bandBw * .5 : rand(-s.skyH * .3, s.skyH * .3);
    const occ = 1 - .92 * dustAt(s, x, y);
    if (occ < .22) continue;
    const spread = rand(16, 40), members: ClusterMember[] = [];
    for (let i = 0, n = rand(70, 140) | 0; i < n; i++) {
      const roll = Math.random();
      const pi = Math.random() < .72
        ? s.pickPool[(Math.random() * 21) | 0] ?? 0
        : s.pickPool[21 + ((Math.random() * 13) | 0)] ?? 0;
      members.push({
        dx: gauss() * spread, dy: gauss() * spread,
        pi,
        sz: roll < .85 ? 1 : roll < .97 ? rand(1.5, 1.9) : 0,
        ssz: rand(9, 15),
        base: roll < .97 ? rand(.3, .8) : rand(.55, .9),
        tw: rand(.4, 2.2), ph: rand(0, TAU),
        glint: Math.random() < .05,
      });
    }
    s.clusters.push({
      x, y, occ, members,
      haloR: rand(24, 50),
      par: rand(1, 1.35),
      hb: rand(.4, .9), hph: rand(0, TAU),
    });
  }
  s.meteors = [];
  s.bandStars = [];
  for (let i = 0, n = Math.min(2800, s.bandL * 2.1 * s.DENS.band | 0); i < n; i++) {
    const u = rand(-s.bandL, s.bandL);
    const v = gauss() * s.bandBw * .55;
    s.bandStars.push({
      u, v,
      pi: Math.random() < .72 ? s.pickPool[(Math.random() * 21) | 0] ?? 0 : s.pickPool[21 + ((Math.random() * 13) | 0)] ?? 0,
      sz: Math.random() < .85 ? 1 : 1.5,
      base: rand(.3, .8),
      tw: rand(.4, 2.2), ph: rand(0, TAU),
      glint: Math.random() < .05,
      occ: 1 - .92 * dustAt(s, u, v),
    });
  }
  buildMegaNebulae(s);
  s.minis = [];
  const S = Math.min(s.W, s.H);
  if (!s.miniSprites) s.miniSprites = [];
  const regions = megaDefs(s).map(d => ({ x: d.fx * s.W, y: d.fy * s.H, R: d.rf * S }));
  const c0 = Math.cos(BAND_ANGLE), s0 = Math.sin(BAND_ANGLE);
  const yc = s.bandL * .34;
  regions.push({ x: s.W / 2 + yc * c0, y: s.H / 2 + yc * s0, R: s.bandBw * 2.2 });
  const n = Math.max(2, (16 + (Math.random() * 5 | 0)) * s.DENS.minis | 0);
  while (s.miniSprites.length < n) s.miniSprites.push(makeMiniDiskSprite(s.miniSprites.length));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    let best: { x: number; y: number } | null = null, bestD = -1;
    for (let k = 0; k < (i === 0 ? 1 : 12); k++) {
      const rg = regions[(Math.random() * regions.length) | 0]!;
      const ang = rand(0, TAU);
      const rad = rg.R * (.2 + .6 * Math.pow(Math.random(), .7));
      const cx = rg.x + Math.cos(ang) * rad * 1.1;
      const cy = rg.y + Math.sin(ang) * rad * .9;
      let d = Infinity;
      for (const p of pts) {
        const dd = (cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y);
        if (dd < d) d = dd;
      }
      if (d > bestD) { bestD = d; best = { x: cx, y: cy }; }
    }
    pts.push(best!);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    s.minis.push({
      sp: s.miniSprites[i % s.miniSprites.length]!,
      cx: p.x,
      cy: p.y,
      sc: rand(.35, 1.1) * S / 900,
      tilt: rand(0, TAU),
      sq: rand(.28, .58),
      r0: rand(0, TAU),
      rw: rand(-1, 1) * TAU / rand(30, 70),
      al: rand(.5, .85),
      bA: rand(.15, .3), bW: TAU / rand(10, 22), bP: rand(0, TAU),
      sB: rand(.03, .07), sW: TAU / rand(14, 26), sP: rand(0, TAU),
    });
  }
}

/* 红 / 青星云区域定义（demo L4381-4392） */
interface MegaDef {
  fx: number; fy: number; rf: number; tilt: number; sx: number; sy: number; n: number;
  base: string; mid: string[]; cores: string[]; spark: string;
}
function megaDefs(s: SkyState): MegaDef[] {
  void s;   // demo L4383 有 `const S = Math.min(W, H)` 但未使用（rf 为相对量）——1:1 保留未用形参语义
  return [
    { fx: .24, fy: .66, rf: .56, tilt: -.5,  sx: 1.22, sy: .92, n: 132,
      base: '255,30,52',  mid: ['255,72,92', '236,24,48', '255,104,80'],
      cores: ['255,164,150', '255,132,140'], spark: '110,255,240' },
    { fx: .42, fy: .24, rf: .44, tilt: .35,  sx: 1.12, sy: .95, n: 110,
      base: '24,216,232', mid: ['64,176,255', '96,240,255', '150,232,255'],
      cores: ['200,250,255', '170,245,255'], spark: '255,120,190' },
  ];
}

/* 大面积星云云絮（demo L4394-4431） */
export function buildMegaNebulae(s: SkyState): void {
  s.mega = [];
  const S = Math.min(s.W, s.H);
  const defs = megaDefs(s);
  const addPuffS = (sx: number, sy: number, r: number, col: string, a: number, mob: number) => s.mega.push({
    sx, sy, r, col, a,
    ox: mob * rand(.5, 1), oy: mob * rand(.45, .9),
    w1: TAU / rand(18, 44), w2: TAU / rand(18, 44),
    p1: rand(0, TAU), p2: rand(0, TAU),
    bA: rand(.18, .4), bW: TAU / rand(5, 14), bP: rand(0, TAU),
  } satisfies MegaPuff);
  for (const d of defs) {
    const cx = d.fx * s.W, cy = d.fy * s.H, R = d.rf * S;
    const cA = Math.cos(d.tilt), sA = Math.sin(d.tilt);
    const put = (lx: number, ly: number, r: number, col: string, a: number, mobK: number) => {
      const wx = lx * d.sx, wy = ly * d.sy;
      addPuffS(cx + wx * cA - wy * sA, cy + wx * sA + wy * cA, r, col, a, R * mobK);
    };
    put(gauss() * R * .1, gauss() * R * .08, R * .92, d.base, .1, .04);
    put(gauss() * R * .3, gauss() * R * .25, R * .5, d.mid[0]!, .075, .05);
    put(gauss() * R * .35, gauss() * R * .3, R * .42, d.mid[1]!, .065, .05);
    const p1 = rand(0, TAU), p2 = rand(0, TAU);
    const nMain = Math.max(8, Math.round(d.n * s.DENS.mega));
    for (let i = 0; i < nMain; i++) {
      const ang = rand(0, TAU);
      const env = .58 + .42 * (.5 + .5 * Math.sin(2 * ang + p1)) * (.5 + .5 * Math.sin(3 * ang + p2 + .7));
      const rad = R * (.16 + .84 * Math.pow(Math.random(), .62)) * env;
      const col = Math.random() < .62 ? d.base : d.mid[(Math.random() * d.mid.length) | 0]!;
      put(Math.cos(ang) * rad, Math.sin(ang) * rad,
          R * rand(.08, .2), col, rand(.045, .095) * (1 - .3 * rad / R), rand(.04, .1));
    }
    for (let i = 0, n = Math.round(9 * s.DENS.mega); i < n; i++)
      put(gauss() * R * .16, gauss() * R * .13, R * rand(.05, .11), d.cores[(Math.random() * d.cores.length) | 0]!, rand(.06, .11), .03);
    for (let i = 0, n = Math.max(1, Math.round(3 * s.DENS.mega)); i < n; i++)
      put(gauss() * R * .24, gauss() * R * .2, R * rand(.03, .06), d.spark, rand(.07, .1), .04);
  }
}
