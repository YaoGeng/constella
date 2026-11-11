// ConfigYamlEditor 自产自析纯函数层验收（T6-08；TDD-C-13 §3 ConfigYamlEditor 行
// 「config/*.yaml 默认值编辑+与 N3 参数键一致性校验」；demo L1051-1056=config yaml 形源）。
//
//   解析设计值（自产自析红线：repo 零 yaml 解析库——client 依赖面无 yaml 面，不引新依赖不装包）：
// 仅认 demo 形三段——首行 # 注释（stringify 重生成）/顶格 `node: <type>` /顶格 `params:` 段
// 下 ≥1 空格缩进的 `<k>: <v>` 行；值一律单行文本（多行值以 ' | ' 扁平化=demo L1054 同构），
// parse 不反向还原（键一致性只消费键集）。其余行宽容忽略（注释/空行/未知顶格键）；
// 无 `params:` 段=形不符（null——§6.1e 警告面）。
import { describe, expect, it } from 'vitest';
import type { ParamField } from '@constella/shared/dsl';
import { configFromSchema, diffConfigKeys, parseConfigYaml, stringifyConfigYaml } from './config-yaml-editor';

const SCHEMA: ParamField[] = [
  { k: 'keywords', t: 'textarea', default: '装修避坑\n全屋定制' },
  { k: 'maxNotes', t: 'number', default: 40 },
  { k: 'apiKey', t: 'secret' }, // 无 default → 空串
];

describe('configFromSchema · demo L1051-1056 同构生成', () => {
  it('形：头注释（config/<type>.yaml·抽屉参数可覆盖）＋node: <type>＋params: 两空格缩进键值', () => {
    const out = configFromSchema('xhs.search', SCHEMA);
    expect(out).toBe(
      '# config/xhs.search.yaml · 节点默认配置（抽屉参数可覆盖）\n' +
        'node: xhs.search\n' +
        'params:\n' +
        '  keywords: 装修避坑 | 全屋定制\n' + // 换行→' | '（demo L1054 同构扁平化）
        '  maxNotes: 40\n' +
        '  apiKey: \n',
    );
  });

  it('空 schema → params: 空段（合法形——零参数节点）', () => {
    const out = configFromSchema('logic.pass', []);
    expect(out).toContain('node: logic.pass\nparams:\n');
  });
});

describe('parseConfigYaml · 自产自析（demo 形三段）', () => {
  it('configFromSchema 产物 parse 回读：node 等值、params 键值等值、键序保留（往返稳定）', () => {
    const text = configFromSchema('xhs.search', SCHEMA);
    const doc = parseConfigYaml(text);
    expect(doc).not.toBe(null);
    expect(doc?.node).toBe('xhs.search');
    expect(doc?.order).toEqual(['keywords', 'maxNotes', 'apiKey']);
    expect(doc?.params['keywords']).toBe('装修避坑 | 全屋定制');
    expect(doc?.params['maxNotes']).toBe('40');
    expect(doc?.params['apiKey']).toBe('');
  });

  it('宽容面：空行/额外注释/未知顶格键忽略；params 段后顶格键收段', () => {
    const doc = parseConfigYaml('# 头注释\n\nnode: xhs.search\nextra: ignored\nparams:\n  a: 1\n# 段内注释\n  b: 2\n');
    expect(doc?.node).toBe('xhs.search');
    expect(doc?.order).toEqual(['a', 'b']);
    expect(doc?.params).toEqual({ a: '1', b: '2' });
  });

  it('形不符：无 params: 段 → null（§6.1e 警告判定输入）', () => {
    expect(parseConfigYaml('# 只有注释\nnode: x\n')).toBe(null);
    expect(parseConfigYaml('')).toBe(null);
  });

  it('stringify：parse→stringify 回写规范形（头注释由 node 重生成——注释行不往返保留，设计值）', () => {
    const text = '# 任意手写注释\nnode: xhs.search\nparams:\n  keywords: a | b\n';
    const round = stringifyConfigYaml(parseConfigYaml(text)!);
    expect(round).toBe('# config/xhs.search.yaml · 节点默认配置（抽屉参数可覆盖）\nnode: xhs.search\nparams:\n  keywords: a | b\n');
  });
});

describe('diffConfigKeys · 与 N3 键一致性（§6.1e——警告不拦截）', () => {
  it('键集一致 → 双空', () => {
    const diff = diffConfigKeys(configFromSchema('xhs.search', SCHEMA), SCHEMA);
    expect(diff).toEqual({ missing: [], extra: [], malformed: false });
  });

  it('yaml 缺 schema 键、多 yaml 键 → missing/extra 各自列出', () => {
    const yaml = 'node: x\nparams:\n  maxNotes: 40\n  ghost: 1\n';
    const diff = diffConfigKeys(yaml, SCHEMA);
    expect(diff.missing).toEqual(['keywords', 'apiKey']); // N3 已定义、yaml 未配置
    expect(diff.extra).toEqual(['ghost']); // yaml 有、N3 未定义
    expect(diff.malformed).toBe(false);
  });

  it('yaml 形不符（无 params: 段）→ malformed=true＋missing=schema 全键（全量失配提示）', () => {
    const diff = diffConfigKeys('node: x\n', SCHEMA);
    expect(diff.malformed).toBe(true);
    expect(diff.missing).toEqual(['keywords', 'maxNotes', 'apiKey']);
    expect(diff.extra).toEqual([]);
  });
});
