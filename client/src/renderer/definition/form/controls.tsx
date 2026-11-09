// shadcn copy-in 手工基线控件（T4-08；02 §8.3 t→shadcn 八类映射的控件半段）。
//
// D-9 拍板=copy-in 源码模式；本卡不跑 shadcn CLI（无人值守红线，05 T3-01 留痕同源）——
// 五件基础控件按 new-york 形手工落位：结构/props 面向后续 CLI add 产物可平替（§8 替换点①
// CONTROL_COMPONENTS 整表换件零改消费方）。样式=tailwind 工具类＋玻璃主题 CSS 变量
// （styles/tailwind.css :root——不触碰共享样式文件，类名稳定供映射快照）。
// 无 Radix 依赖（不引新依赖红线）：Switch=button[role=switch]（WAI-ARIA 形）、Select=原生
// select、Slider=原生 input[type=range]——jsdom 可测，装配面与 shadcn 组件 props 同构。
import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { ParamFieldModel } from './param-form-model';
import type { SecretParamBinder } from './secret-param-binder';

/** 控件公共 props（kind→控件表统一签名——整表换件的前提） */
export interface ControlProps {
  /** 字段渲染模型（renderParamForm 产物：值/掩码/选项/范围投影） */
  field: ParamFieldModel;
  /** label 关联 id */
  id: string;
  /** 值提交（json 型经 JSON.parse 拦截后到达；secret 型只提交引用键） */
  onChange?: (v: unknown) => void;
  /** secret 写通道绑定器（装配点注入；缺省=secret 控件只读掩码，输入不落库） */
  secretBinder?: SecretParamBinder;
  /** json 解析错误上报（k 定位错误展示槽；null=清除） */
  onParseError?: (msg: string | null) => void;
}

/** 输入基类（玻璃主题：边框/底色/焦点描边） */
const INPUT_CLS =
  'h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 py-1 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)]';
const MONO_CLS = 'font-mono';

/** text → Input */
export function InputControl({ field, id, onChange }: ControlProps) {
  return (
    <input
      id={id}
      data-control="input"
      className={cn(INPUT_CLS, field.mono && MONO_CLS)}
      placeholder={field.ph}
      value={String(field.value ?? '')}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

/** number → Input[type=number]（提交数字；清空提交空串由 required 承接） */
export function NumberControl({ field, id, onChange }: ControlProps) {
  const raw = field.value === undefined || field.value === null ? '' : String(field.value);
  return (
    <input
      id={id}
      type="number"
      data-control="input-number"
      className={INPUT_CLS}
      placeholder={field.ph}
      value={raw}
      onChange={(e) => onChange?.(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}

/** select → Select（V1 静态 opts；运行时数据源=G-1 vNext） */
export function SelectControl({ field, id, onChange }: ControlProps) {
  return (
    <select
      id={id}
      data-control="select"
      className={cn(INPUT_CLS, 'appearance-none')}
      value={String(field.value ?? '')}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {(field.opts ?? []).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** textarea → Textarea */
export function TextareaControl({ field, id, onChange }: ControlProps) {
  return (
    <textarea
      id={id}
      data-control="textarea"
      rows={3}
      className={cn(INPUT_CLS, 'h-auto py-2', field.mono && MONO_CLS)}
      placeholder={field.ph}
      value={field.value === undefined || field.value === null ? '' : String(field.value)}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

/** boolean → Switch（button[role=switch]＋aria-checked；点击翻转提交） */
export function SwitchControl({ field, id, onChange }: ControlProps) {
  const on = field.value === true;
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on}
      data-control="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        on ? 'border-[var(--accent-line)] bg-[var(--accent-tint)]' : 'border-[var(--line-2)] bg-transparent',
      )}
      onClick={() => onChange?.(!on)}
    >
      <span
        aria-hidden
        className={cn(
          'ml-0.5 block h-3.5 w-3.5 rounded-full transition-transform',
          on ? 'translate-x-4 bg-[var(--accent)]' : 'translate-x-0 bg-[var(--tx-3)]',
        )}
      />
    </button>
  );
}

/** secret → Input(type=password 掩码)：回显=掩码 sk-***；输入明文失焦经 binder 写通道，
 * onChange 只收引用键（params JSON 零明文——SecretParamBinder 语义）。无 binder=只读掩码。 */
export function SecretControl({ field, id, onChange, secretBinder }: ControlProps) {
  const [draft, setDraft] = useState('');
  const masked = field.masked ?? '';

  const commit = async (): Promise<void> => {
    if (draft === '' || secretBinder === undefined) return;
    const refKey = await secretBinder.saveSecret(field.k, draft);
    setDraft('');
    onChange?.(refKey);
  };

  return (
    <input
      id={id}
      type="password"
      autoComplete="off"
      data-control="input-password"
      className={INPUT_CLS}
      placeholder={field.ph ?? '输入新密钥，保存后掩码回显'}
      value={draft !== '' ? draft : masked}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
    />
  );
}

/** json → Textarea＋提交 JSON.parse 校验（§6.2③：非法拦截——onChange 不触发、错误定位 k 展示；
 * 合法提交解析后的对象；清空提交空串由 required 承接）。编辑态=本地草稿（非法输入不回弹）。 */
export function JsonControl({ field, id, onChange, onParseError }: ControlProps) {
  const [draft, setDraft] = useState(
    field.value === undefined || field.value === null ? '' : String(field.value),
  );

  const handleChange = (raw: string): void => {
    setDraft(raw);
    if (raw.trim() === '') {
      onParseError?.(null);
      onChange?.('');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      onParseError?.(null);
      onChange?.(parsed);
    } catch (err) {
      onParseError?.(`JSON 非法：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <textarea
      id={id}
      data-control="textarea-json"
      rows={3}
      className={cn(INPUT_CLS, 'h-auto py-2 font-mono')}
      placeholder={field.ph}
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
}

/** slider → Slider（原生 range；min/max/step 投影，提交数字） */
export function SliderControl({ field, id, onChange }: ControlProps) {
  const num =
    typeof field.value === 'number'
      ? field.value
      : typeof field.value === 'string' && field.value.trim() !== ''
        ? Number(field.value)
        : (field.min ?? 0);
  return (
    <input
      id={id}
      type="range"
      data-control="slider"
      className="w-full accent-[var(--accent)]"
      min={field.min}
      max={field.max}
      step={field.step}
      value={Number.isFinite(num) ? num : (field.min ?? 0)}
      onChange={(e) => onChange?.(Number(e.target.value))}
    />
  );
}
