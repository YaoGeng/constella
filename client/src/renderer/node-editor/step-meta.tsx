// StepMeta —— 环节 1 元信息表单（T6-06；TDD-C-13 §3 StepMeta 行「N1 全字段，名称必填」；
// 01 §5.3 PATH1 环节 1 GWT＋PRD-CUSTOM-N1）。
//
//   N1 全字段：名称（必填）/类型 id/图标/类目/颜色/描述/作者；source=可编辑态固定 'manual'
// （03 §1「写入语义位」——只读展示，写入归 DefinitionDraft.patchMeta）；kind 恒 custom（✨ 语义）。
//   type 编辑权：create 可改；edit 只读（PK 不可变——A-11.1 同名同型 upsert 对象恒定）。
//   错误回显=环节门错误按 field 前缀挂到对应输入下（meta.name/type）。
import type { ReactNode } from 'react';
import type { NodeMeta } from '@constella/shared/dsl';
import type { StepFieldError } from './definition-draft';

export interface StepMetaProps {
  type: string;
  meta: NodeMeta;
  /** create=true 可改 type；edit=false PK 只读 */
  typeEditable: boolean;
  /** meta 环节门错误（含 N1-namespace/N1-name-required 等） */
  errors: readonly StepFieldError[];
  onTypeChange(type: string): void;
  onMetaChange(patch: Partial<NodeMeta>): void;
}

const INPUT_CLS =
  'w-full rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 text-[13px] text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none read-only:opacity-70';

/** 字段级错误行（field 精确/前缀匹配——type 命中 'type'、名称命中 'meta.name'） */
function FieldErrors({ errors, field }: { errors: readonly StepFieldError[]; field: string }): ReactNode {
  const hits = errors.filter((e) => e.field === field);
  if (hits.length === 0) return null;
  return (
    <div data-field-error={field} className="mt-1 flex flex-col gap-0.5">
      {hits.map((e, i) => (
        <span key={i} data-error-rule={e.rule} className="text-[11px] text-[var(--red)]">
          {e.message}
        </span>
      ))}
    </div>
  );
}

export function StepMeta({ type, meta, typeEditable, errors, onTypeChange, onMetaChange }: StepMetaProps) {
  return (
    <div data-step-form="meta" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
        名称 <span className="text-[var(--red)]">*</span>
        <input
          data-meta-field="name"
          value={meta.name}
          placeholder="如：搜索采集（滚动翻页）"
          onChange={(e) => onMetaChange({ name: e.target.value })}
          className={INPUT_CLS}
        />
        <FieldErrors errors={errors} field="meta.name" />
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
        类型 id（命名空间点分——不得撞内置 12 类）
        <input
          data-meta-field="type"
          value={type}
          readOnly={!typeEditable}
          placeholder={typeEditable ? '如：xhs.search' : ''}
          onChange={(e) => onTypeChange(e.target.value)}
          className={INPUT_CLS}
        />
        <FieldErrors errors={errors} field="type" />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          图标（emoji）
          <input
            data-meta-field="icon"
            value={meta.icon}
            onChange={(e) => onMetaChange({ icon: e.target.value })}
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          类目
          <input
            data-meta-field="category"
            value={meta.category}
            placeholder="如：社媒 / AI / 数据"
            onChange={(e) => onMetaChange({ category: e.target.value })}
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          颜色/主题
          <input
            data-meta-field="color"
            value={meta.color ?? ''}
            placeholder="如：accent"
            onChange={(e) => onMetaChange({ color: e.target.value })}
            className={INPUT_CLS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
        一句话描述
        <input
          data-meta-field="description"
          value={meta.description ?? ''}
          onChange={(e) => onMetaChange({ description: e.target.value })}
          className={INPUT_CLS}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          作者
          <input
            data-meta-field="author"
            value={meta.author ?? ''}
            placeholder="如：@yeager"
            onChange={(e) => onMetaChange({ author: e.target.value })}
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          来源（固定 manual——手动编辑器写入语义位）
          <input data-meta-field="source" data-meta-source="manual" value="manual" readOnly className={INPUT_CLS} />
        </label>
      </div>
    </div>
  );
}
