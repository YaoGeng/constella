// ParamValidator 验收（T4-08；C-02 §6.3＋§1 validateParams 行；01 A-17.8＋02 §8.3）。
//
// node 直跑（纯函数零框架依赖）；四类实例校验（必填缺失/regex 不匹配/超 min-max/minLines）
// → 错误定位字段 k（ParamFieldError.field=参数键）。§1 签名返回 FieldError[]——T4-07 的
// FieldError.rule 锁定八条定义级规则码（DefRule），实例级违例另立 ParamRule 码（自拟项留痕
// 见 ./param-validator.ts 头注），{field,message,rule} 同形——消费方按 field/k 定位展示。
// 另含「T4-07 评审备注补例」：validateDefinition 的 io fields 非数组分支直接用例。
import { describe, expect, it } from 'vitest';
import type { ParamField } from '@constella/shared/dsl';
import { validateDefinition } from '../index';
import { validateParams, type ParamFieldError } from './param-validator';

/** 02 §8.1 示例形参数 schema（四类参数：textarea/secret/number/slider） */
function exampleSchema(): ParamField[] {
  return [
    {
      k: 'keywords',
      label: '关键词组（每行一个）',
      t: 'textarea',
      default: '装修避坑\n全屋定制',
      required: true,
      group: '采集',
      help: '每行一个关键词',
      validate: { minLines: 1 },
    },
    { k: 'apiKey', t: 'secret', storage: 'safeStorage' },
    { k: 'maxNotes', t: 'number', default: 40, validate: { min: 1, max: 500 } },
    { k: 'ratio', t: 'slider', min: 10, max: 100, step: 10, default: 100 },
  ];
}

/** 恰一错断言（§6.3「定位字段 k」：唯一错误且 k/rule 定位准确） */
function expectK(errors: ParamFieldError[], k: string, rule: string): void {
  expect(errors).toHaveLength(1);
  expect(errors[0]?.field).toBe(k);
  expect(errors[0]?.rule).toBe(rule);
}

