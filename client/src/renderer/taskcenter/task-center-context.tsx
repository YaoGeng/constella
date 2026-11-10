// TaskCenter 装配上下文（T6-10；TDD-C-10 §2 依赖方向的 React 落位；T6-11 扩展后段注入面）。
//   数据/动作全部注入（C-03 runStore 镜像＋abortRun、C-04 portsOf、C-06 flows.get 节点名、
//   应用壳定位编排）——TaskCenterPanel §3「无 props」的接线面在此：Provider 挂载归应用壳
//   （T6-17），本卡交付组件与上下文件。
//   T6-11 增补：logs$ Bus（GlobalLogTab 数据面＋清空）；locate 定位原语（提供时 onGoto 经
//   locate-run 脏闸编排——冻结形态 demo L2795-2797）；cron missed 提示 store（restoreRunState
//   产出装配位）；lane 会话内存快照（mock 先行）。
//   P-3：零 IPC 直连、不 import canvas/workshop/settings/sky——activeFlowId/Esc 层级仲裁
//   均为注入位（flowStore 只读投影由应用壳下发）。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { LaneMemory } from '@constella/shared/ipc';
import { createRunsSource, type RunsSource, type RunsSourceDeps } from './runs-source';
import { createGotoHandler, type LocateRunDeps } from './locate-run';
import { createLogsBus, type LogsBus } from './runs-bus';
import { createMissedNoticeStore, type MissedNoticeStore } from './task-notices';
import type { CronMissedNotice } from './log-replay-service';
import type { LogLine } from '../run';
import type { RunRow } from './run-row';

/** 装配依赖（RunsSourceDeps 数据面＋动作/仲裁注入位）；需引用稳定（应用壳一次构造） */
export interface TaskCenterDeps extends RunsSourceDeps {
  /** C-03 abortRun 注入（行内终止——02 §10 #8；注入方幂等＋TaskActions 单次派发） */
  abortRun(runId: string): void;
  /** 定位编排注入位（应用壳直通编排——locate 缺席时的回退路径） */
  onGoto(runId: string): void;
  /** activeFlowId 只读投影注入位（定位钮显隐判据 flowId≠activeFlow——demo L2789；缺省 null=恒显示） */
  activeFlowId?(): string | null;
  /** Esc 层级仲裁注入位（A-1.4「CDP 查看窗→抽屉→任务中心→弹窗」——false=上层浮层在场，
   *  本层不应答；缺省=开即应答。全局层级序接线归应用壳 T6-17） */
  escGate?(): boolean;
  /** logs$ Bus 注入（T6-11——GlobalLogTab 数据面/清空；缺省=空 bus 日志 tab 静默） */
  logs?: LogsBus;
  /** 定位原语注入（T6-11——提供时 onGoto 经 locate-run 脏闸编排：dirty→toast 拒绝不切换） */
  locate?: LocateRunDeps;
  /** lane 会话内存快照注入位（T6-11 §8① mock 先行——数据面随 C-M1 env:systemInfo lanes） */
  laneMemories?(): readonly LaneMemory[];
}

/** 上下文值（source=runs$ 快照面＋logs$＋提示 store＋注入动作） */
export interface TaskCenterHandle {
  source: RunsSource;
  /** logs$ Bus（缺省注入时空 bus——面板消费不炸） */
  logs: LogsBus;
  /** cron missed 提示 store（restoreRunState 产出→setMissed；面板提示行渲染面） */
  notices: MissedNoticeStore;
  abortRun(runId: string): void;
  onGoto(runId: string): void;
  activeFlowId(): string | null;
  escGate(): boolean;
  /** lane 会话内存快照（注入缺位→空数组） */
  laneMemories(): readonly LaneMemory[];
}

const EMPTY_ROWS: RunRow[] = [];
const EMPTY_LINES: readonly LogLine[] = [];
const EMPTY_LANES: readonly LaneMemory[] = [];
const EMPTY_NOTICES: readonly CronMissedNotice[] = [];

export const TaskCenterContext = createContext<TaskCenterHandle | null>(null);

export function TaskCenterProvider({ deps, children }: { deps: TaskCenterDeps; children: ReactNode }) {
  const [handle, ownsLogs] = useMemo<[TaskCenterHandle, boolean]>(() => {
    const source = createRunsSource(deps);
    const ownsLogs = deps.logs === undefined;
    const logs = deps.logs ?? createLogsBus();
    const notices = createMissedNoticeStore();
    const onGoto =
      deps.locate !== undefined ? createGotoHandler(source, deps.locate) : (runId: string) => deps.onGoto(runId);
    return [
      {
        source,
        logs,
        notices,
        abortRun: (runId) => deps.abortRun(runId),
        onGoto,
        activeFlowId: () => deps.activeFlowId?.() ?? null,
        escGate: () => deps.escGate?.() ?? true,
        laneMemories: () => deps.laneMemories?.() ?? EMPTY_LANES,
      },
      ownsLogs,
    ];
    // deps 引用稳定由装配点保证（应用壳一次构造）；重挂 Provider=重建源（dispose 见下）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  useEffect(
    () => () => {
      handle.source.dispose();
      if (ownsLogs) handle.logs.dispose(); // 自建 bus 随 Provider 收口；注入 bus 生命周期归装配方
    },
    [handle, ownsLogs],
  );
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

/** 全局日志行订阅（logs$ 快照＋清空位——GlobalLogTab 渲染面；合并快照引用稳定化） */
export function useGlobalLogLines(): { lines: readonly LogLine[]; cleared: boolean } {
  const handle = useContext(TaskCenterContext);
  const cache = useRef<{ lines: readonly LogLine[]; cleared: boolean; out: { lines: readonly LogLine[]; cleared: boolean } } | null>(null);
  const subscribe = useCallback(
    (onStoreChange: () => void) => handle?.logs.onChanged(() => onStoreChange()) ?? (() => {}),
    [handle],
  );
  const getSnapshot = useCallback((): { lines: readonly LogLine[]; cleared: boolean } => {
    const lines = handle?.logs.snapshot() ?? EMPTY_LINES;
    const cleared = handle?.logs.wasCleared() ?? false;
    const last = cache.current;
    if (last === null || last.lines !== lines || last.cleared !== cleared) {
      const out = { lines, cleared };
      cache.current = { lines, cleared, out };
      return out;
    }
    return last.out; // 引用稳定（publish/clear 产生新 lines 才换）
  }, [handle]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** cron missed 提示订阅（§8②——restoreRunState 异步产出驱动） */
export function useMissedNotices(): readonly CronMissedNotice[] {
  const handle = useContext(TaskCenterContext);
  const subscribe = useCallback(
    (onStoreChange: () => void) => handle?.notices.subscribe(() => onStoreChange()) ?? (() => {}),
    [handle],
  );
  const getSnapshot = useCallback(() => handle?.notices.snapshot() ?? EMPTY_NOTICES, [handle]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
