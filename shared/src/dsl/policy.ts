// N6 运行策略（X-01 §1 dsl 行；02 §8.1「policy」/§8.6 运行策略）。
// 0 值语义（X-4，02 §8.6）：timeoutMs=0＝显式不设超时守护；retries=0＝显式禁用重试——
// 0 是显式声明的有效值，与「字段缺省默认值」严格区分（缺省默认＝timeout 30s、retries 0、
// onFailure abort，设计值 03 冻结）——故以下字段均可缺省。
// 字段可增（02 §8.8 末段既有预留扩展点）。
export type OnFailure =
  /** 终止整 run（对齐 demo 强节点失败即终止；缺省默认） */
  | { type: 'abort' }
  /** 走具名失败出口（X-3）：exit 必须命中本节点 N2 outs 的出口 id 集合（校验归 C-02）；
   * 仅承接节点脚本自身执行失败（含超时强杀、重试耗尽后）——CDP 断连等环境级故障不走 failBranch */
  | { type: 'failBranch'; exit: string };

export interface RunPolicy {
  /** 超时守护（ms）；0＝不设守护；缺省默认 30s（TimeoutGuard 消费，02 §8.6） */
  timeoutMs?: number;
  /** 重试次数；0＝显式禁用重试（宁漏勿重红线）；缺省默认 0（RetryPolicy 消费） */
  retries?: number;
  /** 指数退避基数（ms，02 §8.1 示例 backoffMs:2000） */
  backoffMs?: number;
  /** 失败策略两形态（X-3，02 §8.6）；缺省默认 abort */
  onFailure?: OnFailure;
}
