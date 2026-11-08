// CapabilityBridge ws 帧协议形（✅ T0-07 会签冻结，2026-11-09；X-01 §1 ipc 行 ⑧；
// 细目锚 C-M1 §3 CdpBridge/NetProxyBridge 行；renderer C-03 CommandTransport 消费面）。
// 两桥统一帧形（CdpBridge lane 桥 ws://127.0.0.1:<lanePort> 与 NetProxyBridge
// ws://127.0.0.1:<netPort>——net 段 9321–9420 独立池）：
//   统一文本帧 JSON 请求 {"id":number,"ns":"cdp"|"net","method":string,"params":object}
//   → 成功 {"id",ok:true,result} ｜ 失败 {"id",ok:false,error:{code,message}}
// id 连接内单调递增、无服务端推送帧（V1.0；事件订阅=Vx）；仅监听 127.0.0.1（02 §12.3）；
// 服务端禁用 permessage-deflate（py 侧极简客户端前提）。
// ⚠ K-01 ts/py 同构复制本形、不 import 本域（K-01 §2 红线不变——一致性入 §6.5 对齐脚本覆盖面）。

/** 帧命名空间（cdp 桥 / net 代理桥） */
export type BridgeNs = 'cdp' | 'net';

/** 请求帧（统一文本帧 JSON；id 连接内单调递增） */
export interface BridgeRequest {
  id: number;
  ns: BridgeNs;
  method: string;
  params: Record<string, unknown>;
}

/** 成功响应帧 */
export interface BridgeOkResponse {
  id: number;
  ok: true;
  result: unknown;
}

/** 失败响应帧（帧错误码集见 BRIDGE_ERROR_CODES） */
export interface BridgeErrorResponse {
  id: number;
  ok: false;
  error: { code: BridgeErrorCode; message: string };
}

export type BridgeResponse = BridgeOkResponse | BridgeErrorResponse;

/** cdp 桥 method 白名单（9 项，T0-07 冻结；CDP 全名——D.querySelector 补全为 DOM.querySelector；
 * 白名单外＝BRIDGE-BAD-FRAME；同 renderer CommandTransport 同桥同安全面＝M4 裁决 3 延伸） */
export const BRIDGE_CDP_METHODS = [
  'Page.enable',
  'Page.navigate',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.getOuterHTML',
  'Input.dispatchMouseEvent',
  'Network.setCookie',
  'Network.getCookies',
] as const;

/** net 桥 method 白名单（NetProxyBridge：ns:'net'，method='fetch'——02 §12.1「一律经 main
 * 网络代理」；域名白名单＝节点 N1 权限类目（manifest「网络」perms 推导同源），
 * 白名单外默认拒绝→NET-DENIED 且拒绝事件日志可见） */
export const BRIDGE_NET_METHODS = ['fetch'] as const;

/** 帧错误码集（T0-07 会签：BRIDGE 系 / CDP 系 / NET-DENIED——与 IPC 同名码语义同源但分域，
 * 不经 contextBridge） */
export const BRIDGE_ERROR_CODES = {
  BRIDGE_TIMEOUT: 'BRIDGE-TIMEOUT',
  BRIDGE_CLOSED: 'BRIDGE-CLOSED',
  BRIDGE_BAD_FRAME: 'BRIDGE-BAD-FRAME',
  CDP_SESSION_NOT_FOUND: 'CDP-SESSION-NOT-FOUND',
  CDP_NAV_FAILED: 'CDP-NAV-FAILED',
  CDP_COMMAND_FAILED: 'CDP-COMMAND-FAILED',
  NET_DENIED: 'NET-DENIED',
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[keyof typeof BRIDGE_ERROR_CODES];
