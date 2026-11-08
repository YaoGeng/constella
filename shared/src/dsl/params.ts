// N3 参数表单 schema（X-01 §1 dsl 行；02 §8.1「paramsSchema」/§8.3 参数表单 schema 驱动渲染）。
// t 白名单（V1，02 §8.1 校验规则原文）：text/number/select/textarea/boolean/secret/json/slider，
// 类型系统开放可扩展（扩展点＝注册新 renderer 映射，02 §8.3；G-1 optsFrom=vNext）。
// secret 型：掩码+加密存储（storage:'safeStorage'），明文不落 SQLite（02 §8.3/§12.3）。
export type ParamType =
  | 'text'
  | 'number'
  | 'select'
  | 'textarea'
  | 'boolean'
  | 'secret'
  | 'json'
  | 'slider'
  // 开放扩展（02 §8.1「类型系统开放可扩展」）：新参数类型随 renderer 映射注册追加
  | (string & {});

/** 抽屉保存校验项（02 §8.3：required/regex/min-max 校验在抽屉保存时执行） */
export interface ParamValidate {
  /** 正则（文本类） */
  regex?: string;
  /** 范围下限（number/slider） */
  min?: number;
  /** 范围上限（number/slider） */
  max?: number;
  /** 最少行数（textarea，02 §8.1 示例 validate:{minLines:1}） */
  minLines?: number;
}

export interface ParamField {
  /** 参数键（节点实例 params 的键；脚本侧 ctx.params 取值键） */
  k: string;
  /** 表单标签 */
  label?: string;
  /** 参数类型（白名单见 ParamType） */
  t: ParamType;
  /** 分组渲染（02 §8.3 Fieldset/Group） */
  group?: string;
  /** 默认值（覆盖序：脚本 PARAMS ← config/*.yaml ← 实例 params，02 §14） */
  default?: unknown;
  /** 必填（抽屉保存校验） */
  required?: boolean;
  /** 帮助文案 */
  help?: string;
  /** 占位符（demo 惯例键 ph，参照非权威） */
  ph?: string;
  /** 等宽渲染提示（demo 惯例键 mono，参照非权威） */
  mono?: boolean;
  /** select 静态选项（V1 静态；运行时数据驱动下拉=G-1 vNext 降级 text 手输） */
  opts?: string[];
  /** 密钥型加密存储标记（02 §8.1 示例 {k:'apiKey',t:'secret',storage:'safeStorage'}） */
  storage?: 'safeStorage';
  /** slider 范围与步进（02 §8.1 示例 {t:'slider',min:10,max:100,step:10}） */
  min?: number;
  max?: number;
  step?: number;
  /** 保存校验（02 §8.3） */
  validate?: ParamValidate;
}
