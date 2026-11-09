// createRunEngine —— 运行调度装配面（TDD-C-03 §1 接口契约；T4-01 骨架＋T4-02 执行循环
// ＋T4-03 级联/收敛/终止接线＋T4-04 N6 策略/断点协调/事件总线收口）。
// 本卡落：startRun（RunGate 三查＋附加拦截前置 → runs.create → TopoPlanner 规划 →
// 不可达预标 ⊘＋出边级联 → 启动日志 → RunLoop 启动＋AbortCoordinator 注册）/ abortRun
// （AbortCoordinator 瞬时扩散：置位＋killScript×活跃＋断点放行＋destroyRun 恰一次——
// 收口移交 drain 收尾序：converge 兜底〔M-1〕＋drain 后终态判定 failed 优先〔P-1，
// demo L1946〕）/ drain 收尾序（ConvergenceSweeper 收敛→终态 runs.finish→会话销毁→
// 台账/注册清理）/ resumeHit（§1 断点恢复通道）/ onNodeStatus·onRunLog 事件面（StatusBus
// 收口）＋runStore 镜像同点写入（02 §3.3）/ RunLedger 台账心跳 / cron:fired 复查三闸后 startRun。
// IPC 零 Electron 依赖：storage=C-06 renderer 半段注入、cron/脚本/会话通道=注入 Transport（§8 替换点①）。
import type { FlowDoc, LogLevel } from '@constella/shared/ipc';
import type { StorageClient } from '../storage';
import { AbortCoordinator } from './abort-coordinator';
import { createRunLoop, type RunFlags, type RunLoop } from './run-loop';
import { RunGate } from './run-gate';
import { RunLedger } from './run-ledger';
import { useRunStore } from './run-store';
import { StatusBus } from './status-bus';
import { TopoPlanner, type TopoPlan } from './topo-planner';
import type { CommandTransport, LogLine, NodeStatusEvent, NotifyFn, ResumeDecision, RunHandle, RunRegistryLike, RunTransport } from './types';

export interface RunEngineDeps {
  /** C-06 renderer 半段（flows.get＋runs/logs op 双写——§2 imports ↓） */
  storage: StorageClient;
  /** C-05 注册表最小面（broken 拦截/触发判定/执行体分派） */
  registry: RunRegistryLike;
  /** 脏闸注入位（true=该流程有未保存改动）；应用壳接 flowStore dirty 投影 */
  guardDirty: (flowId: string) => boolean;
  /** 执行面传输（cron:fired 订阅＋spawnScript/scriptEvent＋cdp 会话通道＋killScript/destroyRun/cdpProbe；缺省=无 cron 源、脚本/cdp 分派抛错） */
  transport?: RunTransport;
  /** 命令传输注入位（cdp.* 内置命令帧——T0-07 冻结帧形；实装=ws client 随 T4-05） */
  commandTransport?: CommandTransport;
  /** toast 注入位（违例/节点失败 toast；缺省仅日志） */
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
  /** §1 契约签名；终止瞬时扩散（置位＋强杀＋断点放行＋会话销毁）＋drain 后统一收口 runs.finish */
  abortRun(runId: string): void;
  /** §1 契约签名（01 A-7.1）：confirm=merged 交付下游（合并由调用方完成）/skip=原始 input 直发；
   *  校验 hitId 存在后交付，未知 hitId no-op */
  resumeHit(hitId: string, d: ResumeDecision): void;
  /** §1 事件流（不可达预标 ⊘ 与节点执行态同管线派发，laneLabel 随 lane 语义填入） */
  onNodeStatus(fn: (e: NodeStatusEvent) => void): () => void;
  /** §1 日志事件面（事件源=logs.append 双写管线同点派发） */
  onRunLog(fn: (line: LogLine) => void): () => void;
  /** 契约外：执行循环 drain promise（收敛收尾已接线——drain 后 run 落终态并清理注册） */
  whenSettled(runId: string): Promise<void> | undefined;
  /** 生命周期收口（契约外：停心跳/退订 cron/终止扩散/清监听——应用壳卸载与测试清理用） */
  dispose(): void;
}

