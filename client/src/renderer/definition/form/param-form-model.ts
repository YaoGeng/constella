// ParamFormRenderer 模型面 —— renderParamForm（C-02 §1 签名/§3 组件行；T4-08；02 §8.3 映射冻结）。
//
// t→shadcn 组件映射的模型半段：t → FormControlKind（02 §8.3 冻结表——text→Input、number→
// Input[type=number]、select→Select、textarea→Textarea、boolean→Switch、secret→Input(type=
// password 掩码)、json→Textarea＋JSON.parse 校验、slider→Slider）；组件半段（kind→React 控件）
// 在 ./ParamForm.tsx 的 CONTROL_COMPONENTS（§8 替换点①：换 UI 库整表换件零改消费方）。
// 类型系统开放可扩展（02 §8.1）：新类型=registerParamControl 注册映射（schema 不破——
// X-01 ParamType 开放联合；定义侧白名单随锚升表，未注册类型渲染回退 text 基线）。
//
// 自拟项留痕：§1 签名的 ParamValues 未在 X-01 定义——本文件取 ParamValues=Record<string,unknown>
// （与 validateParams instance 形一致）；ParamFormModel 形=§4「纯渲染模型（字段 k/控件类型/
// 校验态）」落位——校验态经 errors 注入组件层，模型面承载字段 k/控件类型/值投影/分组。
import type { ParamField, ParamValidate } from '@constella/shared/dsl';
import { SECRET_MASK } from './secret-param-binder';

/** 实例参数值形（节点 params JSON——secret 字段=引用键，零明文） */
export type ParamValues = Record<string, unknown>;

/** 控件形态码（02 §8.3 冻结映射表——shadcn 组件行的模型侧判定面） */
export type FormControlKind =
  | 'input' // text → Input
  | 'input-number' // number → Input[type=number]
  | 'select' // select → Select
  | 'textarea' // textarea → Textarea
  | 'switch' // boolean → Switch
  | 'input-password' // secret → Input(type=password 掩码)
  | 'textarea-json' // json → Textarea＋提交 JSON.parse 校验
  | 'slider'; // slider → Slider

/** 字段渲染模型（§4 纯渲染模型：字段 k/控件类型/值投影——校验态在组件层注入） */
export interface ParamFieldModel {
  /** 参数键（错误定位/提交定位） */
  k: string;
  /** 标签（label 缺省回退 k） */
  label: string;
  /** 控件形态（02 §8.3 映射） */
  control: FormControlKind;
  /** 分组（undefined=散字段） */
  group?: string;
  help?: string;
  ph?: string;
  mono?: boolean;
  /** 值投影（实例值优先，缺省回填 default——覆盖序见 X-01 params 注释） */
  value: unknown;
  /** secret 型掩码（sk-***；未绑定=空串；非 secret 型=undefined） */
  masked?: string;
  /** select 静态选项（V1 静态；G-1 optsFrom=vNext） */
  opts?: string[];
  /** slider 范围与步进投影 */
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  validate?: ParamValidate;
}

/** 具名分组（首现序；02 §8.3 `group` 字段 Fieldset/Group 分组渲染） */
export interface ParamFormGroup {
  name: string;
  fields: ParamFieldModel[];
}

/** 表单渲染模型（§1 renderParamForm 返回形） */
export interface ParamFormModel {
  /** 平铺全字段（声明序——校验态注入/PlanValidator 消费面） */
  fields: ParamFieldModel[];
  /** 无 group 散字段（声明序；空=全字段有分组） */
  ungrouped: ParamFieldModel[];
  /** 具名分组（首现序） */
  groups: ParamFormGroup[];
}

/** t→控件映射注册表（§8 替换点①模型侧；V1 冻结 8 类预置——02 §8.3 表逐行） */
const CONTROL_REGISTRY = new Map<string, FormControlKind>([
  ['text', 'input'],
  ['number', 'input-number'],
  ['select', 'select'],
  ['textarea', 'textarea'],
  ['boolean', 'switch'],
  ['secret', 'input-password'],
  ['json', 'textarea-json'],
  ['slider', 'slider'],
]);

/** 组件注册面（02 §8.1「新类型=注册新 renderer 映射」）：注册/覆盖 t→控件映射 */
export function registerParamControl(t: string, kind: FormControlKind): void {
  CONTROL_REGISTRY.set(t, kind);
}

/**
 * schema 驱动表单模型（C-02 §1 签名；t→shadcn 映射＋分组/默认值/help；secret 型=掩码＋引用键
 * ——masked 只在值=非空引用键时给 sk-***，明文永不入模型值）。
 */
export function renderParamForm(schema: ParamField[], value: ParamValues): ParamFormModel {
  const fields: ParamFieldModel[] = schema.map((p) => {
    const v = value[p.k];
    return {
      k: p.k,
      label: p.label ?? p.k,
      control: CONTROL_REGISTRY.get(p.t) ?? 'input',
      group: p.group,
      help: p.help,
      ph: p.ph,
      mono: p.mono,
      value: v === undefined ? p.default : v,
      masked: p.t === 'secret' ? (typeof v === 'string' && v !== '' ? SECRET_MASK : '') : undefined,
      opts: p.opts,
      min: p.min,
      max: p.max,
      step: p.step,
      required: p.required,
      validate: p.validate,
    };
  });

  const ungrouped = fields.filter((f) => f.group === undefined);
  const groups: ParamFormGroup[] = [];
  for (const f of fields) {
    if (f.group === undefined) continue;
    let g = groups.find((x) => x.name === f.group);
    if (g === undefined) {
      g = { name: f.group, fields: [] };
      groups.push(g);
    }
    g.fields.push(f);
  }
  return { fields, ungrouped, groups };
}
