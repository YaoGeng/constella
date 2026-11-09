// IoContractKit —— N7 IO 契约展示与核对半段（C-02 §3 IoContractKit 行；T4-09；02 §8.7）。
//
// 双面：ioView=抽屉 io 区展示模型（B-13：按 N7 声明展示、多出口按出口分列 X-5、未声明回退
// `out → {data}` 契约文案）；checkIoCompat=上下游兼容核对（N7 用途③——下游引用字段在上游
// io.output.fields 或 per-exit outputs 可寻，02 §9.1 六查第⑤查；供 C-07 PlanValidator⑤ 复用）。
// 纯函数 node 直跑；复用处：C-01 抽屉 io 区（ioView）、C-07 PlanValidator⑤（checkIoCompat）。
// io 区数据=只读展示（05 T4-09 备注：不含执行逻辑）。
//
// 自拟项留痕（§1 只冻结签名 ioView(io,outs)/checkIoCompat(up,exitId,down)，返回形未定义）：
// IoExitColumn.source 三态＝X-5 归并语义的显式化（'outputs'=per-exit 声明命中/'output'=单
// output 回退〔02 §8.1「未声明的出口回退单 output」〕/'fallback'=双缺契约兜底）；contractText
// 逐出口生成 `${exitId} → {data}`（B-13 字面为单出口 `out → {data}`，多出口未声明出口按
// 出口 id 推广）；输入侧未声明回退文案「in ← 上游 data」取 demo L2064 形态正式化——签名无
// ins，触发节点（ins=[]）的「（触发节点）」区分归宿主层，不在本模型面。
import type { IoContract, IoField } from '@constella/shared/dsl';

/** io 区单出口列（B-13 展示模型——per-exit 分列单元） */
export interface IoExitColumn {
  /** 出口 id（N2 outs 项，声明序） */
  exitId: string;
  /** 出口展示名（outs[].label 缺省回退 exitId） */
  label: string;
  /** 该出口交付的字段目录（X-5 归并后；空=未声明 → contractText 兜底） */
  fields: IoField[];
  /** 声明归并来源：'outputs'=per-exit 声明 / 'output'=单 output 回退（X-5） / 'fallback'=未声明兜底（B-13） */
  source: 'outputs' | 'output' | 'fallback';
  /** B-13 契约文案（source='fallback' 时=`${exitId} → {data}`；声明态=undefined） */
  contractText?: string;
}

/** io 区输入侧（demo L2064 `in ← 上游 data` 形态正式化） */
export interface IoInputView {
  /** 声明的输入字段目录（io.input.fields；空=未声明） */
  fields: IoField[];
  /** 未声明回退文案（声明态=undefined） */
  contractText?: string;
}

/** 抽屉 io 区展示模型（§1 ioView 返回形） */
export interface IoView {
  input: IoInputView;
  /** per-exit 分列（X-5）——outs 声明序全量出口（未声明出口占位列=契约文案兜底） */
  exits: IoExitColumn[];
}

/** 兼容核对问题（§1 checkIoCompat 返回形；消费方 PlanValidator⑤ 逐条列计划卡） */
export interface IoIssue {
  /** 下游缺失字段（down.input.fields[].name） */
  field: string;
  /** 连线 from 出口 id */
  exitId: string;
  /** 人读说明 */
  message: string;
}

/** 未声明输入回退文案（demo L2064） */
export const IO_INPUT_FALLBACK_TEXT = 'in ← 上游 data';

/** 上游出口交付字段目录（X-5 归并：per-exit outputs[exitId] 优先 → 单 output 回退 → 双缺=null） */
function deliveredFields(
  up: IoContract | null | undefined,
  exitId: string,
): { fields: IoField[]; source: 'outputs' | 'output' } | null {
  const perExit = up?.outputs?.[exitId];
  if (perExit !== undefined) return { fields: perExit.fields ?? [], source: 'outputs' };
  const single = up?.output;
  if (single !== undefined) return { fields: single.fields ?? [], source: 'output' };
  return null;
}

/**
 * 抽屉 io 区展示模型（C-02 §1 签名；B-13：按 N7 声明展示、多出口按出口分列 X-5、
 * 未声明回退契约文案）。outs=本节点 N2 出口表（{id,label}——C-01 抽屉经 registry.get 取
 * def.ports.outs 传入）。参数收 `IoContract | null | undefined`（有意放宽留痕：X-01
 * NodeDefinition.io 本身可空——null/undefined=整体未声明，输入侧与全出口均契约文案兜底）。
 */
export function ioView(io: IoContract | null | undefined, outs: readonly { id: string; label?: string }[]): IoView {
  const exits: IoExitColumn[] = outs.map((o) => {
    const exitId = o.id;
    const delivered = deliveredFields(io, exitId);
    return {
      exitId,
      label: o.label ?? exitId,
      fields: delivered?.fields ?? [],
      source: delivered?.source ?? 'fallback',
      ...(delivered === null ? { contractText: `${exitId} → {data}` } : {}),
    };
  });

  const inputFields = io?.input?.fields ?? [];
  return {
    input: {
      fields: inputFields,
      ...(inputFields.length === 0 ? { contractText: IO_INPUT_FALLBACK_TEXT } : {}),
    },
    exits,
  };
}

/**
 * 上下游兼容核对（C-02 §1 签名；N7 用途③）：down.input 声明的引用字段须在 up 于 exitId
 * 出口交付的字段目录（X-5 归并）中可寻（02 §9.1 六查⑤「下游引用字段在上游 io.output.fields
 * 或 per-exit outputs 可寻」）。up 该出口未声明任何输出（兜底 {data}）＝声明面上不可寻，
 * 逐字段报 issue——供 AI 规划链拦截（宁拦勿漏；用户手连不走本核对）。
 *
 * 参数收 `IoContract | null | undefined`（有意放宽留痕：X-01 NodeDefinition.io 本身可空
 * 〔`io?: IoContract | null`〕，PlanValidator 装配点直传 def.io——null=整体未声明，
 * 全部下游引用字段按兜底不可寻报 issue；down 可空同因）。
 */
export function checkIoCompat(
  up: IoContract | null | undefined,
  exitId: string,
  down: IoContract | null | undefined,
): IoIssue[] {
  const need = down?.input?.fields ?? [];
  if (need.length === 0) return []; // 下游未声明输入=无核对面

  const delivered = deliveredFields(up, exitId);
  const issues: IoIssue[] = [];
  for (const f of need) {
    const field = f?.name;
    if (typeof field !== 'string' || field === '') continue;
    if (delivered === null) {
      issues.push({
        field,
        exitId,
        message: `上游出口「${exitId}」未声明输出契约（兜底 {data}），无法核对字段「${field}」`,
      });
    } else if (!delivered.fields.some((d) => d?.name === field)) {
      issues.push({
        field,
        exitId,
        message: `下游引用字段「${field}」不在上游出口「${exitId}」的输出声明中`,
      });
    }
  }
  return issues;
}
