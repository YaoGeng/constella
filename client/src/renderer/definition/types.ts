// DefinitionValidator 契约类型（C-02 §1；T4-07）。imports ↓ 仅 X-01 纯类型——零运行时依赖。
// ⚠ 禁止 import C-05（校验器被 C-05 装载注入调用——反向依赖，§2）；FieldError 与
// node-registry/types.ts 同形（{field,message}）＋自拟增项 rule（规则定位码）——结构兼容使
// validateDefinition 可直接赋给 C-05 loadAll 的 DefinitionValidator 形参（T1-10 装配点零改动）。

/** 八条规则定位码（自拟项留痕：N 前缀=对应维度；消费方 C-13/C-07/C-08 按码映射 UI 提示） */
export type DefRule =
  | 'N1-namespace' // #1 custom type 撞内置（双查）
  | 'N2-outs-empty' // #2 outs ≥1
  | 'N2-outs-duplicate' // #2 出口 id 唯一
  | 'N3-type' // #3 t ∈ 白名单 8 类
  | 'N3-validate' // #3 validate 形合法
  | 'N4-exec' // #4 lang∈{python,ts}＋file/entry 非空
  | 'N6-failBranch' // #5 failBranch exit 命中 outs
  | 'N7-output-fields' // #6 io.output.fields 每项 name＋type
  | 'N7-outputs-keys' // #7 io.outputs 键 ⊆ outs
  | 'N7-outputs-fields' // #7 per-exit fields 每项 name＋type
  | 'N8-semver'; // #8 version/pkg_version semver 形状

export interface FieldError {
  /** 违例字段路径（DSL 键定位，如 ports.outs[1].id / paramsSchema[0].t） */
  field: string;
  /** 人读错误信息 */
  message: string;
  /** 规则定位码（见 DefRule） */
  rule: DefRule;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
}

/** 命名空间查重注入面（§1：ctx.hasType=C-05 注入——registry.has 的只读投影；
 * C-13/C-07/C-08 装配点各自构造，编辑既有定义时应传排除自身的 ctx） */
export interface ValidateContext {
  hasType(t: string): boolean;
}
