// @vitest-environment jsdom
// T6-13 / TDD-C-12 §1 宿主生命周期：<SkyBackground/> 挂载 canvas+帧循环+通道注册；
// 卸载=cancelAnimationFrame+移除监听+通道/样式摘除。（挂载到视图根=T6-17 应用壳卡。）
// React 19 显式 act 环境（同仓 chrome.test.tsx 模式）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkyBackground } from './sky-background';
import { installMatchMedia, installRaf, patchCanvas2D, resetSkyGlobals } from './testing';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('<SkyBackground/> 宿主（demo L586-588 DOM：#sky/#vignette/#fade）', () => {
  it('挂载：三兄弟 DOM+通道注册+样式注入+帧循环启动；卸载：rAF 取消/通道与样式摘除', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => { root.render(<SkyBackground />); });

    const canvas = document.querySelector('#sky');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(document.querySelector('#vignette')).not.toBeNull();
    expect(document.querySelector('#fade')).not.toBeNull();
    expect(window.__skyCtl).toBeDefined();                                  // 通道注册（demo L4761）
    expect(document.querySelector('style[data-constella-sky]')).not.toBeNull();
    expect(document.querySelector('style[data-constella-sky-motion]')).not.toBeNull();
    expect(raf.queued()).toBe(1);                                           // 帧循环已调度（demo L4759）

    const main = patch.ctxOf(canvas as HTMLCanvasElement);
    await act(async () => { raf.pump(1234); });                            // 帧循环跑通（jsdom canvas mock）
    expect(main.ops.length).toBeGreaterThan(0);
    const ops0 = main.ops.length;

    await act(async () => { root.unmount(); });
    expect(window.__skyCtl).toBeUndefined();                                // 通道移除
    expect(raf.cancelled().length).toBeGreaterThanOrEqual(1);               // cancelAnimationFrame（03 §1）
    expect(document.querySelector('style[data-constella-sky]')).toBeNull();
    expect(document.querySelector('style[data-constella-sky-motion]')).toBeNull();
    expect(document.querySelector('#sky')).toBeNull();                      // DOM 卸净

    // 监听已移除：卸载后窗口级 pointerdown 不再有副作用（无通道、无绘制）
    window.dispatchEvent(new MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }));
    expect(main.ops.length).toBe(ops0);
  });
});
