// 内置类型类目集合（X-01 §1 constants 行；demo L867-938 cat 值域参照（非权威）＋02 §8.1 N1）。
// 供类型网格分组排序 / perms 推导映射参照；N1 category 为自由文本，类型层面 string 不封闭
// （X-01 §1 constants 行原文）——本常量仅为内置 12 type 的类目投影，非白名单。
// 顺序＝demo 类型注册表首现序（触发→CDP→网络→AI→数据→逻辑→交互）。
export const BUILTIN_CATEGORIES = [
  '触发',
  'CDP',
  '网络',
  'AI',
  '数据',
  '逻辑',
  '交互',
] as const;

export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];
