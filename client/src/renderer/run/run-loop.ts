// RunLoop —— 执行循环体（TDD-C-03 §3 各组件的复用处「RunLoop」；demo L1818-1955 行为源；T4-02）。
// 编排：触发器派生（lane=main/t:<id>）→ ExecDispatcher 执行 → DeliveryRouter 交付（{data}
// 全存活出边/{branch} 命中边）→ 汇合就绪再派生；inflight 归零即 drain（done promise）。
// 双写：statuses=数据源 → onNodeStatus 事件 → runs.nodeRunStart/nodeRunFinish/logs.append
// 经 storage 落库（A-6.5；管线集中化=StatusBus 随 T4-04 收口，本卡内联双写）。
// 边界（后续卡）：死边归零级联 ⊘/环收敛兜底/run 收尾状态映射＝T4-03（ConvergenceSweeper——
// 本卡 drain 后 run 保持 active，收敛组件接入 done 接线）；终止强杀/断连分支＝T4-03；
// N6 重试/onFailure 路由/断点协调＝T4-04（本卡节点 error=失败停派生，demo L1900 语义）。
import type { FlowDoc, FlowEdge, LogLevel } from '@constella/shared/ipc';
import type { StorageClient } from '../storage';
import { DeliveryRouter } from './delivery-router';
import { ExecAbortedError, ExecDispatcher, type ExecContext } from './exec-dispatcher';
import { LaneManager } from './lane-manager';
import { findTriggers, type TopoPlan } from './topo-planner';
import type { CommandTransport, Lane, NodeStatus, NodeStatusEvent, NotifyFn, RunRegistryLike, RunTransport } from './types';

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
  notify?: NotifyFn;
  transport?: RunTransport;
  commandTransport?: CommandTransport;
  flags: RunFlags;
  now(): number;
  appendLog(level: LogLevel, msg: string, ctx?: { laneLabel?: string }): Promise<void>;
  emitStatus(e: NodeStatusEvent): void;
}

export interface RunLoop {
  /** lane 台账（会话投影/laneLabel 事件源） */
  lanes: LaneManager;
  /** inflight 归零 drain promise（T4-03 收敛组件接线位） */
  done: Promise<void>;
  /** 启动：静态不可达出边预杀＋触发器派生 */
  start(): void;
}

export function createRunLoop(deps: RunLoopDeps): RunLoop {
  const { runId, doc, plan, statuses, registry, storage, now, flags } = deps;
  const lanes = new LaneManager({ runId, ...(deps.transport ? { transport: deps.transport } : {}) });
  const router = new DeliveryRouter({ doc, registry, lanes });
  const dispatcher = new ExecDispatcher({
    registry,
    lanes,
    runId,
    ...(deps.transport ? { transport: deps.transport } : {}),
    ...(deps.commandTransport ? { commandTransport: deps.commandTransport } : {}),
  });

  const nodeOf = (id: string) => doc.nodes.find((n) => n.id === id);
  const nodeName = (id: string): string => nodeOf(id)?.name ?? id;
  const defOf = (id: string) => {
    const n = nodeOf(id);
    return n === undefined ? undefined : registry.get(n.type);
  };
  const defName = (id: string): string => defOf(id)?.meta.name ?? nodeName(id);

  let inflight = 0;
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

  function logDeadEdges(dead: readonly FlowEdge[], lane: Lane): void {
    for (const e of dead) void log('info', `[${lane.label}] 分支跳过：${nodeName(e.to[0])}`, lane.label);
  }

  /** 节点失败：error 态＋失败停派生（demo L1898-1901 强节点失败即终止语义；N6 策略接管随 T4-04） */
  async function failNode(nodeId: string, lane: Lane, nodeRunId: string, msg: string): Promise<void> {
    setStatus(nodeId, 'error', lane, msg);
    flags.failed = true;
    deps.notify?.('err', `任务失败：${nodeName(nodeId)} — ${msg}`);
    await storage
      .invoke('runs.nodeRunFinish', { nodeRunId, status: 'error', endedAt: now(), output: null, error: msg })
      .catch(() => undefined);
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
      await storage.invoke('runs.nodeRunStart', { nodeRunId, runId, laneId: lane.key, nodeId });
      await log('info', `[${lane.label}] 执行 ${defName(nodeId)}（${nodeName(nodeId)}）…`, lane.label);
      const t0 = now();
      let emitCount = 0;
      let earlyError: string | null = null;
      const ctx: ExecContext = {
        lane,
        nodeRunId,
        log: (level, msg) => {
          void log(level, msg, lane.label);
        },
        emit: (branch, payload) => {
          emitCount++;
          const p = router.deliverBranch(nodeId, branch, payload ?? null, lane);
          if (!p.ok) {
            if (earlyError === null) earlyError = `出口未命中：${p.branch} ∉ [${p.outs.join(', ')}]`;
            return;
          }
          for (const t of p.targets) void spawnNode(t.nodeId, t.lane, t.input);
          logDeadEdges(p.dead, lane);
        },
        setStatus: (st, error) => setStatus(nodeId, st, lane, error),
        isAborted: () => flags.aborted,
      };
      try {
        const out = await dispatcher.dispatch(node, input, ctx);
        if (earlyError !== null) throw new Error(earlyError);
        /** 终态 done＋output 落库＋完成日志 */
        const writeDone = async (): Promise<void> => {
          setStatus(nodeId, 'done', lane);
          await storage.invoke('runs.nodeRunFinish', { nodeRunId, status: 'done', endedAt: now(), output: out });
          await log('ok', `[${lane.label}] ${defName(nodeId)} 完成 · ${((now() - t0) / 1000).toFixed(1)}s`, lane.label);
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
            logDeadEdges(r.dead, lane);
          }
        }
      } catch (e) {
        if (e instanceof ExecAbortedError) {
          // 被终止：⊘ 收敛、不交付下游（demo L1910）
          setStatus(nodeId, 'skipped', lane);
          await storage.invoke('runs.nodeRunFinish', { nodeRunId, status: 'skipped', endedAt: now(), output: null }).catch(() => undefined);
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

  function start(): void {
    // 静态不可达 ⊘ 的出边预杀（demo L1937）——下游 need-1（归零级联归 T4-03）
    for (const id of plan.skips) router.killEdgesOf(id);
    // 触发支派生：单触发=main/流程名；多触发=t:<id>/节点名（demo L1940）
    const triggers = findTriggers(doc, registry);
    for (const t of triggers) {
      const lane: Lane = triggers.length > 1 ? { key: `t:${t.id}`, label: t.name } : { key: 'main', label: deps.flowName };
      void spawnNode(t.id, lane, undefined);
    }
  }

  return { lanes, done, start };
}
