// LogReplayService —— 重放管线（T6-11；TDD-C-10 §3 LogReplayService 行＋§1 restoreRunState）。
//   restoreRunState＝runs.list＋runs.get（含 node_runs）→ TaskRunRecord[] 装载（statuses 附带）
//   ＋runStore 镜像重建（C-03 §4「重启还原…（C-10 域）」委托承接——restoreMirror 注入位绑
//   真身 useRunStore.getState().restoreRun）＋cron missed 自算（§8②——settings `cron.lastAliveAt`
//   中转＋flows 提取 trigger.cron，(lastAliveAt, now] 窗口；A-6.6 只提示不补跑）。
//   replayLogs(flowId)＝logs.list{flowId} 重放（FlowLogPanel 打开/切流程消费——行序=持久序）；
//   nodeName＝flows.get 只读快照按 flowId 缓存（restoreRunState 预热；同步读——未预热回退空串，
//   RunRowProjector 兜底「…」）。
//   P-3：storage 全注入（C-06 storageClient 适配=createReplayStorage）；零 IPC 直连。
import type {
  FlowDoc,
  FlowListItem,
  LogRecord,
  NodeRunRecord,
  NodeRunStatus,
  RunDetail,
  RunSummary,
} from '@constella/shared/ipc';
import type { StorageClient } from '../storage';
import type { LogLine, NodeStatus } from '../run';
import { runRecordFromSummary, type TaskRunRecord } from './run-row';
import { computeMissedFires, type MissedFireSchedule } from './cron-missed';

/** 重放读面（C-06 注入——测试 fake／生产=createReplayStorage(storageClient)） */
export interface ReplayStorage {
  /** runs.list → {items}（C-06 §1 runs 域） */
  runsList(): Promise<RunSummary[]>;
  /** runs.get{runId} → 含 node_runs（statuses 终态投影数据源） */
  runsGet(runId: string): Promise<RunDetail>;
  /** logs.list{flowId} → 行序=持久序（重放一致性） */
  logsList(flowId: string): Promise<LogRecord[]>;
  /** flows.list → {items}（cron 提取流程枚举） */
  flowsList(): Promise<FlowListItem[]>;
  /** flows.get{id} → 节点实例名只读快照（nodeName 缓存源） */
  flowsGet(flowId: string): Promise<FlowDoc>;
  /** settings.getAll（cron.lastAliveAt 中转键——C-M1 §4③） */
  settingsGetAll(): Promise<Record<string, unknown>>;
}

/** storageClient → ReplayStorage 适配（T6-17 装配面） */
export function createReplayStorage(storage: StorageClient): ReplayStorage {
  return {
    runsList: async () => (await storage.invoke('runs.list', undefined)).items,
    runsGet: (runId) => storage.invoke('runs.get', { runId }),
    logsList: (flowId) => storage.invoke('logs.list', { flowId }),
    flowsList: async () => (await storage.invoke('flows.list', undefined)).items,
    flowsGet: (flowId) => storage.invoke('flows.get', { id: flowId }),
    settingsGetAll: () => storage.invoke('settings.getAll', undefined) as Promise<Record<string, unknown>>,
  };
}

/** runStore 镜像重建注入位（真身=useRunStore.getState().restoreRun——C-03 §4 委托承接） */
export type MirrorRestorer = (flowId: string, runId: string, statuses: Readonly<Record<string, NodeStatus>>) => void;

export interface LogReplayDeps {
  storage: ReplayStorage;
  restoreMirror: MirrorRestorer;
  /** 时钟（缺省 Date.now——cron missed 窗口右端） */
  now?(): number;
}

/** cron missed 提示行（A-6.6「上次计划触发 <时间> 未执行，可手动运行」数据面） */
export interface CronMissedNotice {
  flowId: string;
  flowName: string;
  /** 最后一个错过点（epoch ms，分钟对齐——文案 <时间>） */
  lastFireAt: number;
  /** 窗口内错过点数 */
  count: number;
  /** 超防呆上限截断标记 */
  truncated: boolean;
}

export interface RestoreRunStateResult {
  /** 装载的 run 记录（statuses=node_runs 终态投影附带——runs$ setRuns 消费） */
  records: TaskRunRecord[];
  /** cron missed 提示（§8②——任务中心提示行渲染面） */
  missedFires: CronMissedNotice[];
}

export interface LogReplayService {
  /** §1 契约面：重启还原重放（应用启动序调用——T6-17） */
  restoreRunState(): Promise<RestoreRunStateResult>;
  /** §3 face：flowId 全部历史行重放（FlowLogPanel 打开/切流程） */
  replayLogs(flowId: string): Promise<LogLine[]>;
  /** §3 face：节点实例名解析（flows.get 缓存——restoreRunState 预热后同步读） */
  nodeName(flowId: string, nodeId: string): string;
}

/** node_runs → statuses 终态投影（行序折叠，同节点多行〔重试〕取末行） */
export function projectNodeRunStatuses(nodeRuns: readonly NodeRunRecord[]): Record<string, NodeRunStatus> {
  const out: Record<string, NodeRunStatus> = {};
  for (const nr of nodeRuns) out[nr.nodeId] = nr.status;
  return out;
}

