// ConnectValidator —— 连线三查纯函数（T3-04；C-01 §1/§3 ConnectValidator 行；01 A-3.4；
// demo L1520-1533 语义：检查序 self → no-input → duplicate）。
//
// 纯函数：C-05 ports 与现有边经 ctx 注入（组件测试/InteractionMachine 共用同一判定）。

/** 端点引用（nodeId + portId）。 */
export interface NodeRef {
  nodeId: string;
  portId: string;
}

export type ConnectionCheckResult = 'ok' | 'self' | 'no-input' | 'duplicate';

export interface ConnectionContext {
  /** 目标节点是否存在输入口（读 C-05 ports.ins——ins=[] 即触发节点）。 */
  targetHasInput: boolean;
  /** 现有边集合（端口元组形）。 */
  edges: readonly { from: readonly [string, string]; to: readonly [string, string] }[];
}

/** 三违例 toast 文案（demo L1524/L1526/L1528 逐字；name=目标定义展示名）。 */
export function violationMessage(result: Exclude<ConnectionCheckResult, 'ok'>, targetName: string): string {
  switch (result) {
    case 'self':
      return '不能连接自己';
    case 'no-input':
      return `「${targetName}」是触发节点，没有输入口`;
    case 'duplicate':
      return '这条连线已存在';
  }
}

/**
 * 三查（检查序=demo 语义）：
 * 1. self —— 自连（同节点）
 * 2. no-input —— 目标 ins=[] 触发节点无入口
 * 3. duplicate —— 重复边：同 from 节点＋同 from 出口 → 同目标节点即重复
 *    （demo L1528 不比 to 端口——to 恒默认入口；同 from 出口到同目标不构成第二条）
 */
export function validateConnection(from: NodeRef, to: NodeRef, ctx: ConnectionContext): ConnectionCheckResult {
  if (from.nodeId === to.nodeId) return 'self';
  if (!ctx.targetHasInput) return 'no-input';
  const dup = ctx.edges.some(
    (e) => e.from[0] === from.nodeId && e.from[1] === from.portId && e.to[0] === to.nodeId,
  );
  if (dup) return 'duplicate';
  return 'ok';
}
