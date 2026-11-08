// CategoryIndex —— 类目倒排索引＋稳定排序（C-05 §3 组件行；T1-09）。
// 消费方：C-01 类型网格、C-13/C-04 类型选择（02 §3.2）。
// 稳定口径：类目键按首次出现序（demo 类型网格 L2045-2051 分组序同源——内置 12 的
// 注册序天然给出 触发→CDP→网络→AI→数据→逻辑→交互）；组内＝注册序（RegistryCore.list()
// 的 Map 迭代序，覆盖不改位）。覆盖可变类目（meta.category 自由文本），故每次调用按
// list() 序重建倒排——覆盖改类目后旧组自动移除、新组按其注册位收录。
import type { NodeDefinition } from '@constella/shared/dsl';

export class CategoryIndex {
  /** 类目 → 该类目定义列表（倒排；调用方获独立快照） */
  listByCategory(defs: readonly NodeDefinition[]): Record<string, NodeDefinition[]> {
    const index: Record<string, NodeDefinition[]> = {};
    for (const doc of defs) {
      const bucket = index[doc.meta.category];
      if (bucket === undefined) {
        index[doc.meta.category] = [doc];
      } else {
        bucket.push(doc);
      }
    }
    return index;
  }
}
