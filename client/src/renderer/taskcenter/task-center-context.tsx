// TaskCenter 装配上下文（T6-10；TDD-C-10 §2 依赖方向的 React 落位）。
//   数据/动作全部注入（C-03 runStore 镜像＋abortRun、C-04 portsOf、C-06 flows.get 节点名、
//   应用壳定位编排）——TaskCenterPanel §3「无 props」的接线面在此：Provider 挂载归应用壳
//   （T6-17），本卡交付组件与上下文件。
//   P-3：零 IPC 直连、不 import canvas/workshop/settings/sky——activeFlowId/Esc 层级仲裁
//   均为注入位（flowStore 只读投影由应用壳下发）。
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createRunsSource, type RunsSource, type RunsSourceDeps } from './runs-source';
import type { RunRow } from './run-row';

/** 装配依赖（RunsSourceDeps 数据面＋动作/仲裁注入位）；需引用稳定（应用壳一次构造） */
export interface TaskCenterDeps extends RunsSourceDeps {
  /** C-03 abortRun 注入（行内终止——02 §10 #8；注入方幂等＋TaskActions 单次派发） */
  abortRun(runId: string): void;
  /** 定位编排注入位（应用壳：切流程+statuses 还原+panToNode；脏闸冻结形态归 T6-11） */
  onGoto(runId: string): void;
  /** activeFlowId 只读投影注入位（定位钮显隐判据 flowId≠activeFlow——demo L2789；缺省 null=恒显示） */
  activeFlowId?(): string | null;
  /** Esc 层级仲裁注入位（A-1.4「CDP 查看窗→抽屉→任务中心→弹窗」——false=上层浮层在场，
   *  本层不应答；缺省=开即应答。全局层级序接线归应用壳 T6-17） */
  escGate?(): boolean;
}

/** 上下文值（source=runs$ 快照面＋注入动作） */
export interface TaskCenterHandle {
  source: RunsSource;
  abortRun(runId: string): void;
  onGoto(runId: string): void;
  activeFlowId(): string | null;
  escGate(): boolean;
}

const EMPTY_ROWS: RunRow[] = [];

export const TaskCenterContext = createContext<TaskCenterHandle | null>(null);

export function TaskCenterProvider({ deps, children }: { deps: TaskCenterDeps; children: ReactNode }) {
  const handle = useMemo<TaskCenterHandle>(() => {
    const source = createRunsSource(deps);
    return {
      source,
      abortRun: (runId) => deps.abortRun(runId),
      onGoto: (runId) => deps.onGoto(runId),
      activeFlowId: () => deps.activeFlowId?.() ?? null,
      escGate: () => deps.escGate?.() ?? true,
    };
    // deps 引用稳定由装配点保证（应用壳一次构造）；重挂 Provider=重建源（dispose 见下）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  useEffect(() => () => handle.source.dispose(), [handle]);
  return <TaskCenterContext.Provider value={handle}>{children}</TaskCenterContext.Provider>;
}

/** 装配缺位防御：null=未挂 Provider（Panel 空任务面/无动作） */
export function useTaskCenter(): TaskCenterHandle | null {
  return useContext(TaskCenterContext);
}

/** 任务表行订阅（runs$ 快照→React 渲染面；心跳拍经快照重投影驱动刷新） */
export function useRunRows(): RunRow[] {
  const handle = useContext(TaskCenterContext);
  const subscribe = useCallback(
    (onStoreChange: () => void) => handle?.source.subscribe(() => onStoreChange()) ?? (() => {}),
    [handle],
  );
  const getSnapshot = useCallback(() => handle?.source.snapshot() ?? EMPTY_ROWS, [handle]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
