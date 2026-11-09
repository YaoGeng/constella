// LaneProjector —— 按 runId 的 lanes 端口投影（T4-06；TDD-C-04 §1 LaneProjector 行——
// ✅ M4 收口会签 #3 导出面；C-10 任务表 RunRow.cdpPorts 数据源〔P6〕，L2 被 L3 消费方向合法）。
//
// portsOf=cdp:listSessions 投影按 runId 过滤（lanes.cdp_port，02 §7.1）——同步查询走
// CdpSessionsModel 投影缓存（新鲜度=消费方 refresh 驱动）；onLanesChange=台账 upsert/close
// 事务点后按 runId 广播（renderer 可见形=投影 diff，见 cdp-sessions-model）。
import type { CdpSessionsModel } from './cdp-sessions-model';

/** §1 LaneProjector 接口（TDD-C-04 §1 逐字） */
export interface LaneProjector {
  portsOf(runId: string): number[];
  onLanesChange(fn: (runId: string) => void): () => void;
}

export function createLaneProjector(model: CdpSessionsModel): LaneProjector {
  return {
    portsOf: (runId: string) => model.sessionsOf(runId).map((s) => s.port),
    onLanesChange: (fn: (runId: string) => void) => model.onChange(fn),
  };
}
