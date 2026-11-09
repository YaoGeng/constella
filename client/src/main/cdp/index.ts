// cdp 域导出面（T4-18 / TDD-C-M1 §3 CdpSessionManager·PortPool·CdpBridge 三组件＋通道挂载）。
// 消费方：AppRuntime 装配（service-slots CdpSessionManagerSlot——index.ts 组合根接线随 T4-20 组收尾）、
// SandboxExecutor env 组装（CONSTELLA_CDP_WS=endpointOf(laneKey)，T4-16 消费）、head-run 测试链。
export { CdpChannelError } from './errors';
export { CdpBridge, createWssServer, type CdpBridgeFace, type BridgeListenOptions, type BridgeServerFactory, type BridgeSocket, type BoundBridgeServer, type CdpCommandTarget, type CdpCommandTargetProvider } from './cdp-bridge';
export {
  CDP_ATTACH_PROTOCOL_MAIN,
  CdpSessionManager,
  partitionOfLane,
  type CdpBrowserWindowConstructor,
  type CdpDebuggerFace,
  type CdpSessionManagerDeps,
  type CdpWebContentsFace,
  type CdpWindowFace,
  type ViewerOpenerFace,
} from './cdp-session-manager';
export { registerCdpChannels, type CdpChannelFace } from './cdp-channels';
export { InMemoryLanesLedger, type LaneLedgerRecord, type LanesLedger } from './lanes-ledger';
export { CDP_PORT_RANGE_MAIN, CdpPortPool, probePortOccupied, type PortOccupiedProbe, type PortPoolRange } from './port-pool';
