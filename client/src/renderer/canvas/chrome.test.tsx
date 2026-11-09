// @vitest-environment jsdom
// CanvasChrome 装配 + 注册面形状用例（T3-01；C-01 §6.4/§6.5 断言面的组件侧先行项）。
// jsdom 缺 ResizeObserver（@xyflow/react 渲染依赖）——顶部 stub；React 19 需显式 act 环境。
// （main 侧安全基线静态断言在 security-baseline.test.ts——node 环境，file:// 定位可靠。）
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { CanvasChrome, ZOOM_MAX, ZOOM_MIN } from './CanvasChrome';
import { edgeTypes, nodeTypes } from './node-types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

async function mount(ui: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return { container, root };
}

describe('注册面（单一映射，registry 驱动）', () => {
  it('nodeTypes 单键 constella-node、edgeTypes 单键 constella-edge（不逐 type 注册）', () => {
    expect(Object.keys(nodeTypes)).toEqual(['constella-node']);
    expect(Object.keys(edgeTypes)).toEqual(['constella-edge']);
    expect(typeof nodeTypes['constella-node']).toBe('function');
    expect(typeof edgeTypes['constella-edge']).toBe('function');
  });
});

describe('CanvasChrome 装配（jsdom 渲染冒烟）', () => {
  it('渲染 MiniMap / Controls / Background 与缩放条（demo L1329/L1345 25%–200%）', async () => {
    const { container, root } = await mount(<CanvasChrome />);
    try {
      expect(container.querySelector('.react-flow__minimap')).toBeTruthy();
      expect(container.querySelector('.react-flow__controls')).toBeTruthy();
      expect(container.querySelector('.react-flow__background')).toBeTruthy();
      const zoombar = container.querySelector('.cn-zoombar');
      expect(zoombar).toBeTruthy();
      // 初始 zoom=1（100%）；缩放边界常量=ZMIN 0.25 / ZMAX 2
      expect(zoombar?.querySelector('[data-testid="canvas-zoom-percent"]')?.textContent).toBe('100%');
      expect(ZOOM_MIN).toBe(0.25);
      expect(ZOOM_MAX).toBe(2);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
