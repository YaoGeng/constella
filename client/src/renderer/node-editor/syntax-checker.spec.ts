// SyntaxChecker 验收（T6-08；TDD-C-13 §3 SyntaxChecker 行＋§8① 冻结口径＋§6.1d）。
//
// 断言面（05 T6-08 验收＝「ts 语法错误拒绝+行号、py 语法错误拒绝+行号（T0-04 同构口径）」）：
// ts=typescript 5.9.3 parser（S-1 锁——parseDiagnostics 诊断→1-based 行号＋原生 message）；
// py=@lezer/python@1.1.19（T0-04 决策冻结——error node 偏移→行号＋message 自合成
// 「Syntax error」，C-13 §8①）；两语言错误形统一 SyntaxError[]（line 1-based）。
// 同构闭环：ContractInjector 两语言模板产物须零诊断（合法起点——contract-injector.spec 互证）。
import { describe, expect, it } from 'vitest';
import { check } from './syntax-checker';

describe('check(lang, code) · ts 侧（typescript 5.9.3 parser，S-1 锁）', () => {
  it('类型注解缺型（const x: = 1）→ line=1（1-based）＋parser 原生 message', () => {
    const errs = check('ts', 'const x: = 1');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.line).toBe(1);
    expect(errs[0]?.message).toMatch(/Type expected/);
  });

  it('多行多错（第 2 行括号失衡）→ 行号回指第 2 行', () => {
    const errs = check('ts', 'const a = 1;\nbad(((');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => e.line === 2)).toBe(true);
  });

  it('合法代码（含 import type 与 async 函数——契约模板同形）→ 零诊断', () => {
    const errs = check(
      'ts',
      'import type { NodeCtx, NodeOut } from "@constella/sdk";\n' +
        'const PARAMS = { "k": "v" };\n' +
        'export async function run(ctx: NodeCtx): Promise<NodeOut> {\n' +
        '  const p = { ...PARAMS, ...(ctx.params || {}) };\n' +
        '  return { data: ctx.input };\n' +
        '}\n',
    );
    expect(errs).toEqual([]);
  });

  it('空文本 → 零诊断（空脚本不拦门——noScript 语义归 T6-09 保存链）', () => {
    expect(check('ts', '')).toEqual([]);
  });
});

describe('check(lang, code) · py 侧（@lezer/python@1.1.19，T0-04 冻结口径）', () => {
  it('def 形参括号未闭（def f(:）→ line=1＋message 合成「Syntax error」（C-13 §8①）', () => {
    const errs = check('python', 'def f(:\n    pass\n');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.line).toBe(1);
    expect(errs[0]?.message).toBe('Syntax error');
  });

  it('第 2 行语法错（bad(((）→ 行号回指第 2 行', () => {
    const errs = check('python', 'x = 1\nbad(((');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.every((e) => e.line === 2)).toBe(true);
  });

  it('同行多个 error node 去重（bad((( 三括号=三 error node 同行 → 每行至多一条，设计值）', () => {
    const errs = check('python', 'bad(((');
    expect(errs.length).toBe(1); // 同行去重（§8①「Syntax error」+行号——行级定位粒度）
    expect(errs[0]?.line).toBe(1);
  });

  it('多行多错按行升序（跨行违例各报各的行号）', () => {
    const errs = check('python', 'def f(:\n    pass\nbad(((');
    const lines = errs.map((e) => e.line);
    expect(lines).toContain(1);
    expect(lines).toContain(3);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines); // 行升序
  });

  it('合法代码（契约模板同形——import json, random＋async def run）→ 零诊断', () => {
    const errs = check(
      'python',
      'import json, random\n\n' +
        'PARAMS = {\n  "k": "v"\n}\n\n' +
        'async def run(ctx):\n' +
        '    p = {**PARAMS, **(ctx.params or {})}\n' +
        '    return {"data": ctx.input}\n',
    );
    expect(errs).toEqual([]);
  });

  it('空文本 → 零诊断', () => {
    expect(check('python', '')).toEqual([]);
  });
});
