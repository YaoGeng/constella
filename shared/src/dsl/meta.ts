// N1 元信息（X-01 §1 dsl 行；02 §8.1「meta」；01 PRD-CUSTOM-N1）。
// ✨ 角标判定＝kind==='custom'（非内置即 ✨，见 node-definition.ts NodeKind）；category 为自由文本
// （类型层面 string 不封闭，X-01 §1 constants 行 BUILTIN_CATEGORIES 注记）；source=定义来源四路
// （02 §8.2 upsert 四入口：手动/AI 现场开发/zip 导入/广场安装）。
export type NodeSource = 'ai-forge' | 'manual' | 'plaza' | 'zip';

export interface NodeMeta {
  /** 展示名（demo L867-938 全部 12 内置类型均具名） */
  name: string;
  /** 图标（emoji，类型网格/画布卡片渲染） */
  icon: string;
  /** 类目（自由文本：触发/CDP/网络/AI/数据/逻辑/交互/社媒…；perms 推导与网格分组参照） */
  category: string;
  /** 主题色（02 §8.1 示例值 "accent"；可选） */
  color?: string;
  /** 节点说明（抽屉展示；demo 自研节点 doc 字段同位语义） */
  description?: string;
  /** 作者署名（如 "@yeager"；可选） */
  author?: string;
  /** 定义来源（02 §8.1：ai-forge | manual | plaza | zip） */
  source?: NodeSource;
}
