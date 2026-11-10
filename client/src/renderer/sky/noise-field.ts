// C-12 NoiseField（TDD-C-12 §3）：程序化噪声/尘埃密度场（demo L4033-4086，1:1 移植）。
// §3 接口行的 density(x,y) = 本文件 dustAt(u,v)（demo 原名保留）；唯一结构差 =
// dustAt 依赖的银道几何（bandL/bandBw，buildSky 产出）经 SkyState 传入。
// hash2/vnoise/fbm/ridged 为纯函数，与 demo 同为无状态模块级。

const sq = (x: number) => x * x;                                     // demo L4034
const sstep = (a: number, b: number, x: number) => {                 // demo L4035-4039
  x = (x - a) / (b - a);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};
function hash2(ix: number, iy: number): number {                     // demo L4040-4045
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {                      // demo L4046-4053
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),     b = hash2(ix + 1, iy),
        c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, oct: number): number {            // demo L4054-4058
  let s = 0, amp = .5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, y * f); norm += amp; amp *= .5; f *= 2.03; }
  return s / norm;
}
function ridged(x: number, y: number, oct: number): number {         // demo L4059-4068
  let s = 0, amp = .6, f = 1;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(2 * vnoise(x * f, y * f) - 1);
    s += amp * n * n;
    amp *= .5;
    f *= 2.17;
  }
  return s;
}

/** 银道几何宿主（SkyState 的结构性子集；bandL/bandBw 由 buildSky 产出，demo L4109） */
export interface BandGeometryHolder { bandL: number; bandBw: number }

// 尘埃密度场 [0,1]：双支高斯包络 × fbm 云絮 × 脊状细丝 —— 辉光遮蔽 / 星点消光 / 星团遮挡共用同一场（物理一致）
// demo L4069-4085
export function dustAt(s: BandGeometryHolder, u: number, v: number): number {
  const bw = s.bandBw, L = s.bandL;
  const em = Math.exp(-sq(v + bw * .1) / (2 * sq(bw * .4)));
  const es = .55 * Math.exp(-sq(v - bw * .5) / (2 * sq(bw * .24)));
  let env = em + es;
  if (env > 1) env = 1;
  if (env < .015) return 0;
  env *= sstep(0, L * .14, u + L) * sstep(0, L * .14, L - u)
       * (1 - sstep(bw * 1.5, bw * 2.1, Math.abs(v)));
  if (env < .01) return 0;
  const big = fbm(u / (bw * 3.4) + 7.31, v / (bw * 1.5) + 3.17, 2);
  const det = fbm(u / (bw * 1.55) + 1.7, v / (bw * .4) + 9.2, 4);
  const fil = ridged(u / (bw * .8) + 21.4, v / (bw * .24) + 5.6, 2);
  const d = env * (Math.pow(det, 1.35) * (.26 + 1.08 * big) + fil * fil * fil * .5);
  return d > 1 ? 1 : d;
}
