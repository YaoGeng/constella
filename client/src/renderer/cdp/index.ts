// cdp 半段导出面（C-04；T4-05 交付=lane 生命周期规格＋端口池＋CdpOps＋CommandTransport＋
// CookieSemantics——TDD-C-04 §3 前 3 组件行＋CookieSemantics 行）。
// T4-06（CdpDock/SessionViewer/SessionProbe/LaneProjector——管理面 UI＋投影）届时并入本面；
// §1 管理面 UI 接口随该卡齐备。消费方：C-03 LaneManager/ExecDispatcher（T4-02/T4-03——
// run 侧 fake CommandTransport 换真 Transport 的接线归 T4-02 后续装配，本卡不触 run/）。
export {
  CDP_ATTACH_PROTOCOL,
  decideSessionAction,
  partitionOf,
  shouldCreate,
  type LaneSessionDecision,
  type LaneSessionRecord,
  type SessionPhase,
} from './lane-session-spec';
export { CDP_PORT_RANGE, createPortPool, type PortAllocation, type PortPool, type PortPoolExhausted, type PortProbe } from './port-pool';
export {
  BridgeCommandError,
  createCommandTransport,
  laneBridgeUrl,
  type BridgeCdpMethod,
  type CommandTransport,
  type WebSocketFactory,
  type WebSocketLike,
} from './command-transport';
export {
  createCdpOps,
  NotNavigatedError,
  type CdpClickOp,
  type CdpExtractOp,
  type CdpOps,
  type CdpOpsDeps,
  type CdpOpenOp,
  type LaneSessionPort,
} from './cdp-ops';
export { COOKIE_EXPIRES_SECONDS, cookieParamsOf, type CookieParams } from './cookie-semantics';
