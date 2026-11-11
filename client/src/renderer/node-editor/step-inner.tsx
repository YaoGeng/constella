// StepInner —— 环节 5 组合步骤表单（T6-09；TDD-C-13 §1 六环节组件面「StepInner（N5 步骤
// 列表，非组合节点可跳过——数据形复用 T4-09 InnerExpander）」＋§3 组件行；01 §5.3 PATH1
// 环节 5／02 §8.5 子步骤内联展开）。
//
//   数据形=InnerStep[]（X-01 dsl「inner: readonly InnerStep[] | null」——T4-09 InnerExpander
// .expand(inner) 的消费形同源：string[]，执行侧内联展开＋日志「[lane] ▸ 步骤N」）；UI=1 基
// 编号列表（demo L2066「组合节点 · 内部 N 步」编号形态同源）。
//   非组合节点可跳过：null=未声明（空态提示）；删尽步骤→null（复原未声明态）。环节门对
// 无 inner 定义不拦（02 §8.1 八条规则无 N5 条——computeStepErrors 零投影，门天然放行）。
//   受控输入：行 value=props（draft.inner 逐项）——删除中行无幽灵残留（React key=index＋
// 全受控 value=安全形，T6-07 教训注释位）。
import type { InnerStep } from '@constella/shared/dsl';

export interface StepInnerProps {
  /** N5 组合步骤草稿（draft.inner 直读；null=非组合节点未声明） */
  inner: readonly InnerStep[] | null;
  onChange(inner: readonly InnerStep[] | null): void;
}

const BTN_CLS = 'rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-40';

export function StepInner({ inner, onChange }: StepInnerProps) {
  const steps = inner ?? [];

  return (
    <div data-step-form="inner" className="flex flex-col gap-3">
      {/* 语义说明（02 §8.5：子流程封装，画布上是 1 个节点——执行时内联展开） */}
      <div
        data-testid="ne-inner-semantics"
        className="rounded-md border border-[var(--line-2)] bg-[rgba(160,200,255,0.03)] px-3 py-1.5 text-[11px] leading-relaxed text-[var(--tx-2)]"
      >
        组合节点 · 内部 {steps.length} 步（子流程封装，画布上是 1 个节点；执行时引擎内联展开，日志带「▸ 步骤N」前缀）
      </div>

      {steps.length === 0 ? (
        // 空态=非组合节点（可跳过——环节门不拦：直接「下一步」到入库保存）
        <div
          data-inner-empty
          className="rounded-lg border border-dashed border-[var(--line-2)] px-4 py-5 text-[12px] leading-relaxed text-[var(--tx-3)]"
        >
          未声明组合步骤——非组合节点（本环节可跳过，直接下一步到入库保存）。点击「添加步骤」开始定义内部子步骤序列。
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {steps.map((label, i) => (
            <li key={i} data-inner-row data-inner-row-index={i} className="flex items-center gap-2">
              <span data-inner-seq={i + 1} className="w-6 shrink-0 text-right font-mono text-[11px] text-[var(--tx-3)]">
                {i + 1}.
              </span>
              <input
                data-inner-input={i}
                value={label}
                placeholder={`步骤 ${i + 1} 描述（如：打开搜索页）`}
                onChange={(e) => onChange(steps.map((s, j) => (j === i ? e.target.value : s)))}
                className="min-w-0 flex-1 rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                data-inner-remove={i}
                aria-label={`删除步骤 ${i + 1}`}
                onClick={() => {
                  const next = steps.filter((_, j) => j !== i);
                  onChange(next.length === 0 ? null : next); // 删尽→null（非组合声明复原）
                }}
                className={BTN_CLS}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-inner-add
          onClick={() => onChange([...steps, ''])}
          className={BTN_CLS}
        >
          ＋ 添加步骤
        </button>
        {steps.length > 0 && (
          <button
            type="button"
            data-inner-clear
            title="清空步骤——回到非组合节点（inner 未声明）"
            onClick={() => onChange(null)}
            className={BTN_CLS}
          >
            设为非组合节点
          </button>
        )}
      </div>
    </div>
  );
}
