// cdp:*＋env:cdpProbe 通道 handler（T4-18 / TDD-C-M1 §1 矩阵 Cdp 行）。
//
// 语义冻结（§1 矩阵）：
//   cdp:createSession  r→m  {runId,laneKey,label,startUrl} → {port,partition}
//                       （CDP-PORT-EXHAUSTED〔detail 含 lane 收敛提示〕/CDP-ATTACH-FAILED）
//   cdp:navigate       r→m  同 lane 复用只更新 URL（坑①先导航/坑④ enable＋loadEventFired＋轮询）
//                       （CDP-SESSION-NOT-FOUND/CDP-NAV-FAILED）
//   cdp:listSessions   r→m  lanes 台账投影；in-band 无会话→[]
//   cdp:openViewer     r→m  查看窗打开/置顶（✕ 只关窗，A-8.2）；CDP-SESSION-NOT-FOUND
//   cdp:destroyRun     r→m  run 收尾统一销毁；in-band 幂等 {ok:true}
//   env:cdpProbe       r→m  附栈会话探活；in-band 失败→{ok:false,detail}（B-9/B-14）
//
// 注册面：InvokeRegistry（缺省 AppRuntime.ipc〔IpcGateway，T4-14：payload 校验＋{code,message}
// 序列化〕；AppRuntimeDeps.invokeRegistry 注入缝——T4-15 SecretVault.init 同形）。
import {
  IPC_CHANNELS,
  type CreateSessionReq,
  type CreateSessionRes,
  type CdpProbeRes,
  type DestroyRunReq,
  type DestroyRunRes,
  type ListSessionsReq,
  type ListSessionsRes,
  type NavigateReq,
  type NavigateRes,
  type OpenViewerReq,
  type OpenViewerRes,
} from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';

/** 通道面消费的 CdpSessionManager 子集 */
export interface CdpChannelFace {
  createSession(req: CreateSessionReq): Promise<CreateSessionRes>;
  navigate(req: NavigateReq): Promise<NavigateRes>;
  listSessions(req: ListSessionsReq): Promise<ListSessionsRes>;
  openViewer(req: OpenViewerReq): Promise<OpenViewerRes>;
  destroyRun(req: DestroyRunReq): Promise<DestroyRunRes>;
  probe(): Promise<CdpProbeRes>;
}

/** 注册 cdp 域六通道（CdpSessionManager.init 经 AppRuntime 启动序挂载；重复注册由 IpcGateway 拒绝） */
export function registerCdpChannels(manager: CdpChannelFace, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.cdpCreateSession, (payload) => manager.createSession(payload as CreateSessionReq));
  registry.handle(IPC_CHANNELS.cdpNavigate, (payload) => manager.navigate(payload as NavigateReq));
  registry.handle(IPC_CHANNELS.cdpListSessions, (payload) => manager.listSessions(payload as ListSessionsReq));
  registry.handle(IPC_CHANNELS.cdpOpenViewer, (payload) => manager.openViewer(payload as OpenViewerReq));
  registry.handle(IPC_CHANNELS.cdpDestroyRun, (payload) => manager.destroyRun(payload as DestroyRunReq));
  registry.handle(IPC_CHANNELS.envCdpProbe, () => manager.probe());
}
