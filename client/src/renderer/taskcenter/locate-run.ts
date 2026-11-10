// locate-run —— 任务表「定位」动作编排（T6-11；TDD-C-10 §1 定位行＋§3 TaskActions 编排承接）。
//   脏闸形态**本卡冻结=demo L2795-2797**：dirty → toast 拒绝（逐字文案）、不切换；
//   非 dirty → 切流程 → statuses 还原画面（A-6.5）→ panToNode 闪烁（A-3.01；无活动节点
//   回退 fitView——demo L2797-2798 renderNodes/renderEdges/fitView 序）。
//   P-3：切流程/还原/panToNode/fitView/toast/脏标记**全注入**（画布原语归 C-01、脏标记管线
//   归 flowStore——经应用壳接线，T6-17 把真原语接进 deps；本模块零 import 边）。
import type { LogLevel } from '@constella/shared/ipc';
import type { NodeStatus } from '../run';
import type { TaskRunRecord } from './run-row';

/** 脏闸拒绝文案（冻结=demo L2796 逐字：toast('有未保存改动 — 先保存或取消','err')） */
export const LOCATE_DIRTY_TOAST = '有未保存改动 — 先保存或取消';

/** 定位编排原语注入位（T6-17 接线：guardDirty=T3-05 脏标记/FlowSwitcher=T3-08/C-01 panToNode·fitView/uiStore toast） */
export interface LocateRunDeps {
  /** 脏标记只读投影（true=有未保存改动——02 §3.3 脏标记管线） */
  isDirty(): boolean;
  /** 切流程（activeFlowId 切换——01 A-9.1「切换到该流程」） */
  switchFlow(flowId: string): void;
  /** statuses 还原画面（A-6.5 双写还原——runStore lastRunOfFlow 镜像→画布重绘消费） */
  restoreStatuses(flowId: string): void;
  /** 视野居中到节点并播放闪烁高亮（A-3.01 panToNode） */
  panToNode(flowId: string, nodeId: string): void;
  /** 视野适配回退（终态 run 无活动节点——demo L2798 fitView） */
  fitView(): void;
  /** toast 注入位（拒绝文案 err 级——uiStore toast 队列经应用壳接线） */
  toast(level: LogLevel, msg: string): void;
}

/** 定位目标（run 记录投影——focusNodeId=null 表示无活动节点走 fitView 回退） */
export interface LocateTarget {
  runId: string;
  flowId: string;
  focusNodeId: string | null;
}

/**
 * 脏闸编排（冻结形态）。返回 true=已执行切换链、false=被脏闸拒绝。
 * dirty → 仅 toast（原语零调用）；非 dirty → switchFlow→restoreStatuses→(panToNode|fitView)。
 */
export function locateRun(deps: LocateRunDeps, target: LocateTarget): boolean {
  if (deps.isDirty()) {
    deps.toast('err', LOCATE_DIRTY_TOAST); // demo L2796 逐字（冻结）
    return false;
  }
  deps.switchFlow(target.flowId);
  deps.restoreStatuses(target.flowId);
  if (target.focusNodeId !== null) deps.panToNode(target.flowId, target.focusNodeId);
  else deps.fitView(); // 终态 run 回退（demo L2798 fitView）
  return true;
}

/**
 * 定位目标解析（纯函数）：statuses 首个 running/waiting 节点=闪烁焦点（与 RunRow.currentNodes
 * 同判据）；终态 run/无活动节点 → focusNodeId=null。
 */
export function resolveLocateTarget(
  run: TaskRunRecord,
  statuses: Readonly<Record<string, NodeStatus>>,
): LocateTarget {
  let focusNodeId: string | null = null;
  if (run.status === 'running' || run.status === 'waiting') {
    for (const [nodeId, s] of Object.entries(statuses)) {
      if (s === 'running' || s === 'waiting') {
        focusNodeId = nodeId;
        break;
      }
    }
  }
  return { runId: run.runId, flowId: run.flowId, focusNodeId };
}

/** RunsSource 目标解析面（createGotoHandler 消费——locateTargetOf 由 runs-source 提供） */
export interface LocateSourceLike {
  locateTargetOf(runId: string): LocateTarget | null;
}

/**
 * goto(runId) 装配工厂：RunsSource.locateTargetOf(runId) → locateRun 脏闸编排。
 * 应用壳以本工厂产物作 TaskCenterDeps.onGoto（未知 runId 安静 no-op）。
 */
export function createGotoHandler(source: LocateSourceLike, deps: LocateRunDeps): (runId: string) => void {
  return (runId: string): void => {
    const target = source.locateTargetOf(runId);
    if (target === null) return;
    locateRun(deps, target);
  };
}
