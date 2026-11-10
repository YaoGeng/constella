// @vitest-environment jsdom
// T6-13 / TDD-C-12 §6.1 通道与生命周期用例：a) layer 逐键开关+meteor 清池；b) dens 钳制+重建；
// c) pause 整帧跳过；d) __skyReady 握手两加载序。另收 DPR 上限 2（demo L4745）与 resize 180ms
// 防抖（demo L4753）两条 L4726-4754 段行为锚。canvas mock 见 ./testing。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSky } from './sky-canvas';
import type { SkyHandle } from './sky-canvas';
import { SKY_DENS_KEYS, SKY_LAYER_KEYS, type DensKey, type SkyLayerKey } from './types';
import { spawnMeteor } from './meteors-satellites';
import { installMatchMedia, installRaf, makeSkyCanvas, patchCanvas2D, resetSkyGlobals } from './testing';

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
  vi.restoreAllMocks();
});

describe('§6.1a layer 逐键开关→LAYER 标志翻转', () => {
  it('12 键逐键 off/on 翻转（demo L2698/L3153 键集冻结）', () => {
    const h: SkyHandle = mountSky(makeSkyCanvas());
    expect(SKY_LAYER_KEYS.length).toBe(12);
    expect(SKY_DENS_KEYS.length).toBe(7);
    const ctl = window.__skyCtl!;
    for (const k of SKY_LAYER_KEYS) {
      ctl.layer(k as SkyLayerKey, false);
      expect(h.s.LAYER[k]).toBe(false);
      ctl.layer(k as SkyLayerKey, true);
      expect(h.s.LAYER[k]).toBe(true);
    }
  });
  it('meteor 关闭清空流星池（demo L4762）', () => {
    const h = mountSky(makeSkyCanvas());
    spawnMeteor(h.s);
    spawnMeteor(h.s);
    expect(h.s.meteors.length).toBe(2);
    window.__skyCtl!.layer('meteor', false);
    expect(h.s.LAYER.meteor).toBe(false);
    expect(h.s.meteors.length).toBe(0);
  });
});

describe('§6.1b dens 7 键 p 钳制 [0.1,1]→触发重建', () => {
  it('越界钳制到边界、界内原值；每次 dens→resize 重建（setTransform 再执行）', () => {
    const canvas = makeSkyCanvas();
    const h = mountSky(canvas);
    const cases: [DensKey, number, number][] = [
      ['stars', 0.05, 0.1],      // 下界外→0.1
      ['band', 5, 1],            // 上界外→1
      ['heroes', 0.5, 0.5],
      ['clusters', 0.1, 0.1],
      ['minis', 0.99, 0.99],
      ['mega', 0, 0.1],
      ['gas', 1.7, 1],
    ];
    expect(cases.length).toBe(SKY_DENS_KEYS.length);
    for (const [k, p, want] of cases) {
      const before = patch.ctxOf(canvas).count('setTransform');
      window.__skyCtl!.dens(k, p);
      expect(h.s.DENS[k]).toBe(want);
      expect(patch.ctxOf(canvas).count('setTransform')).toBeGreaterThan(before);   // resize()→ctx.setTransform（demo L4749）
    }
  });
});

describe('§6.1c pause(true)→frame 整帧 return、rAF 回调零执行（省电，demo L4500）', () => {
  it('暂停后回调内零绘制、调度链保持、恢复即续绘', () => {
    const canvas = makeSkyCanvas();
    const h = mountSky(canvas);
    spawnMeteor(h.s);                        // 池内留一颗：若暂停后仍绘制，ops 必增长
    raf.pump(16);                            // 暂停前正常渲染一帧
    const main = patch.ctxOf(canvas);
    const ops0 = main.ops.length;

    window.__skyCtl!.pause(true);
    expect(h.s.PAUSED).toBe(true);
    raf.pump(1000);
    raf.pump(1016);
    raf.pump(1032);
    expect(main.ops.length).toBe(ops0);      // 整帧 return：零绘制调用
    expect(raf.queued()).toBe(1);            // demo L4496 帧首自续 rAF（调度链活着）

    window.__skyCtl!.pause(false);
    raf.pump(1048);
    expect(main.ops.length).toBeGreaterThan(ops0);   // 恢复渲染
  });
});

describe('§6.1d __skyReady 握手（demo L2718-2727/L4776）', () => {
  it('加载序①：主控先注册回放→sky 后就绪→回放恰一次', () => {
    const replay = vi.fn(() => {
      window.__skyCtl?.layer('disk', false);
      window.__skyCtl?.dens('stars', 0.5);
      window.__skyCtl?.pause(true);
    });
    window.__skyReady = replay;
    const h = mountSky(makeSkyCanvas());
    expect(replay).toHaveBeenCalledTimes(1);
    expect(h.s.LAYER.disk).toBe(false);      // 回放内容生效（C-11 语义）
    expect(h.s.DENS.stars).toBe(0.5);
    expect(h.s.PAUSED).toBe(true);
  });
  it('加载序②（反向对称）：sky 先就绪→主控后注册不重放；主控 init 直发收敛', () => {
    const h = mountSky(makeSkyCanvas());
    expect(window.__skyCtl).toBeDefined();   // sky 先就绪：通道已可用
    const late = vi.fn();
    window.__skyReady = late;
    raf.pump(5000);
    raf.pump(5016);
    expect(late).not.toHaveBeenCalled();     // __skyReady 仅就绪时刻触发一次（demo L4776）
    window.__skyCtl!.layer('pulse', false);  // 主控后加载的直发路径（demo applySetting 语义）
    expect(h.s.LAYER.pulse).toBe(false);
  });
});

describe('L4726-4754 段行为锚：DPR 上限 2 与 resize 180ms 防抖', () => {
  it('devicePixelRatio=3 → 物理像素=CSS×2、ODPR=1.5（demo L4745-4746）', () => {
    const dpr0 = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true, writable: true });
    try {
      const canvas = makeSkyCanvas();
      const h = mountSky(canvas);
      expect(canvas.width).toBe(Math.round(window.innerWidth * 2));      // 1024→2048
      expect(canvas.height).toBe(Math.round(window.innerHeight * 2));    // 768→1536
      expect(h.s.DPR).toBe(2);
      expect(h.s.ODPR).toBe(1.5);
      expect(h.s.sky.width).toBe(Math.round(h.s.skyW * 1.5));            // 离屏按 ODPR
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: dpr0, configurable: true, writable: true });
    }
  });
  it('resize 180ms 防抖后重建（demo L4753）', () => {
    vi.useFakeTimers();
    try {
      const canvas = makeSkyCanvas();
      mountSky(canvas);
      const before = patch.ctxOf(canvas).count('setTransform');
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(179);
      expect(patch.ctxOf(canvas).count('setTransform')).toBe(before);    // 未到 180ms 不重建
      vi.advanceTimersByTime(1);
      expect(patch.ctxOf(canvas).count('setTransform')).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
