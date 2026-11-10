// C-12 M31Prerender（TDD-C-12 §3）：M31_V5/V3 离屏圆盘预渲染 + 靛蓝外晕 + 迷你盘贴图
// （demo L3230-4031，1:1 移植；固定种子 31415926——每次构建几何完全一致可复现，demo L3231）。
// 另收 demo L4244-4246/4249-4253（buildSky 尾段的圆盘预渲染=§3 行的 buildDisks()）与
// L4435-4448（drawM31 合成，M31 专属帧绘制）。随机源：mulberry32(31415926) 固定流；
// 迷你盘种子=31415926+seed*7919（demo L3844）。注意 demo L3859-3875 以两实参调用种子流
// （实参被忽略、取流内下一个均匀数）——1:1 保留，mulberry32 返回签名据此收宽。
import type { SkyState } from './sky-canvas';

/* ---------------- 种子随机（demo L3232-3239） ---------------- */
export function mulberry32(seed: number): (...ignored: number[]) => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type M31Palette = [number, number, number, number][];
const M31_WARM: M31Palette = [                                       // demo L3240-3243
  [0.1, 150, 195, 255], [0.08, 130, 225, 255], [0.22, 235, 240, 250],
  [0.22, 255, 246, 224], [0.18, 255, 233, 198], [0.12, 255, 210, 160], [0.08, 255, 170, 160],
];
const M31_CLUSTER: M31Palette = [                                    // demo L3244-3247
  [0.26, 168, 205, 255], [0.16, 140, 190, 255], [0.14, 96, 224, 255], [0.12, 208, 236, 255],
  [0.12, 255, 236, 200], [0.12, 255, 214, 150], [0.08, 255, 170, 150],
];
const M31_HII: M31Palette = [                                        // demo L3248-3250
  [0.4, 255, 86, 128], [0.25, 255, 120, 150], [0.2, 240, 80, 165], [0.15, 255, 150, 110],
];
function m31Pick(rand: (...a: number[]) => number, palette: M31Palette): string {   // demo L3251-3257
  let r = rand();
  for (const [w, cr, cg, cb] of palette) {
    if ((r -= w) <= 0) return `${cr},${cg},${cb}`;
  }
  return '255,255,255';
}

