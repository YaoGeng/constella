// createRunsSource —— runs 数据装配（T6-10；TDD-C-10 §1 runs$ 快照面的本卡交付段）。
//
// 「run 记录快照 × C-03 runStore statuses 镜像 × C-04 端口投影 × 节点实例名解析」→
// RunRow 列表快照＋订阅分发；HeartbeatTicker 驱动未结束行 1s 重投影（elapsedMs 随拍推进、
// t1 行冻结）。任务表/导航徽标数据源（应用壳 T6-17 挂载消费）。
//
// 边界（P-3）：数据全部注入（runs.list 冷装载/收尾刷新=refresh 注入位——重放一致性归
// T6-11 LogReplayService；logs$ 双路分发/重放同归 T6-11 runs$·logs$ Bus 收口）。零 IPC 直连。
import type { NodeStatus, RunMirror } from '../run';
import { HeartbeatTicker } from './heartbeat-ticker';
import { isRunUnfinished, project, type RunRow, type TaskRunRecord } from './run-row';
import { resolveLocateTarget, type LocateTarget } from './locate-run';

/**
 * C-03 runStore 只读订阅面（结构子集——zustand useRunStore 满足；测试注入 fake）。
 * 只读：statuses 镜像消费（写入口=RunEngine 事件管线，02 §3.3——本模块零写入）。
 */
export interface RunStoreLike {
  getState(): { lastRunOfFlow: Readonly<Record<string, RunMirror>> };
  subscribe(fn: (state: { lastRunOfFlow: Readonly<Record<string, RunMirror>> }) => void): () => void;
}

export interface RunsSourceDeps {
  /** run 记录快照（装配点注入——冷装载/收尾刷新数据面；异步重放装载归 T6-11） */
  listRuns(): readonly TaskRunRecord[];
  /** C-03 runStore 镜像（statuses 数据源——槽位 runId 一致才采用） */
  runStore: RunStoreLike;
  /** C-04 LaneProjector.portsOf(runId) 投影（cdpPorts 列） */
  portsOf(runId: string): readonly number[];
  /** 节点实例名解析（flows.get 只读快照缓存——T6-11 LogReplayService.nodeName 接管） */
  nodeName(flowId: string, nodeId: string): string;
  /** 时钟（缺省 Date.now——elapsedMs/心跳拍） */
  now?(): number;
  /** 心跳间隔（缺省 1000ms；测试注入） */
  intervalMs?: number;
}

/** runs$ 面（§1 子集：subscribe/snapshot——T6-11 Bus 并轨；快照引用在两次发射间稳定） */
export interface RunsSource {
  subscribe(fn: (rows: RunRow[]) => void): () => void;
  snapshot(): RunRow[];
  /** run 记录快照替换（收尾/重放装载驱动——未结束集变化联动起停心跳） */
  setRuns(records: readonly TaskRunRecord[]): void;
  /** 重读注入的 listRuns（冷装载/收尾刷新驱动位） */
  refresh(): void;
  /** 任务 tab 清空（§6.1e——A-9.2：仅清已结束 run、运行中/待确认保留；demo L2687-2688 同源） */
  clearFinished(): void;
  /** 定位目标解析（T6-11 locate-run：runId→{flowId,focusNodeId}——镜像槽位 statuses 优先） */
  locateTargetOf(runId: string): LocateTarget | null;
  /** 未结束 runId 列表（心跳判据观测位） */
  unfinishedRunIds(): readonly string[];
  /** 生命周期收口：退订 runStore＋停心跳 */
  dispose(): void;
}

export function createRunsSource(deps: RunsSourceDeps): RunsSource {
  const { runStore, portsOf, nodeName } = deps;
  const now = deps.now ?? (() => Date.now());
  let records: readonly TaskRunRecord[] = deps.listRuns();
  let rows: RunRow[] = [];
  const listeners = new Set<(rows: RunRow[]) => void>();

  /** 心跳：仅未结束 run 派 tick → 快照重投影（t1 行 elapsedMs 自然冻结） */
  const ticker = new HeartbeatTicker({
    getUnfinishedRunIds: () => unfinishedRunIds(),
    ...(deps.intervalMs !== undefined ? { intervalMs: deps.intervalMs } : {}),
  });

  function unfinishedRunIds(): readonly string[] {
    return records.filter(isRunUnfinished).map((r) => r.runId);
  }

  /** 槽位镜像 statuses：flowId 槽位的最近 run 与记录一致才采用（防半更新串台）；终态行回退记录自带 statuses */
  function statusesOf(rec: TaskRunRecord): Readonly<Record<string, NodeStatus>> {
    const mirror = runStore.getState().lastRunOfFlow[rec.flowId];
    if (mirror !== undefined && mirror.runId === rec.runId) return mirror.statuses;
    return rec.statuses ?? {};
  }

  function reproject(): void {
    rows = records.map((rec) =>
      project(rec, statusesOf(rec), portsOf(rec.runId), (id) => nodeName(rec.flowId, id), now()),
    );
    for (const fn of [...listeners]) fn(rows);
  }

  /** 记录集变化后联动心跳起停（无未结束 run 即停——省电） */
  function syncTicker(): void {
    if (unfinishedRunIds().length > 0) ticker.start();
    else ticker.stop();
  }

  const unsubStore = runStore.subscribe(() => reproject());
  ticker.onTick(() => reproject());
  syncTicker();
  reproject();

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot() {
      return rows;
    },
    setRuns(next) {
      records = next;
      syncTicker();
      reproject();
    },
    refresh() {
      records = deps.listRuns();
      syncTicker();
      reproject();
    },
    clearFinished() {
      records = records.filter(isRunUnfinished); // 保留 running/waiting（未结束——03 §1「运行中保留」）
      syncTicker();
      reproject();
    },
    locateTargetOf(runId) {
      const rec = records.find((r) => r.runId === runId);
      if (rec === undefined) return null;
      return resolveLocateTarget(rec, statusesOf(rec));
    },
    unfinishedRunIds,
    dispose() {
      unsubStore();
      ticker.stop();
      listeners.clear();
    },
  };
}
