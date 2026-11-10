// C-12 GalaxyBuilder（TDD-C-12 §3）：buildSky 离屏银河（demo L4087-4254，入口 L4096，1:1 移植）。
// 离屏银河合成（demo L4091-4095 注释原文）：
//   ① 柔光层 glow（半分辨率）：深空底色烘入 + 银河带辉光/氛围色 + 银心暖流云团（DENS7）
//      + 尘埃暗带 multiply 消光掩码（fbm 体积场，蓝端衰减最强 → 暗核呈暖棕）
//   ② 高质量放大合成到天空层（blur 抹平渐变 dither 网格）
//   ③ 星点层全分辨率：银道星流 / 暗带内微星 / 全天散布微星（DENS2），逐星尘埃消光
// 与 demo 的结构差：模块级 canvas（sky/glow）与 gas 池挂 SkyState；DENS2/DENS7 →
// s.DENS.band / s.DENS.gas（demo L3155 标量的 Record 化，语义等价）。
import type { SkyState } from './sky-canvas';
import { buildDisks } from './m31-prerender';
import { dustAt } from './noise-field';
import { BAND_ANGLE, TAU, gauss, rand, pickColor, blob } from './utils';
import type { GasPuff } from './scene-builder';

export function buildSky(s: SkyState): void {                        // demo L4096
  const m = 1.12;
  s.skyW = Math.round(s.W * m);
  s.skyH = Math.round(s.H * m);
  s.sky.width = Math.round(s.skyW * s.ODPR);
  s.sky.height = Math.round(s.skyH * s.ODPR);
  const GS = 0.5;
  s.glow.width = Math.max(2, Math.round(s.skyW * GS * s.ODPR));
  s.glow.height = Math.max(2, Math.round(s.skyH * GS * s.ODPR));

  const L = Math.hypot(s.skyW, s.skyH) * 0.55;
  const bw = Math.min(s.skyW, s.skyH) * 0.15;
  const xc = L * 0.34;
  s.bandL = L; s.bandBw = bw;

  const q = s.gctx;
  q.setTransform(GS * s.ODPR, 0, 0, GS * s.ODPR, 0, 0);
  q.globalCompositeOperation = 'source-over';
  const bgr = q.createRadialGradient(s.skyW / 2, s.skyH * .44, 0, s.skyW / 2, s.skyH / 2, Math.hypot(s.skyW, s.skyH) * .62);
  bgr.addColorStop(0, '#0a1226');
  bgr.addColorStop(.5, '#060b1c');
  bgr.addColorStop(1, '#03050e');
  q.fillStyle = bgr;
  q.fillRect(0, 0, s.skyW, s.skyH);
  q.save();
  q.translate(s.skyW / 2, s.skyH / 2);
  q.rotate(BAND_ANGLE);
  q.globalCompositeOperation = 'lighter';

  const washes: [string, number][] = [['62,104,152', .05], ['118,80,118', .042], ['56,90,146', .038], ['146,92,116', .03]];
  for (const [col, a] of washes)
    blob(q, rand(-L, L) * .7, rand(-s.skyH / 2, s.skyH / 2), rand(L * .5, L), col, a);

  const bandCols = ['110,135,235', '125,145,235', '135,120,230', '150,130,230', '105,150,225'];
  for (let i = 0, n = L * 0.11; i < n; i++)
    blob(q, rand(-L, L), gauss() * bw, rand(bw * .45, bw * 1.1),
         bandCols[(Math.random() * bandCols.length) | 0]!, rand(.012, .026));

  for (let i = 0, n = L * 0.085; i < n; i++)
    blob(q, rand(-L, L), gauss() * bw * .5, rand(bw * .2, bw * .55),
         Math.random() < .7 ? '140,180,255' : '190,195,255', rand(.02, .042));

  for (let i = 0, n = L * 0.1; i < n; i++)
    blob(q, rand(-L, L), gauss() * bw * .33, rand(5, 16), '185,210,255', rand(.045, .1));

  s.gas = [];
  const addPuff = (bx: number, by: number, r: number, col: string, a: number, mob: number) => s.gas.push({
    bx, by, r, col, a,
    ox: mob * rand(.5, 1), oy: mob * rand(.45, .9),
    w1: TAU / rand(16, 40), w2: TAU / rand(16, 40),
    p1: rand(0, TAU), p2: rand(0, TAU),
    bA: rand(.18, .38), bW: TAU / rand(5, 14), bP: rand(0, TAU),
  } satisfies GasPuff);
  addPuff(xc + gauss() * bw * .1, gauss() * bw * .15, bw * 3.4, '255,205,150', .14, bw * .1);
  addPuff(xc + gauss() * bw * .08, gauss() * bw * .1,  bw * 2.0, '255,228,185', .17, bw * .07);
  for (let i = 0, n = Math.round(130 * s.DENS.gas); i < n; i++)
    addPuff(xc + gauss() * bw * .6, gauss() * bw * .45, rand(bw * .18, bw * .6), '255,220,170', rand(.03, .065), bw * rand(.06, .16));
  for (let i = 0, n = Math.round(50 * s.DENS.gas); i < n; i++)
    addPuff(xc + rand(-bw * 2.2, bw * 3.6), gauss() * bw * .4,
            rand(bw * .14, bw * .45), Math.random() < .6 ? '255,214,160' : '255,232,190',
            rand(.03, .06), bw * rand(.08, .2));

  const MS = .36;
  const vMax = bw * 2.2;
  const mW = Math.max(2, Math.round(2 * L * MS));
  const mH = Math.max(2, Math.round(2 * vMax * MS));
  const mask = document.createElement('canvas');
  mask.width = mW;
  mask.height = mH;
  const mx = mask.getContext('2d')!;
  const img = mx.createImageData(mW, mH);
  const dd = img.data;
  let mi = 0;
  for (let j = 0; j < mH; j++) {
    const v = -vMax + (j + .5) / MS;
    for (let i = 0; i < mW; i++, mi += 4) {
      const d = dustAt(s, -L + (i + .5) / MS, v);
      dd[mi]     = 255 * (1 - .8 * d) | 0;
      dd[mi + 1] = 255 * (1 - .9 * d) | 0;
      dd[mi + 2] = 255 * (1 - .985 * d) | 0;
      dd[mi + 3] = 255;
    }
  }
  mx.putImageData(img, 0, 0);
  q.globalCompositeOperation = 'multiply';
  q.drawImage(mask, -L, -vMax, 2 * L, 2 * vMax);
  q.restore();
  q.globalCompositeOperation = 'source-over';

  const g = s.sctx;
  g.setTransform(s.ODPR, 0, 0, s.ODPR, 0, 0);
  g.clearRect(0, 0, s.skyW, s.skyH);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.filter = 'blur(1.6px)';
  g.drawImage(s.glow, 0, 0, s.skyW, s.skyH);
  g.filter = 'none';
  g.restore();

  g.save();
  g.translate(s.skyW / 2, s.skyH / 2);
  g.rotate(BAND_ANGLE);
  g.globalCompositeOperation = 'lighter';

  for (let i = 0, n = L * 2.4 * s.DENS.band | 0; i < n; i++) {
    const x = rand(-L, L);
    const y = gauss() * bw * .5;
    const nearCore = Math.abs(x - xc) < bw * 1.6;
    let a = Math.random() < .12 ? rand(.55, .9) : rand(.14, .55);
    if (nearCore) a = Math.min(1, a * 1.2);
    const dk = dustAt(s, x, y);
    if (dk > .02) {
      a *= 1 - .92 * dk;
      if (Math.random() < dk * .85) continue;
    }
    g.globalAlpha = a;
    g.fillStyle = pickColor(s);
    g.fillRect(x, y, Math.random() < .1 ? rand(1.4, 2) : 1, 1);
  }
  g.globalAlpha = 1;

  for (let i = 0, n = L * 1.7 * s.DENS.band | 0; i < n; i++) {
    const u = rand(-L, L);
    const v = Math.random() < .62
      ? -bw * .1 + gauss() * bw * .38
      : bw * .5 + gauss() * bw * .22;
    const a = Math.random() < .06 ? rand(.3, .5) : rand(.09, .34);
    g.globalAlpha = a;
    g.fillStyle = pickColor(s);
    g.fillRect(u, v, Math.random() < .08 ? rand(1.3, 1.7) : 1, 1);
  }

  for (let i = 0, n = s.skyW * s.skyH / 260 * s.DENS.band | 0; i < n; i++) {
    const fx = rand(-s.skyW / 2, s.skyW / 2), fy = rand(-s.skyH / 2, s.skyH / 2);
    let a = rand(.08, .4);
    const dk = dustAt(s, fx, fy);
    if (dk > .02) a *= 1 - .92 * dk;
    g.globalAlpha = a;
    g.fillStyle = pickColor(s);
    g.fillRect(fx, fy, Math.random() < .06 ? 1.5 : 1, 1);
  }
  g.globalAlpha = 1;
  g.globalAlpha = 1;

  g.restore();
  g.globalCompositeOperation = 'source-over';

  buildDisks(s);                                                     // demo L4244-4246（M31Prerender.buildDisks）
}
