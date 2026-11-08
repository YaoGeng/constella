// Constella client — renderer 最小占位（T0-08）：console 级冒烟，验证 app:// 协议加载 ESM 产物链路。
// P3 波 C-01 替换为 CanvasModule 挂载（react 19.3.1 / @xyflow 12.12.1 / zustand / zundo——按 T0-08 约束随 P3 波才安装）。

const root = document.querySelector('#root');
if (root) root.textContent = 'Constella client shell booted (app:// protocol, T0-08 minimal shell)';

console.log('[constella-renderer] client shell booted via app:// protocol');
