// cdp 域 payload（X-01 §1 ipc 行；02 §3.4 cdp:* 五通道；C-M1 §1 Cdp 行：
// partition=`persist:<flowId>·<laneLabel>`、debugger.attach('1.3')、隐藏窗口承载、
// attach 后先导航再发命令（S-3 坑①）；错误码 CDP-PORT-EXHAUSTED/CDP-ATTACH-FAILED/
// CDP-SESSION-NOT-FOUND/CDP-NAV-FAILED；in-band：listSessions 无会话→[]、destroyRun 幂等 {ok:true}）。

/** cdp:createSession（r→m）：{runId,laneKey,label,startUrl} → {port,partition}（02 §3.4；
 * lane 首个 cdp.* 节点创建会话，B-10；端口池 9221–9320＝PortPool，02 §3.2 C-04 行） */
export interface CreateSessionReq {
  runId: string;
  laneKey: string;
  label: string;
  startUrl: string;
}

export interface CreateSessionRes {
  port: number;
  partition: string;
}

/** cdp:navigate（r→m）：{runId,laneKey,url} → {ok}（02 §3.4；同 lane 复用会话只更新 URL，A-8.1） */
export interface NavigateReq {
  runId: string;
  laneKey: string;
  url: string;
}

export interface NavigateRes {
  ok: boolean;
}

/** cdp:listSessions（r→m）：{runId} → [{laneKey,label,port,url}]（02 §3.4；CDP dock 列表；
 * lanes 台账投影，02 §7.1 lanes 表；in-band 无会话→[]） */
export interface ListSessionsReq {
  runId: string;
}

export interface LaneSessionInfo {
  laneKey: string;
  label: string;
  port: number;
  url: string;
}

export type ListSessionsRes = LaneSessionInfo[];

/** cdp:openViewer（r→m）：{runId,laneKey} → {ok}（02 §3.4；查看窗打开/置顶，✕ 只关窗不中断
 * 自动化 A-8.2；错误码 CDP-SESSION-NOT-FOUND） */
export interface OpenViewerReq {
  runId: string;
  laneKey: string;
}

export interface OpenViewerRes {
  ok: boolean;
}

/** cdp:destroyRun（r→m）：{runId} → {ok}（02 §3.4；run 收尾统一销毁 A-6.4/A-8.1；
 * 保 dock 主窗存活（S-3 坑②）；in-band 幂等 {ok:true}） */
export interface DestroyRunReq {
  runId: string;
}

export interface DestroyRunRes {
  ok: boolean;
}
