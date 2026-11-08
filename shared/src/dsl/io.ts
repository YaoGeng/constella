// N7 IO 契约（X-01 §1 dsl 行；02 §8.1「io」/§8.7 IO 契约；X-5 per-exit 声明）。
// 三用途（02 §8.7）：①抽屉 io 区展示真实输出示例（B-13）②AI 规划器选型依据（02 §9.3）
// ③PlanValidator 端口/字段级校验（02 §9.5 六查第⑤查）。
// 单 output 与按出口 outputs 兼容共存（X-5）：outputs 存在时其键集合须 ⊆ N2 outs（校验归 C-02），
// 未声明的出口回退单 output；运行时实际输出存 node_runs.output（NodeOut）。
export interface IoField {
  /** 字段名（校验：每项必有 name+type，02 §8.1） */
  name: string;
  /** 字段类型（自由形如 "string[]" / "object[]"，02 §8.1 示例） */
  type: string;
  /** 输出示例（如 "[{title,likes,url}]"，02 §8.1 output 示例） */
  example?: string;
}

/** 单出口输出声明（io.output 形） */
export interface IoOutputSpec {
  fields: IoField[];
}

export interface IoContract {
  /** 输入声明（02 §8.1 示例 {"type":"object","fields":[…]}） */
  input?: { type?: string; fields: IoField[] };
  /** 单输出声明（兼容既有形态） */
  output?: IoOutputSpec;
  /** per-exit 输出声明（X-5）：{"<exitId>": {fields:[…]}}；键集合 ⊆ N2 outs */
  outputs?: Record<string, IoOutputSpec>;
}
