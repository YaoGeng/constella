// ContractInjector 验收（T6-08；TDD-C-13 §3 ContractInjector 行「契约模板注入：ts run(ctx) 头
// ＋PARAMS 默认值块、py 同构契约头（与 bundleCode 生成物同构，demo L1027-1050；@flowforge/sdk
// 写法作废，02 §14）」＋05 T6-08 验收「ContractInjector ts/py 快照（含 @constella/sdk 与
// demo 同构头）」）。
//
// 同构断言=全文逐字（spec 内预期模板=demo L1027-1050 同构转录，仅两处作废替换/去除登记于
// 实现头注：L1036 @flowforge/sdk→@constella/sdk〔02 §14 D-10〕；头行「[AI 生成]」尾注去除
// 〔手动定义来源——05 T6-08 卡头形文字〕）。闭环互证：两语言注入物经 check() 零诊断。
import { describe, expect, it } from 'vitest';
import type { ParamField } from '@constella/shared/dsl';
import { inject } from './contract-injector';
import { check } from './syntax-checker';

describe('inject(lang, params) · ts 模板（demo L1034-1040 同构；@constella/sdk，02 §14）', () => {
  it('空 params：全文逐字同构（demo 默认体占位 return { data: ctx.input }）', () => {
    const out = inject('ts', []);
    expect(out).toBe(
      '// scripts/main.ts · 星丛 Constella 节点脚本\n' +
        '// 契约：run(ctx) → { data } 或 { branch: "<出边>" }；ctx = { params, input, browser, llm, im, vault, agent, log, sleep }\n' +
        'import type { NodeCtx, NodeOut } from "@constella/sdk";\n\n' +
        'const PARAMS = {\n\n' +
        '};\n\n' +
        'export async function run(ctx: NodeCtx): Promise<NodeOut> {\n' +
        '  const p = { ...PARAMS, ...(ctx.params || {}) };\n' +
        '  return { data: ctx.input };\n' +
        '}',
    );
    expect(out).not.toContain('@flowforge/sdk'); // demo L1036 写法作废（02 §14 包名冻结）
  });

  it('PARAMS 默认值块来自 N3 ParamField[].default（转义规则同 demo L1030：反斜杠双写、三引号防御、换行→字面 \\n）', () => {
    const params: ParamField[] = [
      { k: 'keywords', t: 'textarea', default: '装修避坑\n全屋定制' },
      { k: 'persona', t: 'text', default: '三引号\'\'\'防御\\反斜杠' },
      { k: 'noDefault', t: 'text' }, // default 缺省 → 空串（demo p.ph??'' 同构）
    ];
    const out = inject('ts', params);
    expect(out).toContain('const PARAMS = {\n  "keywords": "装修避坑\\n全屋定制",\n  "persona": "三引号\'\\防御\\\\反斜杠",\n  "noDefault": ""\n};');
  });

  it('注入物语法干净（check("ts") 零诊断——合法起点闭环）', () => {
    const out = inject('ts', [{ k: 'maxNotes', t: 'number', default: 40 }]);
    expect(check('ts', out)).toEqual([]);
  });

  it('file 可选参替换头行文件名（缺省 scripts/main.ts——type 相关名随 T6-09 保存链 exec.file）', () => {
    const out = inject('ts', [], 'scripts/xhs_search.ts');
    expect(out.startsWith('// scripts/xhs_search.ts · 星丛 Constella 节点脚本\n')).toBe(true);
  });
});

describe('inject(lang, params) · py 模板（demo L1042-1049 同构契约头）', () => {
  it('空 params：全文逐字同构（含 import json, random＋入口注释行＋占位 return）', () => {
    const out = inject('python', []);
    expect(out).toBe(
      '# scripts/main.py · 星丛 Constella 节点脚本\n' +
        '# 契约：run(ctx) → {"data": ...} 或 {"branch": "<出边>"}\n' +
        '# ctx = { params, input, browser, llm, vault, log, sleep }   入口：run\n' +
        'import json, random\n\n' +
        'PARAMS = {\n\n' +
        '}\n\n' +
        'async def run(ctx):\n' +
        '    p = {**PARAMS, **(ctx.params or {})}\n' +
        '    return {"data": ctx.input}\n',
    );
  });

  it('PARAMS 默认值块（demo 转义同规则）＋实例覆盖合并行逐字', () => {
    const out = inject('python', [{ k: 'maxNotes', t: 'number', default: 40 }]);
    expect(out).toContain('PARAMS = {\n  "maxNotes": "40"\n}');
    expect(out).toContain('    p = {**PARAMS, **(ctx.params or {})}');
  });

  it('注入物语法干净（check("python") 零诊断——T0-04 同构闭环）', () => {
    const out = inject('python', [{ k: 'keywords', t: 'textarea', default: 'a\nb' }]);
    expect(check('python', out)).toEqual([]);
  });

  it('file 可选参替换头行文件名（缺省 scripts/main.py）', () => {
    const out = inject('python', [], 'scripts/xhs_search.py');
    expect(out.startsWith('# scripts/xhs_search.py · 星丛 Constella 节点脚本\n')).toBe(true);
  });
});
