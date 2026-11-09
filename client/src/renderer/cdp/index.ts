// cdp 半段导出面（C-04；T4-05 交付=lane 生命周期规格＋端口池＋CdpOps＋CommandTransport＋
// CookieSemantics；T4-06 交付=管理面 UI 四组件〔CdpDock/SessionViewer/SessionProbe/
// LaneProjector〕＋注入通道面＋投影模型——TDD-C-04 §1 管理面段＋§3 后四组件行）。
// 消费方：C-03 LaneManager/ExecDispatcher（T4-02/T4-03）；LaneProjector=C-10 任务表 cdpPorts
// 列（P6——本卡只交付导出面）；SessionProbe=C-03 断连决策输入＋B-9 顶栏 pill（同源）。
// 画布挂载装配（dock 挂画布右上/查看窗 overlay/preload 通道接线）随 P5 应用壳，本模块不触 canvas/。
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
// —— T4-06 管理面 ——
export { createPreloadCdpChannels, type CdpManagerApiFace, type CdpManagerChannels } from './manager-channels';
export { createCdpSessionsModel, stripUrlProtocol, type CdpSessionsModel } from './cdp-sessions-model';
export { CdpDock, createCdpDockFace, type CdpDockFace, type CdpDockProps } from './CdpDock';
export {
  createSessionViewer,
  SessionViewerPanel,
  type SessionViewer,
  type SessionViewerController,
  type SessionViewerPanelProps,
  type ViewerEntry,
} from './SessionViewer';
export { createSessionProbe, type SessionProbe } from './session-probe';
export { createLaneProjector, type LaneProjector } from './lane-projector';
