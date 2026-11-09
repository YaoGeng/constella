// ParamForm —— schema 驱动参数表单组件（C-02 §3 ParamFormRenderer 组件行；T4-08；02 §8.3）。
//
// 复用处：C-01 抽屉（内容区接线随 T4-09 收口——本卡只交付组件）、C-13 预览、C-07 草稿卡。
// 数据流：schema＋value → renderParamForm 模型（t→控件映射/默认值回填/掩码/分组）→ 按
// CONTROL_COMPONENTS 渲染；字段变更经 onChange(k,v) 上抛（json 非法拦截在控件层、secret 明文
// 经 binder 写通道后只上抛引用键）；保存校验（validateParams）由宿主执行、结果经 errors 注入
// ——错误定位字段 k 展示（01 A-17.8）。UI 零业务规则（P-3）。
import { useMemo, useState, type ComponentType } from 'react';
import { cn } from '../../lib/utils';
import type { ParamField } from '@constella/shared/dsl';
import type { ParamFieldError } from './param-validator';
import type { FormControlKind, ParamFieldModel, ParamValues } from './param-form-model';
import { renderParamForm } from './param-form-model';
import type { SecretParamBinder } from './secret-param-binder';
import {
  InputControl,
  JsonControl,
  NumberControl,
  SecretControl,
  SelectControl,
  SliderControl,
  SwitchControl,
  TextareaControl,
  type ControlProps,
} from './controls';

export interface ParamFormProps {
  /** N3 参数 schema（已过 validateDefinition #3 前置把关） */
  schema: ParamField[];
  /** 实例参数值（secret 字段=引用键；默认值回填在模型层） */
  value: ParamValues;
  /** 字段提交（k 定位；json 型=解析后对象、secret 型=引用键） */
  onChange?: (k: string, v: unknown) => void;
  /** validateParams 结果注入（抽屉保存校验——错误定位字段 k 展示） */
  errors?: ParamFieldError[];
  /** secret 写通道绑定器（装配点注入；缺省=secret 控件只读掩码） */
  secretBinder?: SecretParamBinder;
}

/** §8 替换点①：kind→控件映射表（换 UI 库/升级 shadcn CLI add 产物=整表换件零改消费方） */
const CONTROL_COMPONENTS: Record<FormControlKind, ComponentType<ControlProps>> = {
  input: InputControl,
  'input-number': NumberControl,
  select: SelectControl,
  textarea: TextareaControl,
  switch: SwitchControl,
  'input-password': SecretControl,
  'textarea-json': JsonControl,
  slider: SliderControl,
};

export function ParamForm({ schema, value, onChange, errors, secretBinder }: ParamFormProps) {
  const model = useMemo(() => renderParamForm(schema, value), [schema, value]);
  // json 解析错误（控件层拦截上报）优先于注入错误展示——同槽单条（k 定位）
  const [parseErrors, setParseErrors] = useState<Record<string, string>>({});

  const errorOf = (k: string): string | undefined =>
    parseErrors[k] ?? errors?.find((e) => e.field === k)?.message;

  const renderField = (f: ParamFieldModel) => {
    const Control = CONTROL_COMPONENTS[f.control];
    const id = `cn-param-${f.k}`;
    return (
      <div key={f.k} className="flex flex-col gap-1.5" data-param-k={f.k}>
        <label htmlFor={id} className="text-xs text-[var(--tx-2)]">
          {f.label}
        </label>
        <Control
          field={f}
          id={id}
          onChange={(v) => onChange?.(f.k, v)}
          secretBinder={secretBinder}
          onParseError={
            f.control === 'textarea-json'
              ? (msg) =>
                  setParseErrors((prev) => {
                    if (msg === null) {
                      const { [f.k]: _drop, ...rest } = prev;
                      return rest;
                    }
                    return { ...prev, [f.k]: msg };
                  })
              : undefined
          }
        />
        {f.help !== undefined && (
          <div className="text-[10.5px] leading-relaxed text-[var(--tx-3)]" data-param-help-k={f.k}>
            {f.help}
          </div>
        )}
        {errorOf(f.k) !== undefined && (
          <div
            role="alert"
            className="text-[11px] text-[var(--red)]"
            data-param-error-k={f.k}
          >
            {errorOf(f.k)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-param-form>
      {model.ungrouped.map(renderField)}
      {model.groups.map((g) => (
        <fieldset
          key={g.name}
          data-param-group={g.name}
          className={cn('rounded-lg border border-[var(--line)] px-3 pb-3 pt-1')}
        >
          <legend className="px-1 text-xs text-[var(--tx-2)]">{g.name}</legend>
          <div className="flex flex-col gap-3">{g.fields.map(renderField)}</div>
        </fieldset>
      ))}
    </div>
  );
}
