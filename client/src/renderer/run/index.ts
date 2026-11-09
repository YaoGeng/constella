// run 半段导出面（TDD-C-03 §1/§3；T4-01 骨架：RunGate/TopoPlanner/RunLedger/RunEngine）。
export { createRunEngine } from './run-engine';
export type { RunEngine, RunEngineDeps } from './run-engine';
export { RunGate } from './run-gate';
export type { RunGateDeps } from './run-gate';
export { TopoPlanner, findTriggers } from './topo-planner';
export type { TopoPlan } from './topo-planner';
export { RunLedger } from './run-ledger';
export type { LedgerEntry, LedgerStatus, OpenLedgerInput } from './run-ledger';
export type {
  GateReason,
  GateResult,
  LogLine,
  NodeStatus,
  NodeStatusEvent,
  NotifyFn,
  RunHandle,
  RunRegistryLike,
  RunTransport,
} from './types';
