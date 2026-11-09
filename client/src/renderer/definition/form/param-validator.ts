// ParamValidator —— N3 参数实例校验（C-02 §3 组件行；T4-08；01 A-17.8＋02 §8.3）。
//
// =§1 NodeDefinitionRuntime.validateParams 单一来源（抽屉保存校验/PlanValidator② 共用——与
// T4-07 validateDefinition 同居 definition/ 模块，消费方不得另立校验源）。纯函数 node 直跑；
// schema 形已由 validateDefinition #3 前置把关（t 白名单＋validate 形），此处只判实例值。
//
// 四类规则（§6.3；每类一个可测违例，错误定位字段 k）：
//   required＝缺值/null/空白串（secret 型引用键空串=未绑定）；
//   regex＝validate.regex 有值且实例为非空文本时不匹配（regex 形已过 #3，此处 try 包编译兜底）；
//   min/max＝validate.min/max 与字段级 min/max（slider）合并生效——validate 优先、缺省回落字段级；
//   minLines＝textarea 有效行数（非空白行计数，「每行一个」语义——自拟细则留痕）不足。
// 自拟项留痕：§1 签名返 FieldError[]，但 T4-07 FieldError.rule 锁定定义级 DefRule 码——实例级
// 违例另立 ParamRule 码，{field,message,rule} 同形（field=ParamField.k）；json 型解析拦截在
// 表单提交层（ParamForm，§6.2），不入本四类规则面。
import type { ParamField } from '@constella/shared/dsl';

/** 实例校验规则定位码（自拟项：四类=§6.3 清单；消费方按码映射 UI 提示） */
export type ParamRule = 'required' | 'regex' | 'min' | 'max' | 'minLines';

/** 实例校验错误（错误定位字段 k：field=ParamField.k） */
export interface ParamFieldError {
  /** 违例参数键（「错误定位字段 k」，01 A-17.8） */
  field: string;
  /** 人读错误信息 */
  message: string;
  /** 规则定位码（见 ParamRule） */
  rule: ParamRule;
}

/** 值缺失判定（undefined/null/全空白文本——空串按缺失，required 承接） */
function isMissing(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** 文本有效行数（非空白行——「每行一个关键词」语义；空行不计） */
function countLines(v: string): number {
  return v.split('\n').filter((line) => line.trim() !== '').length;
}

/**
 * 实例校验（C-02 §1 签名；错误序＝schema 声明序）。
 * 值缺失只报 required 不级联其余规则；regex/min/max/minLines 仅对在场值判定。
 */
export function validateParams(
  schema: ParamField[],
  instance: Record<string, unknown>,
): ParamFieldError[] {
  const errors: ParamFieldError[] = [];
  schema.forEach((p) => {
    const k = p?.k;
    if (typeof k !== 'string' || k === '') return;
    const v = instance[k];

    // ① 必填（02 §8.3：required 校验在抽屉保存时执行）
    if (p.required && isMissing(v)) {
      errors.push({ field: k, message: `「${p.label ?? k}」为必填项`, rule: 'required' });
      return; // 缺值不级联
    }

    // ② 正则（文本类；空值跳过——required 已承接）
    const regex = p.validate?.regex;
    if (regex !== undefined && typeof v === 'string' && v.trim() !== '') {
      try {
        if (!new RegExp(regex).test(v)) {
          errors.push({ field: k, message: `「${p.label ?? k}」不匹配格式要求（/${regex}/）`, rule: 'regex' });
        }
      } catch {
        // regex 形非法已由 validateDefinition #3（N3-validate）拦截——此处不重复报
      }
    }

    // ③ 范围（number/slider；validate.min/max 优先，缺省回落字段级 min/max——slider 02 §8.1 形）
    const num =
      typeof v === 'number'
        ? v
        : typeof v === 'string' && v.trim() !== ''
          ? Number(v)
          : Number.NaN;
    if (Number.isFinite(num)) {
      const min = p.validate?.min ?? p.min;
      const max = p.validate?.max ?? p.max;
      if (min !== undefined && num < min) {
        errors.push({ field: k, message: `「${p.label ?? k}」低于下限 ${min}`, rule: 'min' });
      }
      if (max !== undefined && num > max) {
        errors.push({ field: k, message: `「${p.label ?? k}」超出上限 ${max}`, rule: 'max' });
      }
    }

    // ④ 最少行数（textarea）
    const minLines = p.validate?.minLines;
    if (minLines !== undefined && typeof v === 'string' && v.trim() !== '') {
      if (countLines(v) < minLines) {
        errors.push({
          field: k,
          message: `「${p.label ?? k}」至少 ${minLines} 行（非空行计数）`,
          rule: 'minLines',
        });
      }
    }
  });
  return errors;
}
