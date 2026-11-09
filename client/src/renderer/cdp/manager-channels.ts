// 管理面注入通道面（T4-06；TDD-C-04 §1 管理面段——通道面=C-M1 §1 矩阵 cdp:*/env:cdpProbe 行）。
//
// 管理面四组件（CdpDock/SessionViewer/SessionProbe/LaneProjector）只经本注入面消费通道：
//   cdp:listSessions  lanes 台账投影（dock 列表/LaneProjector portsOf 数据源；in-band 无会话→[]）
//   cdp:openViewer    查看窗打开/置顶（✕ 只关窗不中断自动化，A-8.2）
//   cdp:destroyRun    run 收尾统一销毁（消费归 C-03 终止组件——本面保留通道形完整性）
//   env:cdpProbe      附栈会话探活（in-band {ok,detail} 不 reject；B-9/B-14）
// 生产装配（P5 应用壳）=createPreloadCdpChannels(window.constella)——preload 白名单面
// （T4-14）零新通道；单测=mock 注入（组件经注入面测试）；真通道冒烟=manager-channels.smoke.spec。
import type {
  CdpProbeReq,
  CdpProbeRes,
  DestroyRunReq,
  DestroyRunRes,
  ListSessionsReq,
  ListSessionsRes,
  OpenViewerReq,
  OpenViewerRes,
} from '@constella/shared/ipc';
import type { ConstellaApi } from '../../preload/api';

/** 管理面通道消费子集（组件依赖注入位——X-01 payload 形直引，零通道名字面量） */
export interface CdpManagerChannels {
  listSessions(req: ListSessionsReq): Promise<ListSessionsRes>;
  openViewer(req: OpenViewerReq): Promise<OpenViewerRes>;
  destroyRun(req: DestroyRunReq): Promise<DestroyRunRes>;
  probe(req?: CdpProbeReq): Promise<CdpProbeRes>;
}

/** preload 白名单 API 的管理面键子集（window.constella 类型入口——纯类型引用，P-3 豁免） */
export type CdpManagerApiFace = Pick<
  ConstellaApi,
  'cdpListSessions' | 'cdpOpenViewer' | 'cdpDestroyRun' | 'envCdpProbe'
>;

/** 生产装配：preload 白名单 API → 管理面注入面（mock 解除位——真通道=T4-18 已挂载） */
export function createPreloadCdpChannels(api: CdpManagerApiFace): CdpManagerChannels {
  return {
    listSessions: (req) => api.cdpListSessions(req),
    openViewer: (req) => api.cdpOpenViewer(req),
    destroyRun: (req) => api.cdpDestroyRun(req),
    probe: (req) => api.envCdpProbe(req),
  };
}
