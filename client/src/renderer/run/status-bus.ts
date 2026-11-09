// StatusBus —— 事件总线＋statuses 双写管线（TDD-C-03 §3 StatusBus 行＋§1 补充冻结段；
// A-6.5；demo L1763-1767 setNodeStatus 双写=语义源；T4-04——T4-02/03 内联双写收口至此）。
//   管线：statuses=数据源（RunLoop 写）→ emit(e) 事件（onNodeStatus 订阅面）→ nodeRunStart/
//   nodeRunFinish/logs.append/runs.finish 经 storage:invoke 落 C-06 → UI 各自刷新（A-6.5）。
//   onLog=日志事件导出面（M4 收口会签 #2——事件源=logs.append 双写管线同点派发；消费=
//   任务表 logs$ 实时上游）。
//   hits.* 双写归 HitCoordinator（断点生命周期组件直调）；runs.finish 编排归 RunEngine
//   （收尾序），本组件承载其 op 面与终态日志。
// 复用处：RunEngine（事件/日志导出）、RunLoop（nodeRun 双写）——上层 UI 经 RunEngine 订阅。
import type { LogLevel, NodeRunStatus } from '@constella/shared/ipc';
import type { NodeOut } from '@constella/shared/dsl';
import type { StorageClient } from '../storage';
import type { LogLine, NodeStatusEvent } from './types';

export interface StatusBusDeps {
  storage: StorageClient;
  now(): number;
}

export class StatusBus {
  private readonly statusSubs = new Set<(e: NodeStatusEvent) => void>();
  private readonly logSubs = new Set<(line: LogLine) => void>();

  constructor(private readonly deps: StatusBusDeps) {}

  /** §3 组件级接口：节点态事件派发（statuses 已由调用方写入=数据源，A-6.5） */
  emit(e: NodeStatusEvent): void {
    for (const fn of this.statusSubs) fn(e);
  }

  /** §3 组件级接口：onNodeStatus 订阅面（RunEngine.onNodeStatus 转发） */
  subscribe(fn: (e: NodeStatusEvent) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  /** §3 组件级接口：onRunLog 订阅面（M4 #2——事件源=appendLog 同点派发） */
  onLog(fn: (line: LogLine) => void): () => void {
    this.logSubs.add(fn);
    return () => this.logSubs.delete(fn);
  }

  /** logs.append 双写管线：storage 落库 → 同点派发 onRunLog（LogLine 形=logs 表行去 id） */
  async appendLog(level: LogLevel, msg: string, ctx: { flowId?: string; runId?: string; laneLabel?: string } = {}): Promise<void> {
    const line: LogLine = { ts: new Date(this.deps.now()).toISOString(), level, msg, ...ctx };
    await this.deps.storage.invoke('logs.append', { level, msg, ...ctx });
    for (const fn of this.logSubs) fn(line);
  }

  /** runs.nodeRunStart 双写（nodeRun 行创建——X-01 op args 原形） */
  async nodeRunStart(args: { nodeRunId: string; runId: string; laneId: string; nodeId: string }): Promise<void> {
    await this.deps.storage.invoke('runs.nodeRunStart', args);
  }

  /** runs.nodeRunFinish 双写（output={data}|{branch,meta}——02 §14；调用方 fire-and-forget 容错） */
  async nodeRunFinish(args: {
    nodeRunId: string;
    status: NodeRunStatus;
    endedAt?: number;
    output?: NodeOut | null;
    error?: string | null;
  }): Promise<void> {
    await this.deps.storage.invoke('runs.nodeRunFinish', args);
  }
}
