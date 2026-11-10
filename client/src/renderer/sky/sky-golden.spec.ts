// @vitest-environment jsdom
// T6-13 / TDD-C-12 §6.2 视觉回归——PM 默认口径等价交付：
//   jsdom 无真像素比对 → 「固定种子确定性 golden 快照（M31 圆盘 sprite 构建数据/全画幅场景数组）
//   ＋11 层逐层关闭的差异断言（golden 数据变化）」。
//   像素 diff 阈值=设计值，不在本卡裁剪——T6-16 复核清点（docs/05 T6-13 备注）。
// golden 基线=首跑数值，登记于下方常量（首跑环境：Windows x64 / node 24 / vitest 5.1.0 / jsdom 31，
// jsdom 视口 1024×768、devicePixelRatio=1）；跨引擎/跨架构浮点差异如出现漂移，按 PM 口径在 T6-16
// 重登记并复核源（demo 固定种子承诺=L3231）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountSky } from './sky-canvas';
import type { SkyHandle, SkyState } from './sky-canvas';
import { buildDisks, makeMiniDiskSprite } from './m31-prerender';
import { SKY_LAYER_KEYS } from './types';
import {
  fnv1a, hashCtxs, installMatchMedia, installRaf, makeSkyCanvas, patchCanvas2D, resetSkyGlobals, seedMathRandom,
} from './testing';

// —— golden 基线（首跑登记 2026-11-11，勿手改；变更=几何/行为漂移，须复核 demo 源后重登记。
//    FNV-1a 32bit over JSON(录制 op 流)；图像按每 ctx 局部序号，确定性只依赖绘制顺序与浮点值。
//    重登记留痕 2026-11-12（评审 MAJOR-1）：makeMiniDiskSprite 还原 demo L3859 dustMul 三元
//    `rand() < 0.25 ? 0 : rand(0.6, 1)`——MINI_SEED0 与 FRAME_ALL_ON（op 流含挂载期迷你盘构建）
//    随之重算；M31_V5/V3/SCENE 实测不变（大盘小盘不走 makeMiniDiskSprite、scene digest 不含 sprite 内容）。 ——
const GOLDEN_M31_V5 = 'f6b039f8';        // 大盘 sprite 构建数据（种子 31415926，R=min(1024,768)*.315）——修复前后不变（实测）
const GOLDEN_M31_V3 = '60603ecc';        // 小盘 sprite 构建数据（种子 31415926，R=min(1024,768)*.135）——修复前后不变（实测）
const GOLDEN_MINI_SEED0 = '792b4f43';    // 迷你盘 seed=0（种子 31415926+0*7919）；修复前旧值 047e9a6b（dustMul 丢三元）
const GOLDEN_SCENE = '408eaad1';         // 全画幅场景数组（Math.random 种子 20261111；stars=561/heroes=19/pulses=4）——修复前后不变（实测）
const GOLDEN_FRAME_ALL_ON = '1ec77b99';  // 全层开·t=30s 单帧全 ctx 绘制数据（含 M31/场景/帧；SEED+7 于帧前重置）；修复前旧值 0c823bf6

const SEED = 20261111;

let patch: ReturnType<typeof patchCanvas2D>;
let raf: ReturnType<typeof installRaf>;
let mm: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  patch = patchCanvas2D();
  raf = installRaf();
  mm = installMatchMedia(false);
});
afterEach(() => {
  raf.restore();
  mm.restore();
  patch.restore();
  resetSkyGlobals();
});

function mountSeeded(seed: number): { canvas: HTMLCanvasElement; h: SkyHandle } {
  const restore = seedMathRandom(seed);
  const canvas = makeSkyCanvas();
  const h = mountSky(canvas);
  restore();
  return { canvas, h };
}

/** 单用例内独立窗口：仅取本次挂载新建的 ctx（多挂载用例下保证层差异因果纯净）。
 *  s.last 归零：mount 取真 performance.now()，会侵蚀首帧 dt 确定性——golden 口径统一自 0 起步。 */
