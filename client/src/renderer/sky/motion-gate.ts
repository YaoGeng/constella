// C-12 MotionGate（TDD-C-12 §3 九组件之一）：prefers-reduced-motion 双路降级。
// 路① REDUCED 标志（demo L3132，挂载时求值一次）→ SkyFrameLoop 消 canvas 动态
//   （天球摆动/自转/闪烁幅度/流星卫星生成，demo L4505-4507/L4514/L4533/L4546/L4592/L4607/L4631/L4687/L4731）；
// 路② CSS 动画/过渡时长压 0.01ms（demo L579-581 媒体查询原文，挂载时注入 <style>）。
// 媒体查询由浏览器按系统设置生效（与 demo 同为静态双路，不互相触发）。

/** demo L579-581 原文 */
export const REDUCED_MOTION_CSS =
  '@media (prefers-reduced-motion:reduce){\n' +
  '  *,*::before,*::after{animation-duration:.01ms !important;transition-duration:.01ms !important}\n' +
  '}';

export interface MotionGate {
  /** demo L3132：matchMedia('(prefers-reduced-motion: reduce)').matches（创建时求值） */
  reduced(): boolean;
  /** 注入 0.01ms 降级样式（幂等） */
  installCss(): void;
  uninstallCss(): void;
}

export function createMotionGate(win: Window): MotionGate {
  const REDUCED = win.matchMedia('(prefers-reduced-motion: reduce)').matches;   // demo L3132
  let el: HTMLStyleElement | null = null;
  return {
    reduced: () => REDUCED,
    installCss() {
      if (el) return;
      const doc = win.document;
      el = doc.createElement('style');
      el.dataset.constellaSkyMotion = '1';
      el.textContent = REDUCED_MOTION_CSS;
      doc.head.appendChild(el);
    },
    uninstallCss() {
      el?.remove();
      el = null;
    },
  };
}
