// runs$·logs$ Bus —— 订阅分发面（T6-11；TDD-C-10 §1 契约面＋§3 Bus 行）。
//   logs$：实时日志行流（§1 `subscribe(fn: (line: LogLine) => void)`）——上游=C-03 onRunLog
//   （事件面注入，publish 单点进入），分发到 N 订阅方各恰一次（全局 tab＋流程面板双路，
//   A-9.2/A-9.3）；全局缓冲 snapshot=GlobalLogTab 渲染面（clear=全局清——A-9.2 跟 tab 语义）。
//   runs$：包裹 T6-10 RunsSource（asRuns$——subscribe/snapshot 透传；§3「runs$ 可包裹」）。
//   P-3：零 IPC 直连——onRunLog/RunsSource 均注入位（装配归应用壳 T6-17）。
import type { LogLine } from '../run';
import type { RunRow } from './run-row';
import type { RunsSource } from './runs-source';

/** §1 runs$ 契约面（subscribe/snapshot——02 §3.2 C-10 行载荷） */
export interface Runs$ {
  subscribe(fn: (rows: RunRow[]) => void): () => void;
  snapshot(): RunRow[];
}

/** runs$ 包裹（T6-10 RunsSource 透传——§3 Bus 行「runs$ 可包裹」；徽标/任务表数据源） */
export function asRuns$(source: RunsSource): Runs$ {
  return {
    subscribe: (fn) => source.subscribe(fn),
    snapshot: () => source.snapshot(),
  };
}

/** C-03 onRunLog 订阅面结构子集（注入位——装配点接 RunEngine.onRunLog） */
export type RunLogSource = (fn: (line: LogLine) => void) => () => void;

/** logs$ Bus（§1 face＋全局缓冲；构造可接上游——onRunLog 事件→publish 单点） */
export interface LogsBus {
  /** §1 契约面：实时行流订阅（每行对每订阅方恰一次——双路分发基线） */
  subscribe(fn: (line: LogLine) => void): () => void;
  /** 缓冲变更信号（publish/clear 驱动——快照消费面 useSyncExternalStore 订阅位） */
  onChanged(fn: () => void): () => void;
  /** 上游接入唯一入口（C-03 onRunLog 装配点＝createLogsBus 参数化；测试直接驱动） */
  publish(line: LogLine): void;
  /** 全局缓冲快照（GlobalLogTab 渲染面；publish/clear 均产生新引用——useSyncExternalStore 兼容） */
  snapshot(): readonly LogLine[];
  /** 清空后空态文案判据（demo L2684「已清空」vs L739「暂无日志」；publish 复位） */
  wasCleared(): boolean;
  /** 清空=全局清（A-9.2 日志 tab 语义；仅内存缓冲——持久 logs 归 C-03/C-06，无 clear op） */
  clear(): void;
  /** 生命周期收口：清订阅（上游退订归装配点 dispose 序） */
  dispose(): void;
}

export function createLogsBus(onRunLog?: RunLogSource): LogsBus {
  const listeners = new Set<(line: LogLine) => void>();
  const changeListeners = new Set<() => void>();
  let buffer: LogLine[] = [];
  let cleared = false;
  const bus: LogsBus = {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onChanged(fn) {
      changeListeners.add(fn);
      return () => {
        changeListeners.delete(fn);
      };
    },
    publish(line) {
      buffer = [...buffer, line]; // 新引用（React 快照订阅面）
      cleared = false;
      for (const fn of [...listeners]) fn(line); // 每订阅方恰一次（双路各恰一次追加的基线）
      for (const fn of [...changeListeners]) fn();
    },
    snapshot: () => buffer,
    wasCleared: () => cleared,
    clear() {
      buffer = [];
      cleared = true;
      for (const fn of [...changeListeners]) fn(); // 快照消费面重渲染驱动
    },
    dispose() {
      listeners.clear();
      changeListeners.clear();
    },
  };
  if (onRunLog !== undefined) onRunLog((line) => bus.publish(line)); // 上游事件→publish 单点
  return bus;
}
