// CdpSessionsModel —— cdp:listSessions 投影缓存＋变更广播（T4-06；TDD-C-04 §1 管理面段/
// §4 数据契约——「零自有表，本卡管理面只读投影」）。
//
// 台账（lanes 表）写入归 C-M1 main 内部面（upsert/close 事务点）——renderer 无推送通道
// （24 通道冻结，m→r 仅 run:scriptEvent/cron:fired/app:confirmClose），故事务点在 renderer
// 侧的可见形=refresh 后的投影 diff：createSession/navigate→upsert、destroyRun→close，
// 每次内容变化按 runId 广播（CdpDock 徽标列表/SessionViewer 面板/LaneProjector 订阅方
// 同一数据源）。refresh 触发=消费方挂载/装配点统一驱动（demo syncModeUI 同源，P5 应用壳）。
import type { LaneSessionInfo } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';

/** URL 去协议头显示（demo L2836 同源：`(url||'').replace(/^https?:\/\//,'')`） */
export function stripUrlProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** 投影缓存＋订阅面（dock/查看窗/LaneProjector 共享数据源） */
export interface CdpSessionsModel {
  /** 重查投影：内容变化（upsert/close 可见形）→ 按 runId 广播；通道异常向上抛（调用方定夺） */
  refresh(runId: string): Promise<void>;
  /** runId → 投影快照（同步；副本防御外部改动；未查/无会话=[]） */
  sessionsOf(runId: string): LaneSessionInfo[];
  /** 投影变化订阅（广播点=台账 upsert/close 事务点的 renderer 可见形）；返回退订 */
  onChange(fn: (runId: string) => void): () => void;
}

/** 投影行等值（laneKey/label/port/url 四字段——upsert/close 外的字段变化不可见） */
function sameSessions(a: LaneSessionInfo[], b: LaneSessionInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.laneKey === b[i]!.laneKey &&
      s.label === b[i]!.label &&
      s.port === b[i]!.port &&
      s.url === b[i]!.url,
  );
}

export function createCdpSessionsModel(channels: CdpManagerChannels): CdpSessionsModel {
  const cache = new Map<string, LaneSessionInfo[]>();
  const listeners = new Set<(runId: string) => void>();
  return {
    async refresh(runId: string): Promise<void> {
      const sessions = await channels.listSessions({ runId });
      const prev = cache.get(runId);
      if (prev === undefined) {
        // 首次观测：空投影=无台账事务可见形（静默建基线）；非空=订阅前已有 upsert
        // （运行中挂载 dock 等）——数据到达须广播
        cache.set(runId, sessions);
        if (sessions.length > 0) for (const fn of [...listeners]) fn(runId);
        return;
      }
      if (sameSessions(prev, sessions)) return; // upsert/close 均无可见形：静默
      cache.set(runId, sessions);
      for (const fn of [...listeners]) fn(runId);
    },
    sessionsOf(runId: string): LaneSessionInfo[] {
      return [...(cache.get(runId) ?? [])];
    },
    onChange(fn: (runId: string) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
