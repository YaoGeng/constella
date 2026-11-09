// PolicyRunner —— N6 运行策略决策（TDD-C-03 §3 PolicyRunner 行；02 §8.6/§10；T4-04）。
//   onExit(nodeId, exit) → NextAction：节点脚本自身执行失败（含超时强杀、重试耗尽后）时——
//   ① 还有重试余额 → retry{attempt, waitMs}（backoffMs 指数退避：base×2^(n-1)，02 §8.1
//      示例 backoffMs:2000；重跑不计 done 重复交付/lane 数据不变——编排归 RunLoop）；
//   ② 余额耗尽 → onFailure 路由：abort（缺省）→ run.failed=true 终止整 run；
//      failBranch → 走 N2 outs 中具名出口交付（exit 命中校验=统一 NodeOut 路由 branch-miss
//      口径，02 §14；定义侧出口校验归 definition 域单一来源）；
//   ③ 0 值语义（X-4）：retries=0＝显式禁用（首败即 onFailure）；字段缺省默认 30s/0/abort
//   （timeoutMs 透传在 ExecDispatcher，缺省常量在本文件成文——02 §8.6 设计值）。
//   环境级故障豁免（X-3）：CDP 断连/终止指令等环境级失败不进本组件（调用方在 flags.failed
//   已置时直接上抛走失败终止——「不走 failBranch」的执行点在 RunLoop spawnNode）。
// 复用处：ExecDispatcher 调用方（RunLoop）；单次超时强杀=执行面看门狗（重试与路由归本卡）。
import type { RunPolicy } from '@constella/shared/dsl';

/** N6 缺省守护 30s（02 §8.6 设计值；ExecDispatcher spawn 请求透传消费） */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** backoffMs 缺省基数 1000ms（02 未冻结缺省值——本卡设计值，注记） */
export const DEFAULT_BACKOFF_MS = 1_000;

/** §3 组件级返回形：onExit → NextAction（重试退避/具名失败出口/终止） */
export type NextAction =
  | { kind: 'retry'; attempt: number; waitMs: number }
  | { kind: 'failBranch'; exit: string }
  | { kind: 'abort' };

export interface PolicyRunnerDeps {
  /** 节点 → N6 policy（装配点注入 nodeOf+registry.get 投影；null/undefined=字段全缺省） */
  policyOf(nodeId: string): RunPolicy | null | undefined;
}

export class PolicyRunner {
  private readonly failures = new Map<string, number>();

  constructor(private readonly deps: PolicyRunnerDeps) {}

  /**
   * §3 组件级接口：节点失败退出 → 下一步决策。attempt 计数内部按节点维护
   * （n<=retries → retry；耗尽 → onFailure：failBranch 具名出口 / abort 缺省）。
   */
  onExit(nodeId: string, _exit: string): NextAction {
    const policy = this.deps.policyOf(nodeId) ?? null;
    const retries = policy?.retries ?? 0; // 缺省 0；显式 0=禁用（同路径：n=1>0 不成立即耗尽）
    const n = (this.failures.get(nodeId) ?? 0) + 1;
    this.failures.set(nodeId, n);
    if (retries > 0 && n <= retries) {
      const base = policy?.backoffMs ?? DEFAULT_BACKOFF_MS;
      return { kind: 'retry', attempt: n, waitMs: base * 2 ** (n - 1) }; // 指数退避
    }
    const onFailure = policy?.onFailure ?? { type: 'abort' };
    return onFailure.type === 'failBranch' ? { kind: 'failBranch', exit: onFailure.exit } : { kind: 'abort' };
  }

  /** 节点计数清零（重入场景防御；run 内节点正常只执行一次） */
  reset(nodeId: string): void {
    this.failures.delete(nodeId);
  }
}
