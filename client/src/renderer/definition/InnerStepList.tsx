// InnerStepList —— N5 抽屉 inner 步骤列表渲染件（C-02 §3 InnerExpander 组件行展示半段；T4-09）。
//
// demo L2066 形态正式化（`🧬 组合节点 · 内部 N 步（子流程封装，画布上是 1 个节点）`＋
// `${i+1}. ${s}` 1 基编号列表）；数据=InnerStepView 模型（innerView 产物）——本件零逻辑
// 纯渲染（只读展示，不含执行逻辑——05 T4-09 备注）。复用处：C-01 抽屉 inner 区（经
// DrawerContent 组合）；样式=tailwind 工具类＋玻璃 CSS 变量（ParamForm 同风格）。
import { cn } from '../lib/utils';
import type { InnerStepView } from './inner-expander';

export interface InnerStepListProps {
  /** innerView(inner) 产物（展示模型） */
  view: InnerStepView;
  /** 容器类名透传（宿主布局注入） */
  className?: string;
}

export function InnerStepList({ view, className }: InnerStepListProps) {
  return (
    <section
      data-inner-steps
      className={cn(
        'rounded-lg border border-[var(--line)] bg-[rgba(160,200,255,0.03)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--tx-2)]',
        className,
      )}
    >
      <div className="mb-1.5 font-semibold text-[var(--tx)]">🧬 {view.title}</div>
      <ol className="flex flex-col gap-0.5">
        {view.steps.map((s) => (
          <li key={s.seq} data-inner-step>
            {s.seq}. {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
