// N2 端口（X-01 §1 dsl 行；02 §8.1「ports」；01 A-4.01）。
// ins 0~N 入：ins=[] 即触发节点（运行入口，C-03 RunGate 三查之一）；
// outs 1~N 出：出口命名即分支语义（如 logic.branch 的 true/false 双出口）。
// 校验规则（02 §8.1，实现归 C-02 validateDefinition）：outs ≥1 且 id 唯一；
// N6 failBranch.exit 与 N7 outputs 键集合均须 ⊆ 本节点 outs 的出口 id 集合。
export interface NodeOutPort {
  /** 出口 id（分支路由键；NodeOut.branch 必须命中此集合） */
  id: string;
  /** 出口展示名（画布多 Handle 标签） */
  label: string;
}

export interface NodePorts {
  /** 入口端口 id 列表；[]＝触发节点 */
  ins: string[];
  /** 出口端口列表；≥1（校验归 C-02） */
  outs: NodeOutPort[];
}
