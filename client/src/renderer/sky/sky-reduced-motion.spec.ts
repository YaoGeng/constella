// @vitest-environment jsdom
// T6-13 / TDD-C-12 §6.3 降级（01 A-16.1 GWT）：emulate prefers-reduced-motion →
// 路② CSS 动画/过渡时长压 0.01ms（demo L579-581）；路① REDUCED 标志消 canvas 动态
// （点击不召唤 L4731 / 帧内零生成流星卫星 L4687 / 天球摆动量=0 L4505-4507）。
// 「bg=纯黑→帧循环零执行」=§6.1c pause 用例；canvas 隐藏由 C-11 对端断言（03 §6.3 注）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountSky } from './sky-canvas';
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
});

describe('§6.3 prefers-reduced-motion 双路降级', () => {
  it('emulate reduce→REDUCED 标志 + CSS 0.01ms + canvas 动态全消', () => {
    mm.restore();
    const reduced = installMatchMedia(true);          // emulate prefers-reduced-motion: reduce
    try {
      const canvas = makeSkyCanvas();
      const h = mountSky(canvas);

      // 路① 标志（demo L3132，挂载时求值）
      expect(h.s.REDUCED).toBe(true);

      // 路② CSS：媒体查询 + 0.01ms 双断言（demo L579-581 原文）
      const css = document.querySelector('style[data-constella-sky-motion]')?.textContent ?? '';
      expect(css).toContain('prefers-reduced-motion:reduce');
      expect(css).toContain('animation-duration:.01ms');
      expect(css).toContain('transition-duration:.01ms');

      // 路① 行为：点击空白不召唤（demo L4731 `if (!REDUCED)`）
      canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
      expect(h.s.meteors.length).toBe(0);

      // 路① 行为：帧内不生成流星/卫星（demo L4687 `if (!REDUCED)`；t=30s>nextMeteor 1.4/nextSat 26）
      raf.pump(30000);
      raf.pump(30016);
      expect(h.s.meteors.length).toBe(0);

      // 路① 行为：天球摆动量=0（demo L4505-4507 rot/dx/dy 全 0 → 首个 translate x=W/2）
      const ops = patch.ctxOf(canvas).ops;
      const tr = ops.findIndex(o => o[0] === 'translate');
      expect(tr).toBeGreaterThanOrEqual(0);
      expect(ops[tr]![1]).toBeCloseTo(h.s.W / 2, 10);
    } finally {
      reduced.restore();
    }
  });
  it('默认（未开启 reduce）→REDUCED=false，点击召唤不受降级影响', () => {
    const canvas = makeSkyCanvas();
    const h = mountSky(canvas);
    expect(h.s.REDUCED).toBe(false);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    expect(h.s.meteors.length).toBe(1);
  });
});
