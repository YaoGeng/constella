// RunLoop —— 执行循环体（TDD-C-03 §3 各组件的复用处「RunLoop」；demo L1818-1955 行为源；
// T4-02 执行链＋T4-03 级联/收敛/终止接线＋T4-04 N6 策略/断点协调）。
// 编排：触发器派生（lane=main/t:<id>）→ ExecDispatcher 执行（N6 编排=PolicyRunner：退避
// 重跑＋onFailure abort/failBranch 路由〔02 §8.6〕；断点=HitCoordinator 门闩）→
// DeliveryRouter 交付（{data} 全存活出边/{branch} 命中边——未命中边经 DeadEdgeCascader
// 向下级联 ⊘）→ 汇合就绪再派生；inflight 归零 drain → ConvergenceSweeper 收敛
// （环/依赖缺失/终止波及统一 ⊘＋终态）。
// 双写：statuses=数据源 → onNodeStatus 事件 → runs.nodeRunStart/nodeRunFinish/logs.append
// 经 StatusBus 落库（A-6.5 双写管线——T4-04 收口至 StatusBus）。
// 终止扩散原语（AbortCoordinator 挂钩）：置 aborted 标志（停派生＋delay/退避 50ms 步进
// 自觉退出）＋活跃脚本快照（killScript 数据源）＋waiting 断点自动放行（HitCoordinator
// releaseAll→⊘ 收敛）。
// 环境级失败（cdpProbe 断连等 X-3）经 ctx.failRun 置 failed 停派生——不重试不走
// failBranch（豁免执行点=runWithPolicy 首查）；节点脚本自身失败由 PolicyRunner 决策。
import type { FlowDoc, FlowEdge, LogLevel, FlowNode } from '@constella/shared/ipc';
import type { NodeOut } from '@constella/shared/dsl';
import type { StorageClient } from '../storage';
import { DeadEdgeCascader } from './branch-filter';
import { ConvergenceSweeper, type ConvergeOutcome } from './convergence-sweeper';
import { DeliveryRouter } from './delivery-router';
import { ExecAbortedError, ExecDispatcher, type ExecContext } from './exec-dispatcher';
import { HitCoordinator } from './hit-coordinator';
import { LaneManager } from './lane-manager';
import { PolicyRunner } from './policy-runner';
import { StatusBus } from './status-bus';
import { findTriggers, type TopoPlan } from './topo-planner';
import type { AbortHooks } from './abort-coordinator';
import type { CommandTransport, Lane, NodeStatus, NodeStatusEvent, NotifyFn, ResumeDecision, RunRegistryLike, RunTransport } from './types';

/** run 级标志（engine 与 loop 共享引用：abortRun 置 aborted；节点失败置 failed 停派生） */
export interface RunFlags {
  aborted: boolean;
  failed: boolean;
}

export interface RunLoopDeps {
  runId: string;
  flowId: string;
  /** 流程名（单触发 lane 标签=流程名，demo L1940） */
  flowName: string;
  doc: FlowDoc;
  plan: TopoPlan;
  /** statuses=内存数据源（与 RunHandle.statuses 同引用，A-6.5） */
  statuses: Record<string, string>;
  registry: RunRegistryLike;
  storage: StorageClient;
  /** statuses 双写管线（nodeRunStart/Finish 经 StatusBus 落库——§3 收口，T4-04） */
  statusBus: StatusBus;
  notify?: NotifyFn;
  transport?: RunTransport;
  commandTransport?: CommandTransport;
  flags: RunFlags;
  now(): number;
  appendLog(level: LogLevel, msg: string, ctx?: { laneLabel?: string }): Promise<void>;
  emitStatus(e: NodeStatusEvent): void;
}

/** drain 后收敛结果（engine 收尾序消费：runs.finish 计数与终态） */
export type RunConvergeOutcome = ConvergeOutcome & { abortedCount: number; failedCount: number };

export interface RunLoop {
  /** lane 台账（会话投影/laneLabel 事件源） */
  lanes: LaneManager;
  /** inflight 归零 drain promise（engine 收尾序接线） */
  done: Promise<void>;
  /** 启动：静态不可达出边预杀（级联）＋触发器派生 */
  start(): void;
  /** AbortCoordinator 挂钩（终止瞬时扩散三原语的数据源） */
  abort: AbortHooks;
  /** 收敛（drain 后调用一次）：剩余节点统一 ⊘＋终态与计数（02 §10 #7） */
  converge(): RunConvergeOutcome;
  /** 断点恢复（§1 resumeHit 通道；hitId 未知 → false no-op） */
  resumeHit(hitId: string, d: ResumeDecision): boolean;
}

