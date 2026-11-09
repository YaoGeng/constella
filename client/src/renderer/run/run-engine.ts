// createRunEngine —— 运行调度装配面（TDD-C-03 §1 接口契约；T4-01 骨架）。
// 本卡落：startRun（RunGate 三查＋附加拦截前置 → runs.create → TopoPlanner 规划 →
// 不可达预标 ⊘ → 启动日志）/ abortRun（骨架收尾：台账停跳＋runs.finish(aborted)＋warn 日志）
// / onNodeStatus·onRunLog 事件面 / RunLedger 台账心跳 / cron:fired 复查三闸后 startRun。
// 执行循环体（lane/扇出/汇合/级联/收敛/终止扩散原语）归 T4-02/T4-03，断点协调归 T4-04——
// 骨架期 run 保持 running 直至 abortRun（§6.1c 并行心跳验收形态）。
// IPC 零 Electron 依赖：storage=C-06 renderer 半段注入、cron=注入 Transport（§8 替换点①）。
import type { FlowDoc, LogLevel } from '@constella/shared/ipc';
import type { StorageClient } from '../storage';
import { RunGate } from './run-gate';
import { RunLedger } from './run-ledger';
import { TopoPlanner, type TopoPlan } from './topo-planner';
import type { LogLine, NodeStatusEvent, NotifyFn, RunHandle, RunRegistryLike, RunTransport } from './types';

export interface RunEngineDeps {
  /** C-06 renderer 半段（flows.get＋runs/logs op 双写——§2 imports ↓） */
  storage: StorageClient;
  /** C-05 注册表最小面（broken 拦截/触发判定） */
  registry: RunRegistryLike;
  /** 脏闸注入位（true=该流程有未保存改动）；应用壳接 flowStore dirty 投影 */
  guardDirty: (flowId: string) => boolean;
  /** 执行面传输（cron:fired 订阅；缺省=无 cron 源） */
  transport?: RunTransport;
  /** toast 注入位（违例 toast；缺省仅日志） */
  notify?: NotifyFn;
  /** 台账注入位（缺省内部构造 heartbeatMs 间隔） */
  ledger?: RunLedger;
  heartbeatMs?: number;
  /** 时钟注入（缺省 Date.now——t0/t1 与日志 ts） */
  now?: () => number;
}

export interface RunEngine {
  /** §1 契约签名；闸违例（三查＋附加拦截）→ null＋toast＋err 日志、不产生 run（demo L1792-1796 行为源） */
  startRun(flowId: string, opts?: { source?: 'manual' | 'cron' }): Promise<RunHandle | null>;
  /** §1 契约签名；骨架收尾（终止扩散原语随 T4-03） */
  abortRun(runId: string): void;
  /** §1 事件流（不可达预标 ⊘ 即刻派发；节点执行态随后续卡接入） */
  onNodeStatus(fn: (e: NodeStatusEvent) => void): () => void;
  /** §1 日志事件面（事件源=logs.append 双写管线同点派发） */
  onRunLog(fn: (line: LogLine) => void): () => void;
  /** 生命周期收口（契约外：停心跳/退订 cron/清监听——应用壳卸载与测试清理用） */
  dispose(): void;
}

interface RunState {
  flowId: string;
  name: string;
  /** 内存数据源（A-6.5）：RunHandle.statuses 只读视图与其同引用 */
  statuses: Record<string, string>;
  plan: TopoPlan;
  finished: boolean;
}

