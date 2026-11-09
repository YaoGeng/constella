// ConvergenceSweeper —— inflight 归零收敛（TDD-C-03 §3 组件行；02 §10 #7「环/依赖缺失在
// 收敛时统一 ⊘」；demo L1942-1945 行为源；T4-03）。
// drain 后剩余非终态节点（环搁浅/依赖缺失/部分交付残局/终止波及）统一 ⊘；run 终态映射：
// failed → error（失败终止不因收敛翻 done）、aborted → aborted、否则 done（run=done 不失败）。
// 终态判定=done/error/skipped 三值（statuses 单调；running/waiting 在 drain 后理论不残留，
// 防御性统一 ⊘——demo L1945 同款全量兜底）。
import type { NodeStatus } from './types';

export interface ConvergenceSweeperDeps {
  /** 全量节点 id（含未启动） */
  nodeIds: readonly string[];
  statusOf(nodeId: string): NodeStatus | undefined;
  /** ⊘ 落地回调（statuses＋事件；收敛波及多为未启动节点，无 nodeRunStart/Finish） */
  skipNode(nodeId: string): void;
  isAborted(): boolean;
  isFailed(): boolean;
}

export interface ConvergeOutcome {
  /** run 终态（02 §10 #7＋demo L1946：failed 优先于 aborted） */
  status: 'done' | 'error' | 'aborted';
  /** 统一 ⊘ 的节点（环/依赖缺失/终止波及） */
  swept: string[];
}

export class ConvergenceSweeper {
  constructor(private readonly deps: ConvergenceSweeperDeps) {}

  sweep(): ConvergeOutcome {
    const swept: string[] = [];
    for (const id of this.deps.nodeIds) {
      const st = this.deps.statusOf(id);
      if (st === 'done' || st === 'error' || st === 'skipped') continue;
      this.deps.skipNode(id);
      swept.push(id);
    }
    const status = this.deps.isFailed() ? 'error' : this.deps.isAborted() ? 'aborted' : 'done';
    return { status, swept };
  }
}
