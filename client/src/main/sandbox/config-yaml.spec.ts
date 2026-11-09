// configYaml 解析/合并用例（T4-16 / TDD-C-M1 §3「configYaml 合并语义」＋02 §14 冻结覆盖序——
// yaml 解析收窄 SandboxExecutor 单点，本规格=该单点的函数面）。
import { describe, expect, it } from 'vitest';
import { IPC_ERROR_CODES } from '@constella/shared/ipc';
import { ConfigYamlError, mergeParams, parseConfigYaml } from './config-yaml';

describe('parseConfigYaml（子集解析——无三方依赖单点）', () => {
  it('平面标量：字符串/数值/布尔/null/引号串', () => {
    expect(
      parseConfigYaml(['label: score', 'factor: 3', 'on: true', 'blank: null', "name: ' quoted # x '", 'url: https://api.example.com/v1'].join('\n')),
    ).toEqual({
      label: 'score',
      factor: 3,
      on: true,
      blank: null,
      name: ' quoted # x ',
      url: 'https://api.example.com/v1',
    });
  });

  it('注释与空行：整行 #、行内尾注释（引号外空白后）忽略', () => {
    expect(
      parseConfigYaml(['# header', 'a: 1  # trailing', '', '  # indented comment', 'b: "x # not comment"'].join('\n')),
    ).toEqual({ a: 1, b: 'x # not comment' });
  });

  it('嵌套 map 与标量序列（缩进表达）', () => {
    expect(
      parseConfigYaml(['top: 1', 'nest:', '  inner: 2', '  deeper:', '    k: v', 'list:', '  - one', '  - 2', '  - true'].join('\n')),
    ).toEqual({ top: 1, nest: { inner: 2, deeper: { k: 'v' } }, list: ['one', 2, true] });
  });

  it('空文本/纯注释 → {}', () => {
    expect(parseConfigYaml('')).toEqual({});
    expect(parseConfigYaml('\n# only comment\n')).toEqual({});
  });

  it('违规形 → CONFIG_YAML_INVALID（裸标量含 : / tab 缩进 / 顶层序列 / 非 key 行 / 流式内联）', () => {
    expect(() => parseConfigYaml('a: b: c')).toThrow(ConfigYamlError);
    expect(() => parseConfigYaml('\ta: 1')).toThrow(ConfigYamlError);
    expect(() => parseConfigYaml('- one\n- two')).toThrow(ConfigYamlError);
    expect(() => parseConfigYaml('just a line')).toThrow(ConfigYamlError);
    expect(() => parseConfigYaml('tags: [a, b]')).toThrow(ConfigYamlError);
  });

  it('错误码已登记 X-01 错误码集（T4-16 🟡 裁决落地＝登记制：code=CONFIG-YAML-INVALID ∈ IPC_ERROR_CODES——yaml 解析错误对用户可操作，不走 INTERNAL）', () => {
    // T4-20 携带登记项 2：裁决采「登记入 X-01 错误码集（shared 最小增补）」
    expect(IPC_ERROR_CODES.CONFIG_YAML_INVALID).toBe('CONFIG-YAML-INVALID');
    let caught: unknown;
    try {
      parseConfigYaml('a: b: c');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigYamlError);
    expect((caught as ConfigYamlError).code).toBe('CONFIG-YAML-INVALID');
  });
});

describe('mergeParams（02 §14 冻结序：config ← 实例 params——实例覆盖 config）', () => {
  it('三层覆盖语义：config 覆盖脚本 PARAMS 默认、实例 params 覆盖 config（PARAMS 半段归脚本作者）', () => {
    const PARAMS = { factor: 2, label: 'score', host: 'a.example' }; // 脚本内置默认（脚本侧展开）
    const configYaml = 'factor: 3\nhost: b.example'; // 包级默认：覆盖 PARAMS 的 factor/host
    const instance = { factor: 5 }; // 抽屉实例：仅覆盖 factor
    const ctxParams = mergeParams(instance, configYaml);
    const merged = { ...PARAMS, ...ctxParams }; // 脚本作者写法（demo L1051-1056 语义）
    expect(merged).toEqual({ factor: 5, label: 'score', host: 'b.example' });
  });

  it('configYaml 缺省 → 实例 params 原样（V1.0 主形态：req 不携 config）', () => {
    expect(mergeParams({ a: 1 })).toEqual({ a: 1 });
  });

  it('实例未覆盖的 config 键保留（config 新增键透传进 ctx.params）', () => {
    expect(mergeParams({ a: 1 }, 'a: 9\nextra: new')).toEqual({ a: 1, extra: 'new' });
  });

  it('非法 configYaml → ConfigYamlError 上抛（spawn 面显式失败，不静默丢弃 config 层）', () => {
    expect(() => mergeParams({}, 'broken: [unclosed')).toThrow(ConfigYamlError);
  });
});
