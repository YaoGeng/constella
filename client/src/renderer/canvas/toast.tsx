// CanvasToast —— 画布域最小 toast 队列（T3-03；C-01 §3 FlowEdge 行「点击删除＋toast」；
// demo toast 同源语义）。全局 uiStore（02 §3.3 toast 队列）是应用壳层——本组件是 canvas 域
// 内自持的最小实现（P-3 边界：不 import 应用壳）；装配壳如需统一 toast 队列，P6 C-11 时经
// Provider 替换渲染层即可。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastPusher = (text: string) => void;

const CanvasToastContext = createContext<ToastPusher>(() => {});

export { CanvasToastContext };

export function useCanvasToast(): ToastPusher {
  return useContext(CanvasToastContext);
}

interface ToastEntry {
  id: number;
  text: string;
}

/** 3.2s 自动消隐；同文案多条并存（demo 行为：每次动作独立提示）。 */
export function CanvasToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const seq = useRef(0);

  const push = useCallback<ToastPusher>((text) => {
    const id = ++seq.current;
    setEntries((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setEntries((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <CanvasToastContext.Provider value={value}>
      {children}
      <div className="cn-toast-stack">
        {entries.map((t) => (
          <div key={t.id} className="cn-toast" role="status">
            {t.text}
          </div>
        ))}
      </div>
    </CanvasToastContext.Provider>
  );
}
