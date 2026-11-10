// RunRowProjector —— 行模型投影纯函数（T6-10；TDD-C-10 §1 RunRow 形＋§3 RunRowProjector 行）。
//
// 任务表行 = run 记录＋statuses 镜像＋CDP 端口投影＋节点实例名解析 → RunRow（01 A-9.1 列语义；
// demo L2770-2790 renderTasks 行为源）。纯函数零运行时依赖：数据/端口/名称全入参注入——
// runs$ 装配（本卡 runs-source）与重放管线（T6-11 LogReplayService）与测试共用同一点。
// imports ↓ 仅类型：C-03 runStore statuses 形（NodeStatus/RunMirror）＋X-01 runs 行形（RunStatus/RunSummary）。
import type { NodeStatus } from '../run';
import type { RunStatus, RunSummary } from '@constella/shared/ipc';

/** §1 RunRow 形（逐字——02 §3.2 C-10 行 runs$ 载荷） */
export interface RunRow {
  runId: string;
  flowId: string;
  flowName: string;
  /** runs 表 status 五值（02 §7.1） */
  status: RunStatus;
  /** running/waiting 活动节点实例名（多分支「·」连接渲染——01 A-9.1；连接符渲染归 RunTable） */
  currentNodes: string[];
  /** done 计数/total=可达数（02 §10 #2；node_runs/statuses 投影） */
  progress: { done: number; total: number };
  /** 该 run lanes 端口投影「:9221/:9222」（01 A-9.1；数据源 C-04 LaneProjector.portsOf） */
  cdpPorts: number[];
  /** (t1||now)-t0（01 A-9.1；未结束行 1s 心跳刷新） */
  elapsedMs: number;
}

/**
 * project 入参 run 记录最小形（runs 表行子集——runs.list/RunLedger 经适配满足；装配/重放共用）。
 * statuses=终态行自带投影（DB 重放装载——T6-11 runs.get node_runs 投影填入；运行行实时态
 * 走 runStore 镜像，仅槽位 runId 一致时采用）。
 */
export interface TaskRunRecord {
  runId: string;
  flowId: string;
  flowName: string;
  status: RunStatus;
  t0: number;
  t1: number | null;
  /** 可达节点总数（02 §10 #2 total=可达数；缺省以 statuses 键数兜底） */
  total?: number;
  /** 终态行节点态附带（重放装载侧；运行行忽略——镜像优先） */
  statuses?: Readonly<Record<string, NodeStatus>>;
}

/** RunSummary（C-06 runs.list 行）→ TaskRunRecord 适配（重放装载侧消费——T6-11 §6.1g） */
export function runRecordFromSummary(r: RunSummary): TaskRunRecord {
  return { runId: r.id, flowId: r.flowId, flowName: r.name, status: r.status, t0: r.t0, t1: r.t1, total: r.total };
}

/** 未结束 run 判据（心跳派发面——demo L3088 `if(r.t1) continue` 同源：t1 已置位即冻结不刷） */
export function isRunUnfinished(rec: TaskRunRecord): boolean {
  return rec.t1 === null && (rec.status === 'running' || rec.status === 'waiting');
}

/** 状态点色映射（01 A-9.1：运行中=青/waiting=琥珀/失败终止=红；demo L87-89 dot.ok/wait/off 同源——done 沿 demo 归 ok） */
export type StatusTone = 'ok' | 'wait' | 'off';

export const STATUS_TONE: Record<RunStatus, StatusTone> = {
  running: 'ok',
  waiting: 'wait',
  done: 'ok',
  error: 'off',
  aborted: 'off',
};

/** 状态文案（demo L2772 stTxt 逐字） */
export const STATUS_LABEL: Record<RunStatus, string> = {
  running: '运行中',
  waiting: '待确认',
  done: '已完成',
  error: '失败',
  aborted: '已终止',
};

/** 用时 mm:ss（demo L1753 fmtDur 同形） */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 运行中 run 计数（导航徽标数据——demo L2763-2767 renderNavBadge：n=running 计数，0=隐藏） */
export function runningCountOf(rows: readonly RunRow[]): number {
  return rows.filter((r) => r.status === 'running').length;
}

/** 节点实例名解析位（flowId 已绑定于调用侧——resolver 只按 nodeId 取实例名，缺名回退「…」） */
export type NodeNameResolver = (nodeId: string) => string;

/**
 * §3 RunRowProjector 纯函数（签名逐字 project(run,statuses,ports,nodeName)）。
 * now=可选第 5 参（缺省 Date.now()——elapsedMs=(t1||now)-t0 的测试注入与心跳重投影位；
 * 四参调用语义不变）。
 */
export function project(
  run: TaskRunRecord,
  statuses: Readonly<Record<string, NodeStatus>>,
  ports: readonly number[],
  nodeName: NodeNameResolver,
  now: number = Date.now(),
): RunRow {
  const done = Object.values(statuses).filter((s) => s === 'done').length;
  const total = run.total ?? Object.keys(statuses).length;
  const currentNodes =
    run.status === 'running' || run.status === 'waiting'
      ? Object.entries(statuses)
          .filter(([, s]) => s === 'running' || s === 'waiting')
          .map(([id]) => nodeName(id) || '…') // 实例名缺席回退（demo L2775 ||'…'）
      : [];
  return {
    runId: run.runId,
    flowId: run.flowId,
    flowName: run.flowName,
    status: run.status,
    currentNodes,
    progress: { done, total },
    cdpPorts: [...ports],
    elapsedMs: (run.t1 ?? now) - run.t0,
  };
}
