// AbortCoordinator —— 终止瞬时扩散（TDD-C-03 §3 组件行；02 §10 #8「置 aborted 标志、
// 50ms 步进轮询自觉退出、瞬时扩散所有并行分支」；demo L1777-1787/L1781；T4-03）。
//   abort(runId)＝三原语：① 置 aborted 标志（执行循环停派生＋delay 50ms 步进自觉退出）
//   ② killScript×活跃脚本数（沙箱子进程树强杀——脚本自身无步进可查标志，靠 main 强杀；
//      in-band 幂等） ③ waiting 断点自动放行（finish(null) 语义——demo L1991 的终止分支，
//      门闩 reject ExecAbortedError→节点 ⊘ 收敛；resume 交互归 T4-04 HitCoordinator）。
//   destroySessions(runId)：cdp:destroyRun 统一销毁 lane 会话——abort 与收敛收尾两路
//   共用、幂等恰一次（A-6.4/A-8.1；保 dock 主窗=S-3 坑②归 main 侧）。
// 复用处：RunEngine.abortRun、收敛收尾序（§3）。
import type { RunTransport } from './types';

/** run 级终止扩散挂钩（RunLoop 注册：标志位/活跃脚本快照/断点门闩） */
export interface AbortHooks {
  /** 置 aborted 标志（执行循环自觉退出位） */
  markAborted(): void;
  /** 活跃脚本 nodeRunId 快照（killScript×活跃数） */
  activeScriptRuns(): readonly string[];
  /** waiting 断点自动放行——返回放行数 */
  releaseWaitingHits(): number;
}

export interface AbortCoordinatorDeps {
  /** 执行面传输（缺省→仅本地扩散：置位＋放行，kill/destroy 静默跳过） */
  transport?: RunTransport;
}

export class AbortCoordinator {
  private readonly hooks = new Map<string, AbortHooks>();
  private readonly destroyedRuns = new Set<string>();

  constructor(private readonly deps: AbortCoordinatorDeps) {}

  /** run 启动时注册挂钩（RunLoop 创建处） */
  register(runId: string, hooks: AbortHooks): void {
    this.hooks.set(runId, hooks);
  }

  /** 收敛收尾解除注册（清理长生命周期引用——移交项 #7） */
  unregister(runId: string): void {
    this.hooks.delete(runId);
  }

  /** run 收尾清理销毁去重台账（P-2：destroyedRuns 不随 cleanupRun 泄漏——runId 不复用防御性清理） */
  forgetRun(runId: string): void {
    this.destroyedRuns.delete(runId);
  }

  /**
   * 终止瞬时扩散（§3 组件级接口）。返回 false=未注册（调用方回退直接置标志）。
   * killScript 逐脚本 fire-and-forget——个别 IPC 故障不阻塞其余扩散（X-3 方向）。
   */
  abort(runId: string): boolean {
    const hooks = this.hooks.get(runId);
    if (hooks === undefined) return false;
    hooks.markAborted();
    const transport = this.deps.transport;
    if (transport !== undefined) {
      for (const nodeRunId of hooks.activeScriptRuns()) {
        void transport.killScript({ nodeRunId }).catch(() => undefined);
      }
    }
    hooks.releaseWaitingHits();
    return true;
  }

  /** lane 会话统一销毁（cdp:destroyRun）——幂等恰一次；in-band 环境级故障不阻塞收尾 */
  async destroySessions(runId: string): Promise<void> {
    if (this.destroyedRuns.has(runId)) return;
    this.destroyedRuns.add(runId);
    const transport = this.deps.transport;
    if (transport === undefined) return;
    try {
      await transport.cdpDestroyRun({ runId });
    } catch {
      // IPC 断连等环境级故障不阻塞本地收尾（X-3 语义方向）
    }
  }
}
