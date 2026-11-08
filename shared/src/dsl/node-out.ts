// 脚本返回值联合（X-01 §1 dsl 行；02 §14 SDK 契约冻结「NodeOut」）。
// 引擎路由语义（02 §14）：{data} 无 branch → 向所有存活出边发 data；
// {branch} 只发 id===branch 的出边，其余出边死亡级联 ⊘；branch 必须命中 N2 声明的出口 id，
// 未命中按节点 error 处理；meta 原样入 node_runs.output（02 §7.1 node_runs.output JSON）。
// K-01 ts 侧 import 本形、py 侧同构复制（X-01 §2 方向裁决，不可反转）。
export type NodeOut =
  /** 单语义交付：向所有存活出边发 data */
  | { data: unknown }
  /** 路由交付：只发 id===branch 的出边；其余字段（meta 载荷）原样入 node_runs.output */
  | { branch: string; [meta: string]: unknown };