/** LogRecord → LogLine（去 id；null 列省缺——02 §7.1 logs 行形） */
function toLogLine(r: LogRecord): LogLine {
  const line: LogLine = { ts: r.ts, level: r.level, msg: r.msg };
  if (r.flowId !== null) line.flowId = r.flowId;
  if (r.runId !== null) line.runId = r.runId;
  if (r.laneLabel !== null) line.laneLabel = r.laneLabel;
  return line;
}

/** settings 键 `cron.lastAliveAt`（ISO 8601 字符串——C-M1 §4③；不入 SettingsSchema，KV 直读） */
export const CRON_LAST_ALIVE_AT_KEY = 'cron.lastAliveAt';

function readLastAliveAt(settings: Record<string, unknown>): number | null {
  const raw = settings[CRON_LAST_ALIVE_AT_KEY];
  if (typeof raw !== 'string' || raw === '') return null; // 缺键=首启（空窗口不误报）
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms; // 损坏值按首启处理（main readLastAliveAt 同口径）
}

/** FlowDoc → 首个 trigger.cron 参数非空串（flowId 级单注册——main extractCronTriggers 同口径） */
function firstCronTrigger(doc: FlowDoc): string | null {
  for (const node of doc.nodes) {
    if (node.type !== 'trigger.cron') continue;
    const cron = node.params.cron;
    if (typeof cron === 'string' && cron !== '') return cron;
  }
  return null;
}

export function createLogReplayService(deps: LogReplayDeps): LogReplayService {
  const now = deps.now ?? (() => Date.now());
  /** flowId → {名称表, trigger.cron}（flows.get 只读快照缓存——nodeName/cron 提取同源，每 flow 恰一取） */
  const flowCache = new Map<string, { names: Readonly<Record<string, string>>; cronTrigger: string | null }>();

  /** 预热一个 flow 快照（缓存命中 no-op；取失败缓存空表——缺名回退「…」，不拦启动） */
  async function warmFlow(flowId: string): Promise<void> {
    if (flowCache.has(flowId)) return;
    try {
      const doc = await deps.storage.flowsGet(flowId);
      const names: Record<string, string> = {};
      for (const n of doc.nodes) names[n.id] = n.name;
      flowCache.set(flowId, { names, cronTrigger: firstCronTrigger(doc) });
    } catch {
      flowCache.set(flowId, { names: {}, cronTrigger: null });
    }
  }

  return {
    async restoreRunState() {
      // 1) runs.list＋逐 run runs.get → 记录装载（statuses=node_runs 终态投影附带）
      const summaries = await deps.storage.runsList();
      const records: TaskRunRecord[] = [];
      const lastPerFlow = new Map<string, { runId: string; statuses: Record<string, NodeRunStatus>; createdAt: number }>();
      for (const s of summaries) {
        const detail = await deps.storage.runsGet(s.id);
        const statuses = projectNodeRunStatuses(detail.nodeRuns);
        records.push({ ...runRecordFromSummary(s), statuses });
        const prev = lastPerFlow.get(s.flowId);
        if (prev === undefined || s.createdAt >= prev.createdAt) {
          lastPerFlow.set(s.flowId, { runId: s.id, statuses, createdAt: s.createdAt });
        }
      }
      // 2) 每 flow 最近 run → runStore 镜像重建（A-6.5 还原数据源——C-03 §4 委托承接）
      for (const [flowId, last] of lastPerFlow) {
        deps.restoreMirror(flowId, last.runId, last.statuses);
      }
      // 3) flows 快照预热（run 涉及 flow——nodeName 缓存；无 run 侧数据仍可经 cron 遍历预热）
      for (const flowId of lastPerFlow.keys()) await warmFlow(flowId);
      // 4) cron missed 自算（§8②）
      const missedFires = await computeMissedFromFlows();
      return { records, missedFires };
    },

    async replayLogs(flowId) {
      const rows = await deps.storage.logsList(flowId);
      return rows.map(toLogLine);
    },

    nodeName(flowId, nodeId) {
      return flowCache.get(flowId)?.names[nodeId] ?? ''; // 未预热/缺名 → 空串（投影兜底「…」）
    },
  };

  /** flows.list＋flows.get 预热 → trigger.cron 提取 → (lastAliveAt, now] 自算 → 按 flow 聚合 */
  async function computeMissedFromFlows(): Promise<CronMissedNotice[]> {
    const settings = await deps.storage.settingsGetAll();
    const lastAliveAt = readLastAliveAt(settings);
    if (lastAliveAt === null) return [];
    const items = await deps.storage.flowsList();
    const schedules: MissedFireSchedule[] = [];
    for (const it of items) {
      await warmFlow(it.id);
      const cron = flowCache.get(it.id)?.cronTrigger ?? null;
      if (cron !== null) schedules.push({ flowId: it.id, cron });
    }
    const fires = computeMissedFires(lastAliveAt, schedules, now);
    const byFlow = new Map<string, { count: number; lastFireAt: number; truncated: boolean }>();
    for (const f of fires) {
      const agg = byFlow.get(f.flowId);
      if (agg === undefined) byFlow.set(f.flowId, { count: 1, lastFireAt: f.fireAt, truncated: f.truncated });
      else {
        agg.count += 1;
        agg.lastFireAt = f.fireAt;
        agg.truncated = agg.truncated || f.truncated;
      }
    }
    return [...byFlow].map(([flowId, a]) => ({
      flowId,
      flowName: items.find((it) => it.id === flowId)?.name ?? flowId,
      lastFireAt: a.lastFireAt,
      count: a.count,
      truncated: a.truncated,
    }));
  }
}
