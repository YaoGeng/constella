// StepPorts —— 环节 2 端口表单（T6-06；TDD-C-13 §3 StepPorts 行「ins/outs 增删＋出口命名
// ＋只读卡片预览实时反映端口布局」；01 §5.3 PATH1 环节 2＋PRD-CUSTOM-N2）。
//
//   N2 语义：入口 0~N（ins=[] 即触发节点可作运行入口）、出口 1~N（outs ≥1 校验归 C-02
// N2-outs-empty）；出口命名即分支语义（id 路由键＋label 画布标签）。增删即时写草稿，
// 预览由 EditorShell 侧 NodeCardPreview 同渲染实时反映（本组件不持预览——编排归 shell）。
import type { NodePorts } from '@constella/shared/dsl';
import type { StepFieldError } from './definition-draft';

export interface StepPortsProps {
  ports: NodePorts;
  /** ports 环节门错误（N2-outs-empty/N2-outs-duplicate 等） */
  errors: readonly StepFieldError[];
  onChange(ports: NodePorts): void;
}

const INPUT_CLS =
  'w-full rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 text-[12px] font-mono text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none';

const BTN_CLS = 'rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)]';

/** 最小未占用后缀 id（add-out/add-in 生成不与现存撞名的缺省 id——重复仍可手造，门拦） */
function freshId(prefix: string, used: readonly string[]): string {
  let n = used.length + 1;
  const taken = new Set(used);
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function StepPorts({ ports, errors, onChange }: StepPortsProps) {
  const setOut = (i: number, patch: Partial<{ id: string; label: string }>): void => {
    const outs = ports.outs.map((o, j) => (j === i ? { ...o, ...patch } : o));
    onChange({ ...ports, outs });
  };

  return (
    <div data-step-form="ports" className="flex flex-col gap-4">
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--tx-2)]">
            入口 ins（0~N——清空即触发节点，01 PRD-CUSTOM-N2）
          </span>
          <button
            type="button"
            data-ports-action="add-in"
            className={BTN_CLS}
            onClick={() => onChange({ ...ports, ins: [...ports.ins, freshId('in', ports.ins)] })}
          >
            ＋入口
          </button>
        </div>
        {ports.ins.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--line-2)] px-2 py-1.5 text-[11px] text-[var(--tx-3)]">
            （触发节点——无入口，可作运行入口）
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {ports.ins.map((p, i) => (
            <div key={`${p}-${i}`} data-ports-in-row={i} className="flex items-center gap-2">
              <input
                value={p}
                onChange={(e) => {
                  const ins = ports.ins.map((v, j) => (j === i ? e.target.value : v));
                  onChange({ ...ports, ins });
                }}
                className={`${INPUT_CLS} max-w-[220px]`}
              />
              <button
                type="button"
                data-ports-remove-in={i}
                className={BTN_CLS}
                onClick={() => onChange({ ...ports, ins: ports.ins.filter((_, j) => j !== i) })}
              >
                删
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--tx-2)]">
            出口 outs（1~N——出口命名即分支语义，≥1）
          </span>
          <button
            type="button"
            data-ports-action="add-out"
            className={BTN_CLS}
            onClick={() => {
              const id = freshId('out', ports.outs.map((o) => o.id));
              onChange({ ...ports, outs: [...ports.outs, { id, label: id }] });
            }}
          >
            ＋出口
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {ports.outs.map((o, i) => (
            <div key={`${o.id}-${i}`} data-ports-out-row={i} className="flex items-center gap-2">
              <input
                data-ports-field="id"
                value={o.id}
                placeholder="出口 id（分支路由键）"
                onChange={(e) => setOut(i, { id: e.target.value })}
                className={`${INPUT_CLS} max-w-[180px]`}
              />
              <input
                data-ports-field="label"
                value={o.label}
                placeholder="展示名（画布标签）"
                onChange={(e) => setOut(i, { label: e.target.value })}
                className={INPUT_CLS}
              />
              <button
                type="button"
                data-ports-remove-out={i}
                className={BTN_CLS}
                onClick={() => onChange({ ...ports, outs: ports.outs.filter((_, j) => j !== i) })}
              >
                删
              </button>
            </div>
          ))}
        </div>
        {errors
          .filter((e) => e.field === 'ports.outs' || e.field.startsWith('ports.outs['))
          .map((e, i) => (
            <div key={i} data-field-error={e.field} data-error-rule={e.rule} className="mt-1 text-[11px] text-[var(--red)]">
              {e.message}
            </div>
          ))}
      </section>
    </div>
  );
}
