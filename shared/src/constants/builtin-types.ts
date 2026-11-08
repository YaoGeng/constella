// 内置类型清单（X-01 §1 constants 行；01 PRD-A4-01 清单冻结（L256）；00b §4）。
// V1.0 面＝12 type；V1.1 增补＝out.* 五类型 12→17 随 B2 生效（✅ M4 #8⑩，C-19 §5 会签）——
// 届时本元组升版，§6.5 一致性断言随 B2 升版（check-shared-consts.mjs 期望集同步）。
// 用途：C-02 命名空间校验（custom 前缀不得撞内置）、C-05 种子核对、C-06 种子写入对账。
export const BUILTIN_TYPE_IDS = [
  'trigger.manual',
  'trigger.cron',
  'cdp.open',
  'cdp.extract',
  'cdp.click',
  'http.request',
  'ai.llm',
  'data.transform',
  'logic.branch',
  'delay',
  'file.write',
  'human.review',
] as const;

export type BuiltinTypeId = (typeof BUILTIN_TYPE_IDS)[number];
