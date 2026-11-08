// EstimationTable —— 内置/示例类型时长常量表（C-05 §3 组件行；T1-11）。
//
// ⚠ 数据落点（03 C-05 §3 原文）：node_definitions 无时长列、N1~N8 无时长字段
// （02 §7.1/§8.1）——V1 以模块内常量表承载。
// 值同源冻结：demo prototypes/demo.html L1745-1747 DUR 表逐项（4 内置＋9 示例类型，
// 共 13 项）；未命中默认 420＝demo L1905 `DUR[n.type]||420` 兜底同源。
// 用途：DUR 仅进度估计（02 §11 B-2）——C-03 进度估计、C-10 用时展示（P4 波起消费）。
export const ESTIMATION_TABLE_MS: Readonly<Record<string, number>> = {
  'cdp.open': 1200,
  'ai.llm': 950,
  'cdp.extract': 650,
  'http.request': 700,
  'gate.login': 900,
  'xhs.search': 1500,
  'xhs.detail': 1100,
  'data.vault': 420,
  'ai.classify': 950,
  'ai.copygen': 900,
  'xhs.dm.send': 1300,
  'xhs.comment.post': 1000,
  'xhs.auto-reply': 1400,
};

/** 未命中默认时长（demo L1905 `||420` 同源） */
export const DEFAULT_ESTIMATION_MS = 420;

/** 时长估计：命中表 → 表值；未命中（含全部未入表内置类型与任意自定义类型）→ 默认 */
export function estimateMs(type: string): number {
  return ESTIMATION_TABLE_MS[type] ?? DEFAULT_ESTIMATION_MS;
}