/** 用时 mm:ss（demo L1753 fmt 同形） */
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function createRunEngine(deps: RunEngineDeps): RunEngine {
  const { storage, registry, guardDirty, notify } = deps;
  const now = deps.now ?? (() => Date.now());
  const ledger = deps.ledger ?? new RunLedger(deps.heartbeatMs ?? 1000);
  const ownLedger = deps.ledger === undefined;
  const gate = new RunGate({
    registry,
    guardDirty,
    isActiveRun: (flowId) => ledger.activeOf(flowId) !== undefined,
  });
  const planner = new TopoPlanner(registry);
  const runs = new Map<string, RunState>();
  const statusSubs = new Set<(e: NodeStatusEvent) => void>();
  const logSubs = new Set<(line: LogLine) => void>();

  /** 日志双写管线：storage logs.append 落库 → 同点派发 onRunLog（§3 StatusBus 管线骨架段） */
  async function appendLog(
    level: LogLevel,
    msg: string,
    ctx: { flowId?: string; runId?: string; laneLabel?: string } = {},
  ): Promise<void> {
    const line: LogLine = { ts: new Date(now()).toISOString(), level, msg, ...ctx };
    await storage.invoke('logs.append', { level, msg, ...ctx });
    for (const fn of logSubs) fn(line);
  }

  function emitStatus(e: NodeStatusEvent): void {
    for (const fn of statusSubs) fn(e);
  }

  async function startRun(flowId: string, opts: { source?: 'manual' | 'cron' } = {}): Promise<RunHandle | null> {
    void opts.source; // 手动/cron 共用闸（01 A-6.6）；来源分域日志随后续卡消费
    const doc: FlowDoc = await storage.invoke('flows.get', { id: flowId });
    const gateResult = gate.check(flowId, doc);
    if (!gateResult.ok) {
      notify?.('err', gateResult.message);
      await appendLog('err', `运行失败：${gateResult.message}`, { flowId });
      return null;
    }
    const plan = planner.plan(doc);
    const { id: runId } = await storage.invoke('runs.create', { flowId, name: doc.name });
    ledger.open({ runId, flowId, name: doc.name, t0: now() });
    const statuses: Record<string, string> = {};
    runs.set(runId, { flowId, name: doc.name, statuses, plan, finished: false });
    // 不可达节点预标 ⊘（启动即 skipped——事件＋statuses；demo L1936 静态 ⊘ 同语义）
    for (const nodeId of plan.skips) {
      statuses[nodeId] = 'skipped';
      emitStatus({ runId, nodeId, status: 'skipped' });
    }
    const skipNote = plan.skips.length > 0 ? `，${plan.skips.length} 个未连接节点跳过` : '';
    await appendLog('info', `▶ 任务「${doc.name}」启动 — ${plan.order.length} 个节点入队${skipNote}`, { flowId, runId });
    return { runId, statuses };
  }

  function abortRun(runId: string): void {
    const run = runs.get(runId);
    if (run === undefined || run.finished) return;
    const entry = ledger.activeOf(run.flowId);
    if (entry === undefined || entry.runId !== runId) return; // 已收尾 → no-op（幂等）
    run.finished = true;
    const t1 = now();
    ledger.close(runId, 'aborted');
    // 落库 fire-and-forget（契约 void）；终止扩散原语（killScript/会话销毁/断点放行）随 T4-03 接入
    void storage
      .invoke('runs.finish', {
        runId,
        status: 'aborted',
        t1,
        aborted: 0,
        failed: 0,
        total: run.plan.total,
        skips: run.plan.skips,
      })
      .then(() => appendLog('warn', `任务已终止 · 用时 ${fmtDur(t1 - entry.t0)}`, { flowId: run.flowId, runId }))
      .catch(() => undefined); // IPC 断连等环境级故障不阻塞本地收尾（X-3 语义方向）
  }

  // cron:fired → 复查三闸后 startRun（01 A-6.6；闸拒绝=cron 触发静默不产生 run＋日志）
  let cronUnsub: (() => void) | null = null;
  if (deps.transport !== undefined) {
    cronUnsub = deps.transport.onCronFired((e) => {
      void startRun(e.flowId, { source: 'cron' }).catch(() => undefined);
    });
  }

  return {
    startRun,
    abortRun,
    onNodeStatus(fn) {
      statusSubs.add(fn);
      return () => statusSubs.delete(fn);
    },
    onRunLog(fn) {
      logSubs.add(fn);
      return () => logSubs.delete(fn);
    },
    dispose() {
      cronUnsub?.();
      cronUnsub = null;
      if (ownLedger) ledger.dispose();
      statusSubs.clear();
      logSubs.clear();
    },
  };
}
