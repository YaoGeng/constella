// IoContractView —— N7 抽屉 io 区渲染件（C-02 §3 IoContractKit 组件行展示半段；T4-09；B-13）。
//
// demo L2063-2064 io-box 形态正式化（替代 `out → { data } [mock]`——02 §8.7 用途①）：输入行＋
// per-exit 出口分列（X-5）；未声明出口列=契约文案兜底（B-13 `${exitId} → {data}`）。数据=
// IoView 模型（ioView 产物）——本件零逻辑纯渲染（只读展示，不含执行逻辑）；样式=tailwind
// 工具类＋玻璃 CSS 变量（ParamForm 同风格）。复用处：C-01 抽屉 io 区（经 DrawerContent 组合）。
import { cn } from '../lib/utils';
import type { IoView } from './io-contract-kit';

export interface IoContractViewProps {
  /** ioView(io,outs) 产物（展示模型） */
  view: IoView;
  /** 容器类名透传（宿主布局注入） */
  className?: string;
}

export function IoContractView({ view, className }: IoContractViewProps) {
  return (
    <section data-io-panel className={cn('flex flex-col gap-1.5 text-[11px]', className)}>
      <div className="font-mono text-[9.5px] tracking-wide text-[var(--tx-3)]">输入 / 输出</div>
      <div
        data-io-input
        className="rounded-md border border-[var(--line)] bg-[rgba(7,12,25,0.6)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--tx-2)]"
      >
        <span className="text-[var(--accent)]">in </span>
        {view.input.contractText ??
          view.input.fields.map((f) => `${f.name}: ${f.type}`).join(' · ')}
      </div>
      {view.exits.map((e) => (
        <div
          key={e.exitId}
          data-io-exit={e.exitId}
          className="rounded-md border border-[var(--line)] bg-[rgba(7,12,25,0.6)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--tx-2)]"
        >
          {e.source === 'fallback' ? (
            // 契约文案＝模型层 contractText（B-13：`${exitId} → {data}`，自带出口前缀）
            <span data-io-contract={e.exitId}>
              {e.contractText}（未声明——契约兜底）
            </span>
          ) : (
            <span data-io-declared={e.exitId}>
              <span className="text-[var(--accent)]">{e.exitId} </span>→{' '}
              {e.fields.map((f) => `${f.name}: ${f.type}`).join(' · ')}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
