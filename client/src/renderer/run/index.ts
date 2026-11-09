// run 半段导出面（TDD-C-03 §1/§3；T4-01 骨架＋T4-02 执行链四组件＋T4-03 级联/收敛/终止四组件）。
export { createRunEngine } from './run-engine';
export type { RunEngine, RunEngineDeps } from './run-engine';
export { RunGate } from './run-gate';
export type { RunGateDeps } from './run-gate';
export { TopoPlanner, findTriggers } from './topo-planner';
export type { TopoPlan } from './topo-planner';
export { RunLedger } from './run-ledger';
export type { LedgerEntry, LedgerStatus, OpenLedgerInput } from './run-ledger';
export { LaneManager } from './lane-manager';
export type { LaneManagerDeps, LaneSession } from './lane-manager';
export { DeliveryRouter } from './delivery-router';
export type { DeliveryPlan, DeliveryRouterDeps, DeliveryTarget } from './delivery-router';
export { BranchFilter, DeadEdgeCascader } from './branch-filter';
export type { BranchRoute, DeadEdgeCascaderDeps } from './branch-filter';
export { ConvergenceSweeper } from './convergence-sweeper';
export type { ConvergeOutcome, ConvergenceSweeperDeps } from './convergence-sweeper';
export { AbortCoordinator } from './abort-coordinator';
export type { AbortCoordinatorDeps, AbortHooks } from './abort-coordinator';
export { ExecDispatcher, ExecAbortedError } from './exec-dispatcher';
export type { ExecContext, ExecDispatcherDeps } from './exec-dispatcher';
export { createRunLoop } from './run-loop';
export type { RunConvergeOutcome, RunFlags, RunLoop, RunLoopDeps } from './run-loop';
export type {
  CommandTransport,
  GateReason,
  GateResult,
  Lane,
  LogLine,
  NodeStatus,
  NodeStatusEvent,
  NotifyFn,
  RunHandle,
  RunRegistryLike,
  RunTransport,
} from './types';
