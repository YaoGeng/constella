// HitCoordinator —— 断点生命周期协调（TDD-C-03 §3 HitCoordinator 行＋§1 补充冻结段；
// 01 A-7.1 对齐 LangGraph interrupt()/Command(resume)；demo L1869-1889/L1991 行为源；T4-04）。
//   hit(nodeId,input)＝断点挂起：waiting 态由 ExecDispatcher 置（分派面）；本组件落
//   hits.create pending（data_snapshot=上游真实输出，B-4）＋runStore.pendingHits 登记＋
//   门闩挂起（resolve 载荷=最终交付下游的数据）；
//   resume(hitId,d)＝两态交付（§1 resumeHit：「合并由调用方完成，本卡校验后交付」）：
//   confirm→merged 交付下游＋hits.resolve(resolved,payload=merged)；skip→原始 input 直发
//   ＋hits.resolve(skipped,null)；未知 hitId→false no-op；
//   run 终止自动放行（finish(null) 语义，demo L1991）：300ms 轮询 isRunOver → reject
//   ExecAbortedError（节点 ⊘ 收敛）＋hits.resolve(skipped)；releaseAll()=终止即时放行
//   路径（AbortCoordinator 扩散原语，与轮询幂等互备）。
// 复用处：ExecDispatcher（human.* 门闩）、交互卡（resumeHit 通道，后续卡）。
import type { HitStatus } from '@constella/shared/ipc';
import type { StorageClient } from '../storage';
import { ExecAbortedError } from './exec-dispatcher';
import { useRunStore } from './run-store';
import type { ResumeDecision } from './types';

/** 终止轮询间隔（demo L1991 同值） */
const HIT_POLL_MS = 300;

interface HitGate {
  confirm(merged: unknown): void;
  skip(): void;
  abort(): void;
  /** 轮询 timer 清理（settle 时停拍） */
  clear(): void;
}

export interface HitCoordinatorDeps {
  runId: string;
  storage: StorageClient;
  now(): number;
  /** run 终止查询（aborted/failed 均终止——失败停派生下挂起断点同样需放行收敛） */
  isRunOver(): boolean;
  /** 轮询间隔（缺省 300ms；测试可缩短） */
  pollMs?: number;
}

export class HitCoordinator {
  private readonly gates = new Map<string, HitGate>();

  constructor(private readonly deps: HitCoordinatorDeps) {}

  /** §3 组件级接口：断点挂起——hits.create pending＋门闩；resolve 载荷=交付下游数据 */
  async hit(nodeId: string, input: unknown, question: string, options: unknown[]): Promise<unknown> {
    const { id: hitId } = await this.deps.storage.invoke('hits.create', {
      runId: this.deps.runId,
      nodeId,
      question,
      options,
      dataSnapshot: input, // B-4：上游真实输出
    });
    useRunStore.getState().hitOpened(hitId, this.deps.runId, nodeId);
    return new Promise<unknown>((resolve, reject) => {
      // run 终止 300ms 轮询自动放行（demo L1991 语义；与 AbortCoordinator 即时放行幂等互备）
      const poll = setInterval(() => {
        if (this.deps.isRunOver()) this.settle(hitId, 'skipped', null, () => reject(new ExecAbortedError()));
      }, this.deps.pollMs ?? HIT_POLL_MS);
      this.gates.set(hitId, {
        confirm: (merged) => this.settle(hitId, 'resolved', merged, () => resolve(merged)),
        skip: () => this.settle(hitId, 'skipped', null, () => resolve(input)), // 原始 input 直发（01 A-7.1）
        abort: () => this.settle(hitId, 'skipped', null, () => reject(new ExecAbortedError())),
        clear: () => clearInterval(poll),
      });
    });
  }

  /** §3 组件级接口：确认/跳过交付（RunEngine.resumeHit 通道）；未知 hitId → false */
  resume(hitId: string, d: ResumeDecision): boolean {
    const gate = this.gates.get(hitId);
    if (gate === undefined) return false;
    if (d.kind === 'confirm') gate.confirm(d.merged);
    else gate.skip();
    return true;
  }

  /** 终止即时放行全部挂起断点（AbortCoordinator 扩散原语）——返回放行数 */
  releaseAll(): number {
    const gates = [...this.gates.values()];
    for (const g of gates) g.abort();
    return gates.length;
  }

  /** 单门闩收口（幂等）：清轮询拍＋终值 resolve/reject＋hits.resolve＋镜像移除 */
  private settle(hitId: string, status: HitStatus, payload: unknown, finish: () => void): void {
    const gate = this.gates.get(hitId);
    if (gate === undefined) return;
    this.gates.delete(hitId);
    gate.clear();
    finish();
    useRunStore.getState().hitClosed(hitId);
    void this.deps.storage.invoke('hits.resolve', { id: hitId, status, payload }).catch(() => undefined);
  }
}