interface RunState {
  flowId: string;
  name: string;
  /** 内存数据源（A-6.5）：RunHandle.statuses 只读视图与其同引用 */
  statuses: Record<string, string>;
  plan: TopoPlan;
  finished: boolean;
  /** abort 请求已受理（drain 后统一收口——M-1/P-1：converge 兜底＋终态判定移 drain 后） */
  aborting: boolean;
  flags: RunFlags;
  loop?: RunLoop;
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
  const abortor = new AbortCoordinator({ ...(deps.transport !== undefined ? { transport: deps.transport } : {}) });
  const runs = new Map<string, RunState>();
  const mirror = useRunStore;
  /** 事件总线＋双写管线（§3 StatusBus 收口——T4-02/03 内联双写移入；onNodeStatus/onRunLog 导出面） */
  const bus = new StatusBus({ storage, now });

  /** 日志双写管线（StatusBus.appendLog） */
  const appendLog = (level: LogLevel, msg: string, ctx: { flowId?: string; runId?: string; laneLabel?: string } = {}): Promise<void> =>
    bus.appendLog(level, msg, ctx);

  /** 节点态事件派发＋runStore 镜像同点写入（A-6.5：statuses=数据源 → 事件 → 镜像） */
  function emitStatus(e: NodeStatusEvent): void {
    const flowId = runs.get(e.runId)?.flowId;
    if (flowId !== undefined) mirror.getState().nodeStatus(e, flowId);
    bus.emit(e);
  }

  /** runs.finish 落库＋终态日志（fire-and-forget；IPC 故障不阻塞本地收尾，X-3 方向） */
  function finishRun(runId: string, state: RunState, t0: number, t1: number, status: 'done' | 'error' | 'aborted', aborted: number, failed: number): void {
    void storage
      .invoke('runs.finish', {
        runId,
        status,
        t1,
        aborted,
        failed,
        total: state.plan.total,
        skips: state.plan.skips,
      })
      .then(() => {
        const dur = fmtDur(t1 - t0);
        if (status === 'error') return appendLog('err', `任务失败 · 用时 ${dur}`, { flowId: state.flowId, runId });
        if (status === 'aborted') return appendLog('warn', `任务已终止 · 用时 ${dur}`, { flowId: state.flowId, runId });
        return appendLog('ok', `任务完成 · 用时 ${dur}`, { flowId: state.flowId, runId });
      })
      .catch(() => undefined);
  }

  /** 收尾清理（移交项 #7＋P-2）：drain 后解除 runs/AbortCoordinator/ledger 注册与销毁去重台账（历史走 DB 重放） */
  function cleanupRun(runId: string): void {
    runs.delete(runId);
    abortor.unregister(runId);
    abortor.forgetRun(runId);
    ledger.forget(runId);
  }

