// StepPlaceholder —— 环节 5~6 占位环节页（T6-06；05 T6-06 卡「环节 3~6 以占位环节页交付
// （stepper 结构就位、能走全流程、内容区标随 T6-07/08/09）」——环节 3（schema）已由 T6-07
// StepSchema、环节 4（script）已由 T6-08 StepScript＋StepConfig 两页替换撤除，余环节 5
// （inner）/环节 6（save）T6-09 承接）。
//
// 接口约定（给 T6-09 的落位说明——替换本组件即得实环节页）：
//   · StepInner（N5 步骤列表，数据形复用 T4-09 InnerExpander）：挂环节 5（inner）槽位。
//   · StepSave/SavePipeline（N8 version/packageVersion＋source='manual'＋保存链）：挂环节 6（save）。
import type { EditorStepKey } from './definition-draft';

export interface StepPlaceholderProps {
  step: 'inner' | 'save';
}

/** 占位说明（承接卡号＝后续卡的落位锚） */
const PLACEHOLDER: Record<StepPlaceholderProps['step'], { title: string; card: string; note: string }> = {
  inner: {
    title: '组合步骤（N5）',
    card: 'T6-09',
    note: '组合节点 inner 步骤列表（非组合节点可跳过——数据形复用 T4-09 InnerExpander）',
  },
  save: {
    title: '入库保存（N8）',
    card: 'T6-09',
    note: 'version/packageVersion＋完整性校验汇总＋source=manual 入库（SavePipeline 保存链）',
  },
};

export function StepPlaceholder({ step }: StepPlaceholderProps) {
  const p = PLACEHOLDER[step];
  return (
    <div
      data-step-placeholder
      data-step={step}
      className="rounded-lg border border-dashed border-[var(--line-2)] bg-[rgba(160,200,255,0.03)] px-4 py-6 text-[12px] leading-relaxed text-[var(--tx-2)]"
    >
      <div className="mb-1.5 font-semibold text-[var(--tx)]">{p.title}</div>
      <div>{p.note}</div>
      <div data-step-placeholder-card className="mt-2 font-mono text-[11px] text-[var(--tx-3)]">
        内容区随 {p.card} 交付（本卡=骨架占位——stepper/校验门框架先行可测）
      </div>
    </div>
  );
}
