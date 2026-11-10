// net 域导出面（T5-12a：NetProxyBridge 宿主＋N1 网络门——03 C-M1 §3 NetProxyBridge 行）。
export {
  NET_PORT_RANGE_MAIN,
  NetProxyBridge,
  nodeFetchImpl,
  type NetDenialRecord,
  type NetFetchImpl,
  type NetFetchParams,
  type NetFetchResponse,
  type NetFetchResult,
  type NetProxyBridgeDeps,
} from './net-proxy-bridge';
export { isNetCategory, NET_CATEGORY_MARK, netEligibleDefinition, nodeTypeOfScript } from './net-gate';