  /**
   * drain 收尾序（§3 AbortCoordinator 复用处「收尾序」；abort 路径同样经此收口——M-1/P-1）：
   * 收敛（converge 兜底——终止波及的未派生节点统一 ⊘）→ 终态判定（failed 优先，demo L1946）
   * → runs.finish → 会话销毁（幂等）→ 镜像解除活跃 → 清理。
   */
  function wireSettleSequence(runId: string, state: RunState): void {
    const loop = state.loop;
    if (loop === undefined) return;
    void loop.done.then(() => {
      if (!state.finished) {
        state.finished = true;
        const outcome = loop.converge();
        const t1 = now();
        const t0 = ledger.get(runId)?.t0 ?? t1;
        ledger.close(runId, outcome.status);
        void abortor.destroySessions(runId);
        mirror.getState().runClosed(state.flowId, runId);
        finishRun(runId, state, t0, t1, outcome.status, outcome.abortedCount, outcome.failedCount);
      }
      cleanupRun(runId);
    });
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
    const t0 = now();
    ledger.open({ runId, flowId, name: doc.name, t0 });
    const statuses: Record<string, string> = {};
    const flags: RunFlags = { aborted: false, failed: false };
    const state: RunState = { flowId, name: doc.name, statuses, plan, finished: false, aborting: false, flags };
    runs.set(runId, state);
    mirror.getState().runOpened(flowId, runId); // runStore 镜像（02 §3.3：statuses 数据源登记）
    // 不可达节点预标 ⊘（启动即 skipped——事件＋statuses；demo L1936 静态 ⊘ 同语义）
    for (const nodeId of plan.skips) {
      statuses[nodeId] = 'skipped';
      emitStatus({ runId, nodeId, status: 'skipped' });
    }
    const skipNote = plan.skips.length > 0 ? `，${plan.skips.length} 个未连接节点跳过` : '';
    await appendLog('info', `▶ 任务「${doc.name}」启动 — ${plan.order.length} 个节点入队${skipNote}`, { flowId, runId });
    // 执行循环（T4-02：lane/扇出/汇合/交付路由/ExecDispatcher——启动于启动日志之后，demo L1808-1809 序）
    const loop = createRunLoop({
      runId,
      flowId,
      flowName: doc.name,
      doc,
      plan,
      statuses,
      registry,
      storage,
      statusBus: bus,
      ...(notify !== undefined ? { notify } : {}),
      ...(deps.transport !== undefined ? { transport: deps.transport } : {}),
      ...(deps.commandTransport !== undefined ? { commandTransport: deps.commandTransport } : {}),
      flags,
      now,
      appendLog: (level, msg, laneCtx = {}) => appendLog(level, msg, { flowId, runId, ...laneCtx }),
      emitStatus,
    });
    state.loop = loop;
    abortor.register(runId, loop.abort);
    wireSettleSequence(runId, state);
    loop.start();
    return { runId, statuses };
  }

  function abortRun(runId: string): void {
    const run = runs.get(runId);
    if (run === undefined || run.finished || run.aborting) return; // 已收尾/已受理 → no-op（幂等）
    const entry = ledger.activeOf(run.flowId);
    if (entry === undefined || entry.runId !== runId) return;
    run.aborting = true; // 收口移交 drain 收尾序（M-1：converge 兜底＋P-1：drain 后终态判定 failed 优先）
    // 终止瞬时扩散（02 §10 #8）：置位（停派生＋50ms 步进自觉退出）＋killScript×活跃＋
    // waiting 断点自动放行＋CDP 会话销毁（destroySessions 幂等——drain 收尾再调 no-op）
    if (!abortor.abort(runId)) run.flags.aborted = true; // 未注册（loop 未建）回退直接置位
    void abortor.destroySessions(runId);
  }

  function resumeHit(hitId: string, d: ResumeDecision): void {
    for (const state of runs.values()) {
      if (state.loop?.resumeHit(hitId, d) === true) return; // 未知 hitId 遍历后自然 no-op
    }
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
    resumeHit,
    onNodeStatus(fn) {
      return bus.subscribe(fn);
    },
    onRunLog(fn) {
      return bus.onLog(fn);
    },
    whenSettled(runId: string): Promise<void> | undefined {
      return runs.get(runId)?.loop?.done;
    },
    dispose() {
      cronUnsub?.();
      cronUnsub = null;
      if (ownLedger) ledger.dispose();
      // 残留活动 run 终止扩散（强杀＋放行）＋镜像解除；不销毁会话（P-2：dispose 不调
      // destroySessions——应用壳卸载不波及 lane 窗，收尾序归各 run drain）
      for (const [runId, run] of runs) {
        const entry = ledger.get(runId);
        if (entry !== undefined && entry.status === 'running') mirror.getState().runClosed(run.flowId, runId);
        if (!run.finished && !run.aborting && !abortor.abort(runId)) run.flags.aborted = true;
      }
      runs.clear();
    },
  };
}