describe('§6.3 ParamValidator 实例校验——四类违例定位字段 k', () => {
  it('合法实例（02 §8.1 示例值）→ 零错误', () => {
    const errors = validateParams(exampleSchema(), {
      keywords: '装修避坑\n全屋定制',
      apiKey: 'secret.param.n1.apiKey',
      maxNotes: 40,
      ratio: 100,
    });
    expect(errors).toEqual([]);
  });

  it('① 必填缺失（值缺/空串/空白串）→ rule required', () => {
    expectK(validateParams(exampleSchema(), { maxNotes: 40, ratio: 100 }), 'keywords', 'required');
    expectK(validateParams(exampleSchema(), { keywords: '', maxNotes: 40, ratio: 100 }), 'keywords', 'required');
    expectK(validateParams(exampleSchema(), { keywords: '   ', maxNotes: 40, ratio: 100 }), 'keywords', 'required');
  });

  it('① 必填缺失不级联（缺值时不再报 minLines 等）→ 恰一错', () => {
    // keywords 同时声明 required＋minLines:1——缺值只报 required（§6.3 逐类恰对应）
    const errors = validateParams(exampleSchema(), {});
    expectK(errors, 'keywords', 'required');
  });

  it('① secret 型必填＝引用键空串即未绑定 → required', () => {
    const schema: ParamField[] = [{ k: 'apiKey', t: 'secret', required: true }];
    expectK(validateParams(schema, { apiKey: '' }), 'apiKey', 'required');
    expect(validateParams(schema, { apiKey: 'secret.param.n1.apiKey' })).toEqual([]);
  });

  it('② regex 不匹配 → rule regex；匹配通过', () => {
    const schema: ParamField[] = [
      { k: 'phone', t: 'text', validate: { regex: '^1\\d{10}$' } },
    ];
    expectK(validateParams(schema, { phone: '12345' }), 'phone', 'regex');
    expect(validateParams(schema, { phone: '13800138000' })).toEqual([]);
  });

  it('③ 超 min-max（number：validate.min/max）→ rule min / max', () => {
    const schema: ParamField[] = [{ k: 'maxNotes', t: 'number', validate: { min: 1, max: 500 } }];
    expectK(validateParams(schema, { maxNotes: 0 }), 'maxNotes', 'min');
    expectK(validateParams(schema, { maxNotes: 900 }), 'maxNotes', 'max');
    expect(validateParams(schema, { maxNotes: 40 })).toEqual([]);
  });

  it('③ 超 min-max（slider：字段级 min/max，无 validate 声明）→ rule min / max', () => {
    const schema: ParamField[] = [{ k: 'ratio', t: 'slider', min: 10, max: 100, step: 10 }];
    expectK(validateParams(schema, { ratio: 5 }), 'ratio', 'min');
    expectK(validateParams(schema, { ratio: 200 }), 'ratio', 'max');
    expect(validateParams(schema, { ratio: 100 })).toEqual([]);
  });

  it('④ minLines（textarea）不足 → rule minLines', () => {
    const schema: ParamField[] = [{ k: 'keywords', t: 'textarea', validate: { minLines: 2 } }];
    expectK(validateParams(schema, { keywords: '只有一行' }), 'keywords', 'minLines');
    expect(validateParams(schema, { keywords: '第一行\n第二行' })).toEqual([]);
    // 空行不计行（「每行一个」语义，自拟细则见实现头注）
    expectK(validateParams(schema, { keywords: '第一行\n \n' }), 'keywords', 'minLines');
  });

  it('json 型实例值不在四类规则面（合法 JSON 对象 → 零错误）', () => {
    const schema: ParamField[] = [{ k: 'config', t: 'json' }];
    expect(validateParams(schema, { config: { a: 1 } })).toEqual([]);
  });

  it('多字段违例 → 错误序＝schema 声明序', () => {
    const schema: ParamField[] = [
      { k: 'keywords', t: 'textarea', required: true },
      { k: 'maxNotes', t: 'number', validate: { min: 1 } },
    ];
    const errors = validateParams(schema, { maxNotes: 0 });
    expect(errors.map((e) => e.field)).toEqual(['keywords', 'maxNotes']);
    expect(errors.map((e) => e.rule)).toEqual(['required', 'min']);
  });
});

describe('T4-07 评审备注补例：validateDefinition 的 io fields 非数组分支', () => {
  // T4-07 实现有 checkFields 的 !Array.isArray 报错分支但无直接用例——本组补例（T4-08 携带移交项）。
  it('io.output.fields 非数组 → 恰一错 N7-output-fields 定位 io.output.fields', () => {
    const doc = {
      type: 'x.a',
      kind: 'custom',
      meta: { name: 'a', icon: '🔧', category: '数据' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [],
      exec: null,
      io: { output: { fields: 'oops' } }, // fields 非数组（脏数据以 as never 构造于下）
      version: '1.0.0',
      packageVersion: '1.0.0',
    } as never;
    const result = validateDefinition(doc);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rule).toBe('N7-output-fields');
    expect(result.errors[0]?.field).toBe('io.output.fields');
    expect(result.errors[0]?.message).toContain('须为数组');
  });

  it('io.outputs.<exit>.fields 非数组 → 恰一错 N7-outputs-fields 定位 io.outputs.<exit>.fields', () => {
    const doc = {
      type: 'x.b',
      kind: 'custom',
      meta: { name: 'b', icon: '🔧', category: '数据' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [],
      exec: null,
      io: { outputs: { out: { fields: null } } },
      version: '1.0.0',
      packageVersion: '1.0.0',
    } as never;
    const result = validateDefinition(doc);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rule).toBe('N7-outputs-fields');
    expect(result.errors[0]?.field).toBe('io.outputs.out.fields');
  });
});