/* -- v5 · 刺臂扩展版大盘（demo L3260-3541） -- */
const M31_V5 = (() => {
  const ARMS = [
    { phase: -0.5, t0: 0.25, t1: 4.4, k0: 0.38, k1: 0.97, w: 0.17 },
    { phase: -3.65, t0: 0.2, t1: 4.0, k0: 0.38, k1: 0.94, w: 0.17 },
    { phase: 0.1, t0: 0.7, t1: 2.6, k0: 0.53, k1: 0.8, w: 0.12 },
    { phase: -2.55, t0: 0.4, t1: 2.2, k0: 0.57, k1: 0.79, w: 0.12 },
    { phase: 1.9, t0: 0.5, t1: 2.3, k0: 0.55, k1: 0.82, w: 0.1 },
    { phase: -1.2, t0: 0.6, t1: 2.4, k0: 0.52, k1: 0.8, w: 0.1 },
  ];
  function armK(a: (typeof ARMS)[number], t: number) {
    return a.k0 + ((a.k1 - a.k0) * (t - a.t0)) / (a.t1 - a.t0) + Math.sin(t * 3 + a.phase) * 0.015;
  }
  function draw(canvas: HTMLCanvasElement, R: number) {
    const half = R * 1.36;
    const L = half * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(L * dpr);
    canvas.height = Math.round(L * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
    const u = L / 774;
    const rand = mulberry32(31415926);

    const softBlob = (x: number, y: number, r: number, rgb: string, a: number) => {
      if (r <= 0 || a <= 0) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(0.55, `rgba(${rgb},${(a * 0.38).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const halo = (r: number, rgb: string, a: number) => softBlob(0, 0, r, rgb, a);
    const pt = (t: number, k = 1): [number, number] => [R * k * Math.cos(t), R * k * Math.sin(t)];
    const strokeSpiral = (
      a: (typeof ARMS)[number], kOff: number, width: number, rgb: string, alpha: number,
      blur: number, tLo = a.t0, tHi = a.t1,
    ) => {
      const steps = 96;
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const t = tLo + (tHi - tLo) * p;
        const [x, y] = pt(a.phase + t, armK(a, t) + kOff);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    ctx.globalCompositeOperation = 'lighter';
    halo(R * 1.3, '96,138,235', 0.055);
    halo(R * 0.94, '128,178,252', 0.11);
    halo(R * 0.75, '160,202,250', 0.1);
    halo(R * 0.54, '250,212,164', 0.12);

    strokeSpiral(ARMS[0]!, 0, u * 0.036, '140,198,255', 0.11, u * 13);
    strokeSpiral(ARMS[1]!, 0, u * 0.032, '150,205,255', 0.1, u * 12);
    strokeSpiral(ARMS[1]!, 0.06, u * 0.022, '120,190,250', 0.055, u * 12);
    strokeSpiral(ARMS[0]!, -0.02, u * 0.02, '170,215,255', 0.05, u * 10, 0.35, 1.8);
    strokeSpiral(ARMS[2]!, 0, u * 0.022, '170,215,255', 0.06, u * 10);
    strokeSpiral(ARMS[3]!, 0, u * 0.02, '170,215,255', 0.05, u * 10);
    strokeSpiral(ARMS[4]!, 0, u * 0.018, '160,210,255', 0.045, u * 10);
    strokeSpiral(ARMS[5]!, 0, u * 0.018, '160,210,255', 0.045, u * 10);
    strokeSpiral(ARMS[0]!, 0.05, u * 0.02, '96,224,255', 0.08, u * 11);
    strokeSpiral(ARMS[1]!, 0.055, u * 0.016, '96,224,255', 0.055, u * 11, 1.5, 3.8);

    const fogBlobs = 110;
    for (let i = 0; i < fogBlobs; i++) {
      let x;
      let y;
      if (rand() < 0.55) {
        const roll2 = rand();
        const arm =
          roll2 < 0.33
            ? ARMS[0]
            : roll2 < 0.66
              ? ARMS[1]
              : roll2 < 0.74
                ? ARMS[2]
                : roll2 < 0.82
                  ? ARMS[3]
                  : roll2 < 0.91
                    ? ARMS[4]
                    : ARMS[5];
        const t = arm!.t0 + (arm!.t1 - arm!.t0) * rand();
        const k = armK(arm!, t) + (rand() - 0.5) * arm!.w;
        const ang = arm!.phase + t + (rand() - 0.5) * 0.09;
        x = R * k * Math.cos(ang);
        y = R * k * Math.sin(ang);
      } else {
        const t = rand() * Math.PI * 2;
        const k = 0.15 + 0.82 * Math.pow(rand(), 0.7);
        ;[x, y] = pt(t, k);
      }
      const r = (14 + rand() * 26) * u;
      softBlob(x, y, r, m31Pick(rand, M31_CLUSTER), 0.018 + rand() * 0.02);
    }

    const armBlobs = 780;
    for (let i = 0; i < armBlobs; i++) {
      let x;
      let y;
      let jx;
      let jy;
      let onArm;
      if (rand() < 0.64) {
        onArm = true;
        const roll2 = rand();
        const arm =
          roll2 < 0.33
            ? ARMS[0]
            : roll2 < 0.66
              ? ARMS[1]
              : roll2 < 0.75
                ? ARMS[2]
                : roll2 < 0.84
                  ? ARMS[3]
                  : roll2 < 0.92
                    ? ARMS[4]
                    : ARMS[5];
        const t = arm!.t0 + (arm!.t1 - arm!.t0) * (0.05 + 0.9 * rand());
        const k = armK(arm!, t) + (rand() - 0.5) * arm!.w;
        const ang = arm!.phase + t + (rand() - 0.5) * 0.11;
        x = R * k * Math.cos(ang);
        y = R * k * Math.sin(ang);
        jx = (rand() - 0.5) * u * 7;
        jy = (rand() - 0.5) * u * 7;
      } else {
        onArm = false;
        const t = rand() * Math.PI * 2;
        const k = 0.36 + 0.62 * Math.pow(rand(), 0.78);
        ;[x, y] = pt(t, k);
        jx = (rand() - 0.5) * u * 13;
        jy = (rand() - 0.5) * u * 13;
      }
      const roll = rand();
      let r;
      if (roll < 0.6) r = (3.5 + rand() * 5) * u;
      else if (roll < 0.89) r = (9 + rand() * 8) * u;
      else r = (17 + rand() * 15) * u;
      const big = r > u * 15;
      const rgb = m31Pick(rand, M31_CLUSTER);
      softBlob(x + jx, y + jy, r, rgb, big ? 0.15 + rand() * 0.12 : 0.08 + rand() * 0.12);
      if (big) {
        const nCloud = 3 + Math.floor(rand() * 2);
        for (let ci = 0; ci < nCloud; ci++) {
          const ca = rand() * Math.PI * 2;
          const cd = r * (0.55 + rand() * 0.85);
          softBlob(
            x + jx + Math.cos(ca) * cd,
            y + jy + Math.sin(ca) * cd,
            r * (0.55 + rand() * 0.65),
            rand() < 0.62 ? m31Pick(rand, M31_HII) : rgb,
            0.04 + rand() * 0.045
          );
        }
        softBlob(x + jx, y + jy, r * 1.4, rgb, 0.04);
        const gR = r * (2.6 + rand() * 1.0);
        const rg = ctx.createRadialGradient(x + jx, y + jy, r * 0.72, x + jx, y + jy, gR);
        rg.addColorStop(0, `rgba(${rgb},0)`);
        rg.addColorStop(0.42, `rgba(${rgb},${(0.04 + rand() * 0.04).toFixed(3)})`);
        rg.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x + jx, y + jy, gR, 0, Math.PI * 2);
        ctx.fill();
        softBlob(x + jx, y + jy, r * 0.38, '255,244,226', 0.22 + rand() * 0.14);
        const n = 4 + Math.floor(rand() * 5);
        for (let j = 0; j < n; j++) {
          const sr = r * 0.6 * Math.sqrt(rand());
          const sa = rand() * Math.PI * 2;
          const size = 0.45 + rand() * 1.15;
          ctx.fillStyle = `rgba(${m31Pick(rand, M31_WARM)},${(0.45 + rand() * 0.55).toFixed(3)})`;
          ctx.fillRect(
            x + jx + Math.cos(sa) * sr - size / 2,
            y + jy + Math.sin(sa) * sr - size / 2,
            size,
            size
          );
        }
      } else if (r > u * 8.5) {
        softBlob(x + jx, y + jy, r * (1.9 + rand() * 0.5), rgb, 0.035 + rand() * 0.03);
      }
      if (rand() < (onArm ? 0.2 : 0.06)) {
        softBlob(x + jx, y + jy, r * (0.5 + rand() * 0.3), m31Pick(rand, M31_HII), 0.13 + rand() * 0.09);
      }
    }

    const cloudAnchors = [
      { a: 0, t: 2.9 },
      { a: 1, t: 2.4 },
      { a: 0, t: 1.7 },
      { a: 1, t: 3.3 },
    ];
    for (const an of cloudAnchors) {
      const arm = ARMS[an.a]!;
      const k = armK(arm, an.t);
      const ang = arm.phase + an.t;
      const cx = R * k * Math.cos(ang);
      const cy = R * k * Math.sin(ang);
      for (let j = 0; j < 3; j++) {
        const r = (13 + rand() * 12) * u;
        const ox = (rand() - 0.5) * u * 24;
        const oy = (rand() - 0.5) * u * 24;
        softBlob(cx + ox, cy + oy, r, m31Pick(rand, M31_CLUSTER), 0.12 + rand() * 0.08);
        if (rand() < 0.6) {
          softBlob(cx + ox, cy + oy, r * 0.55, m31Pick(rand, M31_HII), 0.13 + rand() * 0.08);
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    strokeSpiral(ARMS[1]!, -0.075, u * 0.03, '5,4,7', 0.66, u * 6, 0.6, 3.7);
    strokeSpiral(ARMS[1]!, -0.02, u * 0.02, '5,4,7', 0.4, u * 5, 1.6, 3.4);
    strokeSpiral(ARMS[3]!, -0.04, u * 0.014, '5,4,7', 0.28, u * 5, 0.6, 2.0);
    const dustTexture = (arm: (typeof ARMS)[number], kOff: number, tLo: number, tHi: number, width: number, alpha: number) => {
      const steps = 150;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const t = tLo + (tHi - tLo) * p;
        const win = Math.sin(Math.PI * p);
        const k = armK(arm, t) + kOff + (rand() - 0.5) * 0.03;
        const ang = arm.phase + t + (rand() - 0.5) * 0.05;
        const x = R * k * Math.cos(ang) + (rand() - 0.5) * u * 4;
        const y = R * k * Math.sin(ang) + (rand() - 0.5) * u * 4;
        const r = width * (0.7 + rand() * 0.4) * (0.6 + 0.4 * win);
        softBlob(x, y, r, '7,5,9', alpha * (0.4 + 0.6 * win));
      }
    };
    dustTexture(ARMS[1]!, -0.07, 0.7, 3.5, u * 0.022, 0.3);
    dustTexture(ARMS[1]!, -0.015, 1.6, 3.3, u * 0.015, 0.18);

    ctx.globalCompositeOperation = 'lighter';
    halo(R * 0.36, '255,224,160', 0.58);
    halo(R * 0.18, '255,238,196', 0.78);
    halo(R * 0.44, '255,228,172', 0.16);
    softBlob(0, 0, R * 0.09, '255,246,220', 0.88);
    softBlob(0, 0, R * 0.03, '255,252,240', 0.9);

    const galaxyStars = 2800;
    for (let i = 0; i < galaxyStars; i++) {
      const t = rand() * Math.PI * 2;
      const k = 0.05 + Math.pow(rand(), 1.2) * 0.92;
      const [x, y] = pt(t, k);
      const jx = (rand() - 0.5) * u * 13;
      const jy = (rand() - 0.5) * u * 13;
      const m = Math.pow(rand(), 3.2);
      const alpha = 0.16 + 0.72 * m;
      const size = 0.3 + 2.1 * m;
      const c = m31Pick(rand, M31_WARM);
      ctx.fillStyle = `rgba(${c},${alpha.toFixed(3)})`;
      ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
      if (m > 0.86) {
        softBlob(x + jx, y + jy, 1.8 + 3.2 * m, c, 0.24);
      }
    }

    const rimStars = 900;
    for (let i = 0; i < rimStars; i++) {
      const t = rand() * Math.PI * 2;
      const k = 0.72 + 0.3 * Math.pow(rand(), 0.6);
      const [x, y] = pt(t, k);
      const jx = (rand() - 0.5) * u * 10;
      const jy = (rand() - 0.5) * u * 10;
      const m = Math.pow(rand(), 2.2);
      const alpha = 0.1 + 0.45 * m;
      const size = 0.3 + 0.9 * m;
      ctx.fillStyle = `rgba(${m31Pick(rand, M31_WARM)},${alpha.toFixed(3)})`;
      ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
    }

    ctx.globalCompositeOperation = 'source-over';
  }
  return { draw };
})();

/* -- v3 · 螺旋臂几何化版小盘（四臂简洁版，核心辉光更亮）—— 1:1 移植自原 milky-way（demo L3544-3775） -- */
const M31_V3 = (() => {
  const ARMS = [
    { phase: -0.5, t0: 0.25, t1: 4.4, k0: 0.38, k1: 0.97, w: 0.17 }, // 主臂 A（扫过盘底一侧）
    { phase: -3.65, t0: 0.2, t1: 4.0, k0: 0.38, k1: 0.94, w: 0.17 }, // 主臂 B（扫过盘顶一侧，内缘叠尘带）
    { phase: 0.1, t0: 0.7, t1: 2.6, k0: 0.53, k1: 0.8, w: 0.12 }, // 刺臂 C（自主臂 A 分出的短臂）
    { phase: -2.55, t0: 0.4, t1: 2.2, k0: 0.57, k1: 0.79, w: 0.12 }, // 刺臂 D（自主臂 B 分出的短臂）
  ];
  function armK(a: (typeof ARMS)[number], t: number) {
    return a.k0 + ((a.k1 - a.k0) * (t - a.t0)) / (a.t1 - a.t0) + Math.sin(t * 3 + a.phase) * 0.015;
  }
  function draw(canvas: HTMLCanvasElement, R: number) {
    const half = R * 1.36;
    const L = half * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(L * dpr);
    canvas.height = Math.round(L * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
    const u = L / 774;
    const rand = mulberry32(31415926);

    const softBlob = (x: number, y: number, r: number, rgb: string, a: number) => {
      if (r <= 0 || a <= 0) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(0.55, `rgba(${rgb},${(a * 0.38).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const halo = (r: number, rgb: string, a: number) => softBlob(0, 0, r, rgb, a);
    const pt = (t: number, k = 1): [number, number] => [R * k * Math.cos(t), R * k * Math.sin(t)];
    const strokeSpiral = (
      a: (typeof ARMS)[number], kOff: number, width: number, rgb: string, alpha: number,
      blur: number, tLo = a.t0, tHi = a.t1,
    ) => {
      const steps = 96;
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const t = tLo + (tHi - tLo) * p;
        const [x, y] = pt(a.phase + t, armK(a, t) + kOff);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    ctx.globalCompositeOperation = 'lighter';
    halo(R * 1.3, '96,138,235', 0.055);
    halo(R * 0.94, '128,178,252', 0.11);
    halo(R * 0.75, '160,202,250', 0.1);
    halo(R * 0.54, '250,212,164', 0.12);

    strokeSpiral(ARMS[0]!, 0, u * 0.036, '140,198,255', 0.11, u * 13);
    strokeSpiral(ARMS[1]!, 0, u * 0.032, '150,205,255', 0.1, u * 12);
    strokeSpiral(ARMS[1]!, 0.06, u * 0.022, '120,190,250', 0.055, u * 12);
    strokeSpiral(ARMS[0]!, -0.02, u * 0.02, '170,215,255', 0.05, u * 10, 0.35, 1.8);
    strokeSpiral(ARMS[2]!, 0, u * 0.022, '170,215,255', 0.06, u * 10);
    strokeSpiral(ARMS[3]!, 0, u * 0.02, '170,215,255', 0.05, u * 10);
    strokeSpiral(ARMS[0]!, 0.05, u * 0.02, '96,224,255', 0.08, u * 11);
    strokeSpiral(ARMS[1]!, 0.055, u * 0.016, '96,224,255', 0.055, u * 11, 1.5, 3.8);

    const fogBlobs = 110;
    for (let i = 0; i < fogBlobs; i++) {
      let x;
      let y;
      if (rand() < 0.55) {
        const roll2 = rand();
        const arm = roll2 < 0.4 ? ARMS[0] : roll2 < 0.8 ? ARMS[1] : roll2 < 0.9 ? ARMS[2] : ARMS[3];
        const t = arm!.t0 + (arm!.t1 - arm!.t0) * rand();
        const k = armK(arm!, t) + (rand() - 0.5) * arm!.w;
        const ang = arm!.phase + t + (rand() - 0.5) * 0.09;
        x = R * k * Math.cos(ang);
        y = R * k * Math.sin(ang);
      } else {
        const t = rand() * Math.PI * 2;
        const k = 0.15 + 0.82 * Math.pow(rand(), 0.7);
        ;[x, y] = pt(t, k);
      }
      const r = (14 + rand() * 26) * u;
      softBlob(x, y, r, m31Pick(rand, M31_CLUSTER), 0.018 + rand() * 0.02);
    }

    const armBlobs = 780;
    for (let i = 0; i < armBlobs; i++) {
      let x;
      let y;
      let jx;
      let jy;
      let onArm;
      if (rand() < 0.64) {
        onArm = true;
        const roll2 = rand();
        const arm = roll2 < 0.39 ? ARMS[0] : roll2 < 0.78 ? ARMS[1] : roll2 < 0.89 ? ARMS[2] : ARMS[3];
        const t = arm!.t0 + (arm!.t1 - arm!.t0) * (0.05 + 0.9 * rand());
        const k = armK(arm!, t) + (rand() - 0.5) * arm!.w;
        const ang = arm!.phase + t + (rand() - 0.5) * 0.11;
        x = R * k * Math.cos(ang);
        y = R * k * Math.sin(ang);
        jx = (rand() - 0.5) * u * 7;
        jy = (rand() - 0.5) * u * 7;
      } else {
        onArm = false;
        const t = rand() * Math.PI * 2;
        const k = 0.36 + 0.62 * Math.pow(rand(), 0.78);
        ;[x, y] = pt(t, k);
        jx = (rand() - 0.5) * u * 13;
        jy = (rand() - 0.5) * u * 13;
      }
      const roll = rand();
      let r;
      if (roll < 0.6) r = (3.5 + rand() * 5) * u;
      else if (roll < 0.89) r = (9 + rand() * 8) * u;
      else r = (17 + rand() * 15) * u;
      const big = r > u * 15;
      const rgb = m31Pick(rand, M31_CLUSTER);
      softBlob(x + jx, y + jy, r, rgb, big ? 0.15 + rand() * 0.12 : 0.08 + rand() * 0.12);
      if (big) {
        softBlob(x + jx, y + jy, r * 0.38, '255,244,226', 0.22 + rand() * 0.14);
        const n = 4 + Math.floor(rand() * 5);
        for (let j = 0; j < n; j++) {
          const sr = r * 0.6 * Math.sqrt(rand());
          const sa = rand() * Math.PI * 2;
          const size = 0.45 + rand() * 1.15;
          ctx.fillStyle = `rgba(${m31Pick(rand, M31_WARM)},${(0.45 + rand() * 0.55).toFixed(3)})`;
          ctx.fillRect(
            x + jx + Math.cos(sa) * sr - size / 2,
            y + jy + Math.sin(sa) * sr - size / 2,
            size,
            size
          );
        }
      }
      if (rand() < (onArm ? 0.2 : 0.06)) {
        softBlob(x + jx, y + jy, r * (0.5 + rand() * 0.3), m31Pick(rand, M31_HII), 0.13 + rand() * 0.09);
      }
    }

    const cloudAnchors = [
      { a: 0, t: 2.9 },
      { a: 1, t: 2.4 },
      { a: 0, t: 1.7 },
      { a: 1, t: 3.3 },
    ];
    for (const an of cloudAnchors) {
      const arm = ARMS[an.a]!;
      const k = armK(arm, an.t);
      const ang = arm.phase + an.t;
      const cx = R * k * Math.cos(ang);
      const cy = R * k * Math.sin(ang);
      for (let j = 0; j < 3; j++) {
        const r = (13 + rand() * 12) * u;
        const ox = (rand() - 0.5) * u * 24;
        const oy = (rand() - 0.5) * u * 24;
        softBlob(cx + ox, cy + oy, r, m31Pick(rand, M31_CLUSTER), 0.12 + rand() * 0.08);
        if (rand() < 0.6) {
          softBlob(cx + ox, cy + oy, r * 0.55, m31Pick(rand, M31_HII), 0.13 + rand() * 0.08);
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    strokeSpiral(ARMS[1]!, -0.075, u * 0.03, '5,4,7', 0.66, u * 6, 0.6, 3.7);
    strokeSpiral(ARMS[1]!, -0.02, u * 0.02, '5,4,7', 0.4, u * 5, 1.6, 3.4);
    strokeSpiral(ARMS[3]!, -0.04, u * 0.014, '5,4,7', 0.28, u * 5, 0.6, 2.0);
    const dustTexture = (arm: (typeof ARMS)[number], kOff: number, tLo: number, tHi: number, width: number, alpha: number) => {
      const steps = 150;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const t = tLo + (tHi - tLo) * p;
        const win = Math.sin(Math.PI * p);
        const k = armK(arm, t) + kOff + (rand() - 0.5) * 0.03;
        const ang = arm.phase + t + (rand() - 0.5) * 0.05;
        const x = R * k * Math.cos(ang) + (rand() - 0.5) * u * 4;
        const y = R * k * Math.sin(ang) + (rand() - 0.5) * u * 4;
        const r = width * (0.7 + rand() * 0.4) * (0.6 + 0.4 * win);
        softBlob(x, y, r, '7,5,9', alpha * (0.4 + 0.6 * win));
      }
    };
    dustTexture(ARMS[1]!, -0.07, 0.7, 3.5, u * 0.022, 0.3);
    dustTexture(ARMS[1]!, -0.015, 1.6, 3.3, u * 0.015, 0.18);

    ctx.globalCompositeOperation = 'lighter';
    halo(R * 0.36, '255,224,160', 0.58);
    halo(R * 0.18, '255,238,196', 0.78);
    halo(R * 0.44, '255,228,172', 0.16);
    softBlob(0, 0, R * 0.09, '255,246,220', 0.95);
    softBlob(0, 0, R * 0.03, '255,252,240', 1);

    const galaxyStars = 2800;
    for (let i = 0; i < galaxyStars; i++) {
      const t = rand() * Math.PI * 2;
      const k = 0.05 + Math.pow(rand(), 1.2) * 0.92;
      const [x, y] = pt(t, k);
      const jx = (rand() - 0.5) * u * 13;
      const jy = (rand() - 0.5) * u * 13;
      const m = Math.pow(rand(), 3.2);
      const alpha = 0.16 + 0.72 * m;
      const size = 0.3 + 2.1 * m;
      const c = m31Pick(rand, M31_WARM);
      ctx.fillStyle = `rgba(${c},${alpha.toFixed(3)})`;
      ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
      if (m > 0.86) {
        softBlob(x + jx, y + jy, 1.8 + 3.2 * m, c, 0.24);
      }
    }

    const rimStars = 900;
    for (let i = 0; i < rimStars; i++) {
      const t = rand() * Math.PI * 2;
      const k = 0.72 + 0.3 * Math.pow(rand(), 0.6);
      const [x, y] = pt(t, k);
      const jx = (rand() - 0.5) * u * 10;
      const jy = (rand() - 0.5) * u * 10;
      const m = Math.pow(rand(), 2.2);
      const alpha = 0.1 + 0.45 * m;
      const size = 0.3 + 0.9 * m;
      ctx.fillStyle = `rgba(${m31Pick(rand, M31_WARM)},${alpha.toFixed(3)})`;
      ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
    }

    ctx.globalCompositeOperation = 'source-over';
  }
  return { draw };
})();

/* 靛蓝外晕（demo L3778-3790） */
export function makeHaloSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256 * Math.SQRT2);
  gr.addColorStop(0, 'rgba(99,132,235,0.10)');
  gr.addColorStop(0.32, 'rgba(89,116,224,0.05)');
  gr.addColorStop(0.52, 'rgba(80,110,220,0.022)');
  gr.addColorStop(0.66, 'rgba(80,110,220,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 512);
  return c;
}

/* 迷你盘色系染色（demo L3792-3831） */
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s2 = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s2, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  const q = l < .5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function tintRgb(rgb: string, hueShift: number, satMul: number): string {
  const parts = rgb.split(',').map(Number);
  const [h, s, l] = rgb2hsl(parts[0]!, parts[1]!, parts[2]!);
  const out = hsl2rgb((h + hueShift + 360) % 360, Math.min(1, s * satMul), l);
  return Math.round(out[0]!) + ',' + Math.round(out[1]!) + ',' + Math.round(out[2]!);
}
function tintPal(pal: M31Palette, hueShift: number, satMul: number): [number, number, number, number][] {
  return pal.map(([w, r, g, b]) => {
    const [h, s, l] = rgb2hsl(r!, g!, b!);
    const out = hsl2rgb((h + hueShift + 360) % 360, Math.min(1, s * satMul), l);
    return [w!, Math.round(out[0]!), Math.round(out[1]!), Math.round(out[2]!)];
  });
}

/* 迷你 m31 圆盘贴图（demo L3833-4031；种子 31415926+seed*7919）。
   注：L3859-3875 以两实参调用种子流 rand（实参被 mulberry32 忽略）——1:1 保留。 */
const MINI_HUES = [0, 28, -34, 62, 96, 148, 202, -66];
export function makeMiniDiskSprite(seed: number): HTMLCanvasElement {
  const R = 283.5;
  const half = R * 1.36;
  const L = half * 2;
  const cv0 = document.createElement('canvas');
  cv0.width = cv0.height = Math.ceil(L);
  const ctx = cv0.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, half, half);
  const u = L / 774;
  const rand = mulberry32(31415926 + seed * 7919);
  const hue = MINI_HUES[seed % MINI_HUES.length]!;
  const sm = .85 + (seed % 3) * .15;
  const diskC = ['96,138,235', '128,178,252', '160,202,250', '250,212,164'].map(v => tintRgb(v, hue, sm));
  const armC = ['140,198,255', '150,205,255', '120,190,250', '170,215,255', '96,224,255'].map(v => tintRgb(v, hue, sm));
  const coreC = ['255,224,160', '255,238,196', '255,228,172', '255,246,220', '255,252,240'].map(v => tintRgb(v, hue * .4, sm));
  const bigCore = tintRgb('255,244,226', hue * .4, sm);
  const palC = tintPal(M31_CLUSTER, hue, sm);
  const palH = tintPal(M31_HII, hue, sm);
  const palW = tintPal(M31_WARM, hue * .6, sm);
  const armCount = 2 + Math.floor(rand() * 4);
  const armBlobs = Math.round(780 * (0.4 + rand() * 0.85));
  const fogBlobs = Math.round(110 * (0.5 + rand() * 0.9));
  const galaxyStars = Math.round(2800 * (0.5 + rand() * 0.9));
  const rimStars = Math.round(900 * (0.5 + rand() * 0.9));
  const dustMul = rand() < 0.25 ? 0 : rand(0.6, 1);                 // demo L3859（25% 无尘带形态；两支均种子流取数）
  const kHole = rand(0.12, 0.42);
  const kExp = rand(0.55, 1.15);
  const blobMul = rand(0.75, 1.35);
  const arms: { t0: number; span: number; k0: number; k1: number; wave: number; phase: number; width: number; alpha: number }[] = [];
  for (let ai = 0; ai < armCount; ai++) {
    const k0 = rand(0.3, 0.55);
    arms.push({
      t0: rand(-3.2, 3.2),
      span: rand(1.4, 3.0),
      k0: k0,
      k1: rand(0.68, 0.98),
      wave: rand(0.02, 0.05),
      phase: rand(0, 6.283),
      width: rand(0.024, 0.042),
      alpha: rand(0.12, 0.2),
    });
  }

  const softBlob = (x: number, y: number, r: number, rgb: string, a: number) => {
    if (r <= 0 || a <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.55, `rgba(${rgb},${(a * 0.38).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const halo = (r: number, rgb: string, a: number) => softBlob(0, 0, r, rgb, a);
  const pt = (t: number, k = 1): [number, number] => [R * k * Math.cos(t), R * k * Math.sin(t)];
  const strokeArc = (t0: number, t1: number, k0: number, k1: number, width: number, rgb: string, alpha: number, blur: number, wave = 0.04, phase = 1.2) => {
    const steps = 64;
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const t = t0 + (t1 - t0) * p;
      const k = k0 + (k1 - k0) * p + Math.sin(t * 2 + phase) * wave;
      const [x, y] = pt(t, k);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  ctx.globalCompositeOperation = 'lighter';
  halo(R * 1.3, diskC[0]!, 0.11);
  halo(R * 0.94, diskC[1]!, 0.22);
  halo(R * 0.75, diskC[2]!, 0.21);
  halo(R * 0.54, diskC[3]!, 0.22);

  for (let ai = 0; ai < armCount; ai++) {
    const a = arms[ai]!;
    strokeArc(a.t0, a.t0 + a.span, a.k0, a.k1, u * a.width, armC[ai % armC.length]!, a.alpha, u * (9 + a.width * 200), a.wave, a.phase);
  }

  for (let i = 0; i < fogBlobs; i++) {
    const t = rand() * Math.PI * 2;
    const k = 0.15 + 0.82 * Math.pow(rand(), 0.7);
    const [x, y] = pt(t, k);
    const r = (14 + rand() * 26) * u;
    softBlob(x, y, r, m31Pick(rand, palC), 0.028 + rand() * 0.03);
  }

  for (let i = 0; i < armBlobs; i++) {
    const t = rand() * Math.PI * 2;
    const k = kHole + (0.98 - kHole) * Math.pow(rand(), kExp);
    const [x, y] = pt(t, k);
    const jx = (rand() - 0.5) * u * 13;
    const jy = (rand() - 0.5) * u * 13;
    const roll = rand();
    let r;
    if (roll < 0.6) r = (3.5 + rand() * 5) * u * blobMul;
    else if (roll < 0.89) r = (9 + rand() * 8) * u * blobMul;
    else r = (17 + rand() * 15) * u * blobMul;
    const big = r > u * 15;
    const rgb = m31Pick(rand, palC);
    softBlob(x + jx, y + jy, r, rgb, big ? 0.15 + rand() * 0.12 : 0.08 + rand() * 0.12);
    if (big) {
      softBlob(x + jx, y + jy, r * 0.38, bigCore, 0.22 + rand() * 0.14);
      const n = 4 + Math.floor(rand() * 5);
      for (let j = 0; j < n; j++) {
        const sr = r * 0.6 * Math.sqrt(rand());
        const sa = rand() * Math.PI * 2;
        const size = 0.45 + rand() * 1.15;
        ctx.fillStyle = `rgba(${m31Pick(rand, palW)},${(0.45 + rand() * 0.55).toFixed(3)})`;
        ctx.fillRect(
          x + jx + Math.cos(sa) * sr - size / 2,
          y + jy + Math.sin(sa) * sr - size / 2,
          size,
          size
        );
      }
    }
    if (rand() < 0.16) {
      softBlob(x + jx, y + jy, r * (0.5 + rand() * 0.3), m31Pick(rand, palH), 0.13 + rand() * 0.09);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  strokeArc(-3.0, -0.2, 0.68, 0.68, u * 0.034, '5,4,7', 0.74 * dustMul, u * 6);
  strokeArc(-2.7, -0.55, 0.88, 0.88, u * 0.022, '5,4,7', 0.52 * dustMul, u * 6);
  strokeArc(-2.4, -0.8, 0.52, 0.52, u * 0.014, '5,4,7', 0.32 * dustMul, u * 5);
  const dustTexture = (t0: number, t1: number, k0: number, width: number, alpha: number) => {
    const steps = Math.round((Math.abs(t1 - t0) / (Math.PI * 2)) * 240) + 40;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const t = t0 + (t1 - t0) * p;
      const win = Math.sin(Math.PI * p);
      const k = k0 + Math.sin(t * 2 + 1.2) * 0.04 + (rand() - 0.5) * 0.03;
      const [x, y] = pt(t, k);
      const jx = (rand() - 0.5) * u * 4;
      const jy = (rand() - 0.5) * u * 4;
      const r = width * (0.7 + rand() * 0.4) * (0.6 + 0.4 * win);
      softBlob(x + jx, y + jy, r, '7,5,9', alpha * dustMul * (0.4 + 0.6 * win));
    }
  };
  dustTexture(-3.0, -0.2, 0.68, u * 0.024, 0.3);
  dustTexture(-2.7, -0.55, 0.88, u * 0.016, 0.18);

  ctx.globalCompositeOperation = 'lighter';
  halo(R * 0.36, coreC[0]!, 0.58);
  halo(R * 0.18, coreC[1]!, 0.78);
  halo(R * 0.44, coreC[2]!, 0.16);
  softBlob(0, 0, R * 0.09, coreC[3]!, 0.95);
  softBlob(0, 0, R * 0.03, coreC[4]!, 1);

  for (let i = 0; i < galaxyStars; i++) {
    const t = rand() * Math.PI * 2;
    const k = 0.05 + Math.pow(rand(), 1.2) * 0.92;
    const [x, y] = pt(t, k);
    const jx = (rand() - 0.5) * u * 13;
    const jy = (rand() - 0.5) * u * 13;
    const m = Math.pow(rand(), 3.2);
    const alpha = 0.16 + 0.72 * m;
    const size = 0.3 + 2.1 * m;
    const c = m31Pick(rand, palW);
    ctx.fillStyle = `rgba(${c},${alpha.toFixed(3)})`;
    ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
    if (m > 0.86) {
      softBlob(x + jx, y + jy, 1.8 + 3.2 * m, c, 0.24);
    }
  }

  for (let i = 0; i < rimStars; i++) {
    const t = rand() * Math.PI * 2;
    const k = 0.72 + 0.3 * Math.pow(rand(), 0.6);
    const [x, y] = pt(t, k);
    const jx = (rand() - 0.5) * u * 10;
    const jy = (rand() - 0.5) * u * 10;
    const m = Math.pow(rand(), 2.2);
    const alpha = 0.1 + 0.45 * m;
    const size = 0.3 + 0.9 * m;
    ctx.fillStyle = `rgba(${m31Pick(rand, palW)},${alpha.toFixed(3)})`;
    ctx.fillRect(x + jx - size / 2, y + jy - size / 2, size, size);
  }

  ctx.globalCompositeOperation = 'source-over';
  const out = document.createElement('canvas');
  out.width = out.height = 256;
  const og = out.getContext('2d')!;
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  og.drawImage(cv0, 0, 0, 256, 256);
  return out;
}

/* ---------------- 圆盘预渲染装配（demo L4244-4246 / L4249-4253） ---------------- */
export interface DiskSprite { cv: HTMLCanvasElement; L: number }

export function prerenderDisk(drawFn: (canvas: HTMLCanvasElement, R: number) => void, R: number): DiskSprite {
  const cv = document.createElement('canvas');
  drawFn(cv, R);
  return { cv, L: R * 2.72 };
}

/** §3 行接口 buildDisks()：大盘 S*.315（V5）/ 小盘 S*.135（V3）——buildSky 尾段调用（demo L4244-4246） */
export interface DisksHolder { W: number; H: number; diskBig: DiskSprite | null; diskSmall: DiskSprite | null }
export function buildDisks(s: DisksHolder): void {
  const S = Math.min(s.W, s.H);
  s.diskBig = prerenderDisk(M31_V5.draw, S * .315);
  s.diskSmall = prerenderDisk(M31_V3.draw, S * .135);
}

/* M31 圆盘合成（demo L4433-4448）：rotate(tilt) → scaleY(0.36) 倾斜投影 + 盘面自转（260s/周）
   + 靛蓝外晕（不随自转）——同原 CSS 变换链 */
export function drawM31(
  s: Pick<SkyState, 'ctx' | 'haloSprite'>, d: DiskSprite | null,
  x: number, y: number, spin: number, tilt: number,
): void {
  if (!d) return;
  const ctx = s.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(1, 0.36);
  const HL = d.L * 2.5;
  ctx.globalAlpha = 0.4;
  ctx.drawImage(s.haloSprite!, -HL / 2, -HL / 2, HL, HL);
  ctx.globalAlpha = 1;
  ctx.rotate(spin);
  ctx.drawImage(d.cv, -d.L / 2, -d.L / 2, d.L, d.L);
  ctx.restore();
}