export function createRunLoop(deps: RunLoopDeps): RunLoop {
  const { runId, doc, plan, statuses, registry, now, flags } = deps;
  const lanes = new LaneManager({ runId, ...(deps.transport ? { transport: deps.transport } : {}) });
  const router = new DeliveryRouter({ doc, registry, lanes });
  const activeScripts = new Set<string>();
  const dispatcher = new ExecDispatcher({
    registry,
    lanes,
    runId,
    ...(deps.transport ? { transport: deps.transport } : {}),
    ...(deps.commandTransport ? { commandTransport: deps.commandTransport } : {}),
    onScriptActive: (nodeRunId, active) => {
      if (active) activeScripts.add(nodeRunId);
      else activeScripts.delete(nodeRunId);
    },
  });

  const nodeOf = (id: string) => doc.nodes.find((n) => n.id === id);
  const nodeName = (id: string): string => nodeOf(id)?.name ?? id;
  const defOf = (id: string) => {
    const n = nodeOf(id);
    return n === undefined ? undefined : registry.get(n.type);
  };
  const defName = (id: string): string => defOf(id)?.meta.name ?? nodeName(id);
  const statusOf = (id: string): NodeStatus | undefined => statuses[id] as NodeStatus | undefined;

  /** N6 决策（T4-04，02 §8.6）：retries/backoff 退避编排＋onFailure abort/failBranch 路由 */
  const policy = new PolicyRunner({ policyOf: (nodeId) => defOf(nodeId)?.policy ?? null });

  /** 重试退避可中断计时（50ms 步进对齐终止自觉退出；终止/失败停派生即时中断） */
  function abortableSleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      const timer = setInterval(() => {
        if (flags.aborted || flags.failed) {
          clearInterval(timer);
          reject(new ExecAbortedError());
          return;
        }
        elapsed += 50;
        if (elapsed >= ms) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  /**
   * N6 执行编排（PolicyRunner，02 §8.6）：节点自身失败 → 有余额则退避重跑（重跑不计 done
   * 重复交付、lane 不变——失败不交付，仅在最终成功/failBranch 时交付恰一次）；耗尽 →
   * onFailure 路由：abort（缺省）=原样上抛走 failNode；failBranch=返回 {branch:exit} 走统一
   * NodeOut 路由（出口未命中由 deliver 判 branch-miss → 节点 error，02 §14 同口径）。
   * 环境级豁免（X-3）：flags.failed 已置（cdpProbe 断连等 ctx.failRun 置位）→ 不重试不走
   * failBranch，原样上抛（外层 failNode 失败终止）——终止/失败停派生路径同样直通。
   */
  async function runWithPolicy(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    for (;;) {
      try {
        return await dispatcher.dispatch(node, input, ctx);
      } catch (e) {
        if (e instanceof ExecAbortedError || flags.aborted || flags.failed) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        const action = policy.onExit(node.id, msg);
        if (action.kind === 'retry') {
          await log('warn', `[${ctx.lane.label}] ${nodeName(node.id)} 失败：${msg} — 第 ${action.attempt} 次重试（退避 ${action.waitMs}ms）`, ctx.lane.label).catch(() => undefined);
          await abortableSleep(action.waitMs);
          continue;
        }
        if (action.kind === 'failBranch') {
          await log('warn', `[${ctx.lane.label}] ${nodeName(node.id)} 失败：${msg} — 走失败出口「${action.exit}」`, ctx.lane.label).catch(() => undefined);
          return { branch: action.exit }; // 具名失败出口（02 §8.6）——统一 NodeOut 路由交付
        }
        throw e; // onFailure=abort（缺省）：原样上抛 → failNode（error＋run.failed 终止）
      }
    }
  }

  let inflight = 0;
  let abortSkips = 0; // 终止波及计数（在途节点被终止 → ⊘；runs.finish aborted 计数源之一）
  let settle!: () => void;
  const done = new Promise<void>((r) => {
    settle = r;
  });

  function pump(): void {
    if (inflight === 0) settle();
  }

  /** statuses 写入＋事件派发（A-6.5：statuses=数据源 → 事件） */
  function setStatus(nodeId: string, status: NodeStatus, lane?: Lane, error?: string): void {
    statuses[nodeId] = status;
    deps.emitStatus({ runId, nodeId, status, ...(lane !== undefined ? { laneLabel: lane.label } : {}), ...(error !== undefined ? { error } : {}) });
  }

  async function log(level: LogLevel, msg: string, laneLabel?: string): Promise<void> {
    await deps.appendLog(level, msg, laneLabel === undefined ? {} : { laneLabel });
  }

  /** 级联 ⊘ 落地（DeadEdgeCascader/ConvergenceSweeper 回调）：statuses＋事件＋warn 日志 */
  function cascadeSkip(nodeId: string): void {
    setStatus(nodeId, 'skipped');
    void log('warn', `分支不可达 — 跳过：${nodeName(nodeId)}`).catch(() => undefined);
  }

  const cascader = new DeadEdgeCascader({ doc, router, statusOf, skipNode: cascadeSkip });

  /** 死边批量级联（交付路由 dead 边与静态预杀共用入口）＋即时死边 info 日志 */
  function killDeadEdges(dead: readonly FlowEdge[], lane: Lane): void {
    for (const e of dead) {
      void log('info', `[${lane.label}] 分支跳过：${nodeName(e.to[0])}`, lane.label).catch(() => undefined);
      cascader.killEdge(e);
    }
  }

  /** 节点失败：error 态＋失败停派生（demo L1898-1901 强节点失败即终止语义；N6 策略接管随 T4-04） */
  async function failNode(nodeId: string, lane: Lane, nodeRunId: string, msg: string): Promise<void> {
    setStatus(nodeId, 'error', lane, msg);
    flags.failed = true;
    deps.notify?.('err', `任务失败：${nodeName(nodeId)} — ${msg}`);
    await deps.statusBus.nodeRunFinish({ nodeRunId, status: 'error', endedAt: now(), output: null, error: msg }).catch(() => undefined);
    await deps.appendLog('err', `[${lane.label}] ${nodeName(nodeId)} 失败：${msg}`, { laneLabel: lane.label }).catch(() => undefined);
  }

  async function spawnNode(nodeId: string, lane: Lane, input: unknown): Promise<void> {
    if (flags.aborted || flags.failed) return; // 终止/失败后不再派生（demo L1854）
    lanes.assign(nodeId, lane);
    inflight++;
    const nodeRunId = `${runId}:${nodeId}`;
    try {
      const node = nodeOf(nodeId);
      if (node === undefined) throw new Error(`节点不存在：${nodeId}`);
      setStatus(nodeId, 'running', lane);
      await deps.statusBus.nodeRunStart({ nodeRunId, runId, laneId: lane.key, nodeId });
      await log('info', `[${lane.label}] 执行 ${defName(nodeId)}（${nodeName(nodeId)}）…`, lane.label);
      const t0 = now();
      let emitCount = 0;
      let earlyError: string | null = null;
      const ctx: ExecContext = {
        lane,
        nodeRunId,
        log: (level, msg) => {
          void log(level, msg, lane.label).catch(() => undefined);
        },
        emit: (branch, payload) => {
          emitCount++;
          const p = router.deliverBranch(nodeId, branch, payload ?? null, lane);
          if (!p.ok) {
            if (earlyError === null) earlyError = `出口未命中：${p.branch} ∉ [${p.outs.join(', ')}]`;
            return;
          }
          for (const t of p.targets) void spawnNode(t.nodeId, t.lane, t.input);
          killDeadEdges(p.dead, lane);
        },
        setStatus: (st, error) => setStatus(nodeId, st, lane, error),
        isAborted: () => flags.aborted,
        holdAtBreakpoint: () =>
          hitCoord.hit(
            nodeId,
            input,
            typeof node.params.question === 'string' && node.params.question !== '' ? node.params.question : '请确认以下信息',
            Array.isArray(node.params.options) ? node.params.options : [],
          ),
        failRun: (reason) => {
          flags.failed = true; // 环境级失败终止（X-3：不走 failBranch——路由豁免归 T4-04 PolicyRunner）
          void log('err', `[${lane.label}] ${reason}`, lane.label).catch(() => undefined);
        },
      };
      try {
        const out = await runWithPolicy(node, input, ctx);
        if (earlyError !== null) throw new Error(earlyError);
        /** 终态 done＋output 落库＋完成日志 */
        const writeDone = async (): Promise<void> => {
          setStatus(nodeId, 'done', lane);
          await deps.statusBus.nodeRunFinish({ nodeRunId, status: 'done', endedAt: now(), output: out });
          // 已落 done 后完成日志失败不翻终态（移交项 #4：不再二次 nodeRunFinish(error)）
          await log('ok', `[${lane.label}] ${defName(nodeId)} 完成 · ${((now() - t0) / 1000).toFixed(1)}s`, lane.label).catch(() => undefined);
        };
        // NodeOut 路由（02 §14）——branch 未命中 N2 outs=节点 error（先校验再落终态，防拼写错路由）
        if ('data' in out && emitCount > 0) {
          // N5 汇总帧：分支已按 emit 提前交付——{data} 仅入 node_runs.output、不再发边（02 §8.5）
          await writeDone();
        } else {
          const r = router.deliver(nodeId, out, lane);
          if (!r.ok) {
            await failNode(nodeId, lane, nodeRunId, `出口未命中：${r.branch} ∉ [${r.outs.join(', ')}]`);
          } else {
            await writeDone();
            for (const t of r.targets) void spawnNode(t.nodeId, t.lane, t.input);
            killDeadEdges(r.dead, lane);
          }
        }
      } catch (e) {
        if (e instanceof ExecAbortedError || flags.aborted) {
          // 被终止（killScript 强杀/delay 步进/断点放行）：⊘ 收敛、不交付下游（demo L1910）
          abortSkips++;
          setStatus(nodeId, 'skipped', lane);
          await deps.statusBus.nodeRunFinish({ nodeRunId, status: 'skipped', endedAt: now(), output: null }).catch(() => undefined);
          return;
        }
        await failNode(nodeId, lane, nodeRunId, e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      // 双写管线自身故障（IPC 断连等环境级）：不吞节点终态（X-3 方向）——置 error 并停派生
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(nodeId, 'error', lane, msg);
      flags.failed = true;
      void deps.appendLog('err', `[${lane.label}] ${nodeName(nodeId)} 失败：${msg}`, { laneLabel: lane.label }).catch(() => undefined);
    } finally {
      inflight--;
      pump();
    }
  }

  // ——— 断点协调（T4-04 HitCoordinator：waiting＋hits.create pending/确认/跳过/终止放行） ———
  const hitCoord = new HitCoordinator({
    runId,
    storage: deps.storage,
    now,
    isRunOver: () => flags.aborted || flags.failed, // 失败停派生下挂起断点同样放行收敛（demo failed+aborted 同置语义）
  });

  // ——— 收敛（drain 后一次；02 §10 #7） ———
  let convergeOutcome: RunConvergeOutcome | undefined;
  function converge(): RunConvergeOutcome {
    if (convergeOutcome !== undefined) return convergeOutcome;
    const sweeper = new ConvergenceSweeper({
      nodeIds: doc.nodes.map((n) => n.id),
      statusOf,
      skipNode: (id) => {
        const prev = statusOf(id);
        setStatus(id, 'skipped');
        if (flags.aborted && (prev === 'running' || prev === 'waiting')) abortSkips++; // 终止波及在途节点
      },
      isAborted: () => flags.aborted,
      isFailed: () => flags.failed,
    });
    const out = sweeper.sweep();
    convergeOutcome = {
      ...out,
      abortedCount: abortSkips,
      failedCount: Object.values(statuses).filter((s) => s === 'error').length,
    };
    return convergeOutcome;
  }

  function start(): void {
    // 静态不可达 ⊘ 的出边预杀＋归零级联（demo L1937；级联 ⊘ warn 日志经 cascader 回调）
    for (const id of plan.skips) cascader.killEdgesOf(id);
    // 触发支派生：单触发=main/流程名；多触发=t:<id>/节点名（demo L1940）
    const triggers = findTriggers(doc, registry);
    for (const t of triggers) {
      const lane: Lane = triggers.length > 1 ? { key: `t:${t.id}`, label: t.name } : { key: 'main', label: deps.flowName };
      void spawnNode(t.id, lane, undefined);
    }
  }

  return {
    lanes,
    done,
    start,
    abort: {
      markAborted: () => {
        flags.aborted = true;
      },
      activeScriptRuns: () => [...activeScripts],
      releaseWaitingHits: () => hitCoord.releaseAll(),
    },
    converge,
    /** §1 resumeHit 通道（HitCoordinator.resume 转发；未知 hitId → false） */
    resumeHit: (hitId, d) => hitCoord.resume(hitId, d),
  };
}
