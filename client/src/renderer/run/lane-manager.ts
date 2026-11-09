// LaneManager —— lane 键/标签台账＋lane 会话生命周期（TDD-C-03 §3 LaneManager 行；
// 02 §10 #4 扇出每支新 lane；A-8.1 会话语义源 demo L2808-2819/L2870；T4-02）。
// lane 分配：节点在派生时 assign（触发支=main/t:<id>；扇出支=支首节点 id/名——构造在
// DeliveryRouter，本组件只落表查询）。ensureSession 时机（A-8.1 生命周期表）：
//   lane 首个 cdp.* 节点 → cdp:createSession（隐藏窗/端口池/partition 分配在 main 侧）；
//   同 lane 后续 cdp.*   → 复用会话只更新 URL（携带新 url 才发 cdp:navigate）；
//   run 收尾统一销毁（cdp:destroyRun）＝终止/收敛组件（T4-03），不在本组件。
// 会话执行面（attach/端口池/partition）全在 main（重执行体在 main，02 §3.1）——
// 本组件经注入 Transport 只发指令（§8 替换点①，零 Electron 依赖）。
import type { Lane, RunTransport } from './types';

/** lane 会话台账行（createSession 返回的投影；partition 规格由 main 侧落） */
export interface LaneSession {
  port: number;
  partition: string;
  /** 最近一次导航 URL（create 的 startUrl 或后续 navigate） */
  url: string;
}

export interface LaneManagerDeps {
  runId: string;
  /** 执行面传输（缺省 → ensureSession 抛错：cdp.* 节点前置失败=节点 error） */
  transport?: RunTransport;
}

export class LaneManager {
  private readonly nodeLanes = new Map<string, Lane>();
  private readonly sessions = new Map<string, LaneSession>();

  constructor(private readonly deps: LaneManagerDeps) {}

  /** 节点 → lane 落表（派生时调用；laneLabel 随事件流导出＝02 §3.2 onNodeStatus） */
  assign(nodeId: string, lane: Lane): void {
    this.nodeLanes.set(nodeId, lane);
  }

  /** 节点所在 lane（未派生 → undefined） */
  laneOf(nodeId: string): Lane | undefined {
    return this.nodeLanes.get(nodeId);
  }

  /** laneKey → 会话台账（未建会话 → undefined；dock 投影/日志用） */
  sessionOf(laneKey: string): LaneSession | undefined {
    return this.sessions.get(laneKey);
  }

  /** 已建会话数（测试与收敛组件观测面） */
  sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * lane 会话确保（A-8.1）：首建 → cdp:createSession；复用 → 携带新 url 才 navigate
   * （「同 lane 后续只更新 URL」——无 url 参数的操作型节点〔extract/click〕复用不动）。
   * @param startUrl cdp.open 的目标 URL；操作型节点省略
   */
  async ensureSession(lane: Lane, startUrl?: string): Promise<LaneSession> {
    const transport = this.deps.transport;
    if (transport === undefined) {
      throw new Error('执行面传输未注入——无法建立 lane 会话');
    }
    const existing = this.sessions.get(lane.key);
    if (existing !== undefined) {
      if (startUrl !== undefined && startUrl !== existing.url) {
        await transport.cdpNavigate({ runId: this.deps.runId, laneKey: lane.key, url: startUrl });
        existing.url = startUrl;
      }
      return existing;
    }
    const url = startUrl ?? 'about:blank';
    const res = await transport.cdpCreateSession({
      runId: this.deps.runId,
      laneKey: lane.key,
      label: lane.label,
      startUrl: url,
    });
    const session: LaneSession = { port: res.port, partition: res.partition, url };
    this.sessions.set(lane.key, session);
    return session;
  }
}