function runFrameCase(seed: number, mutate?: (h: SkyHandle) => void, t = 30000, steps = 1): string {
  const start = patch.all().length;
  const { h } = mountSeeded(seed);
  mutate?.(h);
  h.s.last = 0;
  const restore = seedMathRandom(seed + 7);   // 帧内 spawn/闪烁取数流确定性
  for (let i = 0; i < steps; i++) raf.pump(t + i * 16);
  restore();
  const hash = hashCtxs(patch.all().slice(start));
  h.dispose();
  return hash;
}

function sceneDigest(s: SkyState): string {
  return fnv1a(JSON.stringify({
    counts: [s.stars.length, s.heroes.length, s.pulses.length, s.clusters.length,
             s.bandStars.length, s.minis.length, s.mega.length, s.gas.length],
    stars: s.stars, heroes: s.heroes, pulses: s.pulses, clusters: s.clusters,
    bandStars: s.bandStars, mega: s.mega, gas: s.gas,
    minis: s.minis.map(m => ({ ...m, sp: s.miniSprites?.indexOf(m.sp) ?? -1 })),
  }));
}

describe('§6.2 M31 圆盘 sprite 构建数据 golden（固定种子 31415926，demo L3231）', () => {
  it('与 Math.random 无关：不同外层种子下两次构建 hash 一致且命中基线', () => {
    const build = () => {
      const before = patch.all().length;
      const holder = { W: 1024, H: 768, diskBig: null, diskSmall: null };
      buildDisks(holder);
      const ctxs = patch.all().slice(before);
      return { big: hashCtxs([ctxs[0]!]), small: hashCtxs([ctxs[1]!]) };
    };
    const r1 = seedMathRandom(111);
    const a = build();
    r1();
    const r2 = seedMathRandom(999999);
    const b = build();
    r2();
    expect(a.big).toBe(b.big);
    expect(a.small).toBe(b.small);
    expect(a.big).toBe(GOLDEN_M31_V5);
    expect(a.small).toBe(GOLDEN_M31_V3);
  });
  it('迷你盘 seed=0 构建数据 golden（种子 31415926+seed*7919，demo L3844）', () => {
    const build = () => {
      const before = patch.all().length;
      makeMiniDiskSprite(0);
      return hashCtxs(patch.all().slice(before));
    };
    const r1 = seedMathRandom(5);
    const a = build();
    r1();
    const r2 = seedMathRandom(777);
    const b = build();
    r2();
    expect(a).toBe(b);
    expect(a).toBe(GOLDEN_MINI_SEED0);
  });
});

describe('§6.2 全画幅场景数组 golden（Math.random 种子化→确定性）', () => {
  it('同种子两次挂载 digest 一致且命中基线；规模算术锚（demo L4259/L4272/L4283）', () => {
    const a = mountSeeded(SEED);
    const b = mountSeeded(SEED);
    expect(sceneDigest(a.h.s)).toBe(sceneDigest(b.h.s));
    expect(sceneDigest(a.h.s)).toBe(GOLDEN_SCENE);
    // 算术锚：stars=min(2200, 1024*768/1400)=561；heroes=min(30, 14+5)=19；pulses 固定 4
    expect(a.h.s.stars.length).toBe(561);
    expect(a.h.s.heroes.length).toBe(19);
    expect(a.h.s.pulses.length).toBe(4);
  }, 60000);

  it('11 星野元素逐键关闭→帧绘制数据逐键偏离基线（01 A-14.2 的 11 元素=12 层键减 parallax）', () => {
    const baseline = runFrameCase(SEED);
    expect(baseline).toBe(GOLDEN_FRAME_ALL_ON);           // 基线先命中登记值
    for (const k of SKY_LAYER_KEYS) {
      if (k === 'parallax') continue;                     // 视差无目标位移时不动帧数据——单列下例
      const off = runFrameCase(SEED, h => { window.__skyCtl!.layer(k, false); });
      expect(off, `layer ${k} 关闭应改变 golden 帧数据`).not.toBe(baseline);
    }
  }, 240000);

  it('视差（第 12 键）：pointermove 目标位移→多帧收敛后帧数据偏离基线（demo L4733-4737）', () => {
    const steps = 60;
    const baseline = runFrameCase(SEED, undefined, 30000, steps);
    const withParallax = runFrameCase(SEED, h => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: h.s.W * 0.9, clientY: h.s.H * 0.1 }));
    }, 30000, steps);
    expect(withParallax).not.toBe(baseline);
  }, 120000);
});
