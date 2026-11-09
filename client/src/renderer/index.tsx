// Constella renderer 入口（T0-08 最小壳 → T3-01 起挂载 CanvasModule）。
// 经 app:// 特权协议加载（S-1 ③）；完整应用壳（header/任务中心/节点库）随 P5/P6 装配。
import { createRoot } from 'react-dom/client';
import './styles/tailwind.css';
import { CanvasChrome } from './canvas';

const rootEl = document.querySelector('#root');
if (rootEl) {
  createRoot(rootEl).render(<CanvasChrome />);
  console.log('[constella-renderer] CanvasModule booted (T3-01, app:// protocol)');
}
