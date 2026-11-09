// InnerExpander —— N5 组合节点展开半段（C-02 §3 InnerExpander 行；T4-09；02 §8.5）。
//
// 双面：innerView=抽屉展示模型（demo L2066 形态——「组合节点 · 内部 N 步（子流程封装，
// 画布上是 1 个节点）」＋1 基编号列表）；expand=执行展开数据（步骤序列供 C-03 内联展开，
// 02 §8.5「子步骤共享该节点的沙箱进程与 ctx、日志带缩进前缀 [lane] ▸ 步骤N」——T4-02
// ExecDispatcher 已按此口径实现步骤序日志，本件为该数据面的单一来源件）。
// 纯函数 node 直跑；复用处：C-01 抽屉（innerView）、C-03（expand——数据件交付，执行侧
// 现行直接读 def.inner，换用本件为零行为差）。
//
// 自拟项留痕（§1 只冻结签名 innerView(inner)/expand(inner)，返回形未定义）：
// ExpandedInnerStep={seq,label,logPrefix}——seq 取 1 基（02 §8.5 日志「步骤N」＋demo L2066
// 编号同源）；logPrefix=`▸ 步骤N`（lane 段由执行侧拼接）；InnerStepView={total,title,steps}
// ——title 逐字取 demo L2066「组合节点 · 内部 N 步（子流程封装，画布上是 1 个节点）」，
// steps ≡ expand(inner)（展示与执行同源，杜绝两套步骤序）。
import type { InnerStep } from '@constella/shared/dsl';

/** 展开后的单步（步骤序列数据——C-03 内联展开消费单元） */
export interface ExpandedInnerStep {
  /** 步骤序（1 基——02 §8.5 日志「[lane] ▸ 步骤N」的 N） */
  seq: number;
  /** 步骤描述（inner[i] 原文） */
  label: string;
  /** 日志前缀步骤段（`▸ 步骤N`；lane 段由执行侧拼接——`[lane] ${logPrefix} ${label}` 同构 T4-02 现行输出） */
  logPrefix: string;
}

/** 抽屉 inner 步骤视图模型（demo L2066 形态） */
export interface InnerStepView {
  /** 步骤总数 */
  total: number;
  /** 展示标题（demo L2066 逐字） */
  title: string;
  /** 步骤列表（≡ expand(inner)） */
  steps: ExpandedInnerStep[];
}

/**
 * 执行展开数据（C-02 §1 签名）：inner → 1 基步骤序列。执行侧消费形=
 * `[lane] ${step.logPrefix} ${step.label}`（02 §8.5 内联展开日志序）。
 */
export function expand(inner: readonly InnerStep[]): ExpandedInnerStep[] {
  return inner.map((label, i) => ({
    seq: i + 1,
    label,
    logPrefix: `▸ 步骤${i + 1}`,
  }));
}

/**
 * N5 抽屉展示模型（C-02 §1 签名）：innerView(inner)——标题＋1 基编号步骤列表
 * （demo L2066「组合节点 · 内部 N 步…」＋`${i+1}. ${s}` 编号形态）。
 */
export function innerView(inner: readonly InnerStep[]): InnerStepView {
  return {
    total: inner.length,
    title: `组合节点 · 内部 ${inner.length} 步（子流程封装，画布上是 1 个节点）`,
    steps: expand(inner),
  };
}
