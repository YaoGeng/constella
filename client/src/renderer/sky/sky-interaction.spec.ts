// @vitest-environment jsdom
// T6-13 / TDD-C-12 §6.4 交互两例（demo 增量③ L4727-4732）：空白 pointerdown→spawnMeteor 恰一；
// UI 命中区（合成冒泡路径）→不召唤。另收视差跟随（L4733-4737）行为锚。
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

describe('§6.4 点击召唤流星', () => {
  it('pointerdown 直接落在 canvas（#sky）→spawnMeteor 恰一', () => {
    const canvas = makeSkyCanvas();
    const h = mountSky(canvas);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 200, bubbles: true }));
    expect(h.s.meteors.length).toBe(1);                       // 恰一
    const m = h.s.meteors[0]!;
    expect(m.sat).toBeFalsy();                     // 是流星不是卫星
    expect(m.x).toBeCloseTo(300 - m.dx! * 60, 5);  // demo L4456-4457：dx=cos(ang) 方向分量，起点回退 60px
    expect(m.y).toBeCloseTo(200 - m.dy! * 60, 5);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    expect(h.s.meteors.length).toBe(2);                       // 每击恰一
  });
  it('pointerdown 落在 UI 命中区（冒泡到 window 的路径）→不召唤', () => {
    const canvas = makeSkyCanvas();
    const h = mountSky(canvas);
    const ui = document.createElement('div');
    ui.id = 'settings-modal';
    document.body.appendChild(ui);
    ui.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 200, bubbles: true }));
    expect(h.s.meteors.length).toBe(0);                       // target.id !== 'sky'（demo L4730）
  });
});

describe('视差跟随（demo L4733-4737）', () => {
  it('pointermove 更新目标值；layer.parallax=false→目标归零', () => {
    const h = mountSky(makeSkyCanvas());
    const W = h.s.W, H = h.s.H;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: W * 0.75, clientY: H * 0.25 }));
    expect(h.s.tx).toBeCloseTo(0.5, 10);
    expect(h.s.ty).toBeCloseTo(-0.5, 10);
    window.__skyCtl!.layer('parallax', false);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: W * 0.75, clientY: H * 0.25 }));
    expect(h.s.tx).toBe(0);
    expect(h.s.ty).toBe(0);
  });
});
