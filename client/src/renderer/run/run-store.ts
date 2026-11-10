// runStore —— 内存运行态镜像（02 §3.3 runStore 行；A-6.5 双写还原的 UI 消费面；T4-04）。
//   statuses 镜像=RunEngine 事件管线同点写入（切流程回来还能还原画面——demo viewStatuses
//   语义：lastRunOfFlow 取最近 run 含终态）；activeRunOfFlow=运行中位（画布运行态联动
//   数据源）；pendingHits=待处理断点登记（交互卡消费面随后续卡接线）。
// 写入面=RunEngine 装配点/HitCoordinator（事件同点）；消费=只读 selector（画布五态订阅）。
// 重启还原经 runs.get＋logs.list 重放（任务中心域），本 store 只承载运行期；不入历史栈。
import { create } from 'zustand';
import type { NodeStatus, NodeStatusEvent } from './types';

/** 待处理断点登记行 */
export interface PendingHit {
  runId: string;
  nodeId: string;
}

/** 最近 run 镜像（statuses=该 run 的节点态终值视图） */
export interface RunMirror {
  runId: string;
  statuses: Readonly<Record<string, NodeStatus>>;
}

export interface RunStoreState {
  /** flowId → 活跃 runId（运行中位数据源；run 收尾移除） */
  activeRunOfFlow: Readonly<Record<string, string>>;
  /** flowId → 最近 run（含终态；画布还原画面数据源） */
  lastRunOfFlow: Readonly<Record<string, RunMirror>>;
  /** hitId → 待处理断点 */
  pendingHits: Readonly<Record<string, PendingHit>>;
  /** run 创建后登记（RunEngine.startRun） */
  runOpened(flowId: string, runId: string): void;
  /** run 收尾解除活跃（终态画面保留 lastRunOfFlow） */
  runClosed(flowId: string, runId: string): void;
  /** 节点态镜像写入（StatusBus 事件管线同点，A-6.5） */
  nodeStatus(e: NodeStatusEvent, flowId: string): void;
  /**
   * 重启还原镜像重建（C-03 §4 委托承接——C-10 restoreRunState 消费面，T6-11 增补）。
   * statuses=runs.get node_runs 终态投影；仅重建 lastRunOfFlow（A-6.5 还原画面数据源）——
   * 不占用 activeRunOfFlow（重启后无活跃 run，运行中位由 startRun 重新登记）。
   */
  restoreRun(flowId: string, runId: string, statuses: Readonly<Record<string, NodeStatus>>): void;
  hitOpened(hitId: string, runId: string, nodeId: string): void;
  hitClosed(hitId: string): void;
  /** 测试隔离 */
  reset(): void;
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  activeRunOfFlow: {},
  lastRunOfFlow: {},
  pendingHits: {},

  runOpened: (flowId, runId) => {
    set({
      activeRunOfFlow: { ...get().activeRunOfFlow, [flowId]: runId },
      lastRunOfFlow: { ...get().lastRunOfFlow, [flowId]: { runId, statuses: {} } },
    });
  },

  runClosed: (flowId, runId) => {
    const active = get().activeRunOfFlow;
    if (active[flowId] !== runId) return;
    const { [flowId]: _drop, ...rest } = active;
    set({ activeRunOfFlow: rest });
  },

  nodeStatus: (e, flowId) => {
    const last = get().lastRunOfFlow[flowId];
    if (last === undefined || last.runId !== e.runId) return; // 非当前镜像 run（防御）
    set({
      lastRunOfFlow: {
        ...get().lastRunOfFlow,
        [flowId]: { runId: last.runId, statuses: { ...last.statuses, [e.nodeId]: e.status } },
      },
    });
  },

  restoreRun: (flowId, runId, statuses) => {
    set({
      lastRunOfFlow: { ...get().lastRunOfFlow, [flowId]: { runId, statuses } },
    });
  },

  hitOpened: (hitId, runId, nodeId) => {
    set({ pendingHits: { ...get().pendingHits, [hitId]: { runId, nodeId } } });
  },

  hitClosed: (hitId) => {
    const { [hitId]: _drop, ...rest } = get().pendingHits;
    set({ pendingHits: rest });
  },

  reset: () => set({ activeRunOfFlow: {}, lastRunOfFlow: {}, pendingHits: {} }),
}));
