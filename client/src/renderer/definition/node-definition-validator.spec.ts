// DefinitionValidator 八条校验器验收（T4-07；C-02 §6.1a/b/c＋§6.5；02 §8.1 校验规则=权威）。
//
// node 直跑（纯函数零框架依赖）；§6.1d（ioView/MA-4 分列）归 T4-09，不在本文件。
// §6.1b「恰对应错误」断言=每例恰一错且 rule/field 定位准确（rule 码表见 ./types.ts）。
// §6.5 单一来源断言=源码扫描（canvas/security-baseline.test.ts 同法）：validateDefinition
// 出现处 ⊆ definition/（本模块目录）＋node-registry/（C-05 装配点——T1-10 侧注入位）。
// 脏数据用例（lang='go' 等）以 as unknown as 构造——zip/AI 入口的定义在类型系统之外。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { DefinitionValidator as C05DefinitionValidator } from '../node-registry/types';
import {
  checkExec,
  checkNamespace,
  checkSemver,
  validateDefinition,
  type FieldError,
} from './index';

/** 02 §8.1 示例形最小化——N1~N8 全维度齐备、各维度取最小合法形态（§6.1a 基线） */
function baseDef(): NodeDefinition {
  return {
    type: 'xhs.search',
    kind: 'custom',
    meta: { name: '搜索采集', icon: '🔎', category: '社媒', source: 'ai-forge' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
    paramsSchema: [
      { k: 'keywords', label: '关键词组', t: 'textarea', required: true, validate: { minLines: 1 } },
    ],
    exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
    inner: null,
    policy: null,
    io: { output: { fields: [{ name: 'notes', type: 'object[]' }] } },
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

/** MA-1 custom.ai-judge 形（01a §2.c 规格表＋02 §9.3 MA-1 行：三出口 hit/miss/unknown、
 * N6 超时 60s/条、重试 0、失败分支=unknown 出口——§6.1c 验收源） */
const AI_JUDGE: NodeDefinition = {
  type: 'custom.ai-judge',
  kind: 'custom',
  meta: { name: 'AI 规则判定', icon: '⚖️', category: 'AI', source: 'ai-forge' },
  ports: {
    ins: ['in'],
    outs: [
      { id: 'hit', label: 'hit' },
      { id: 'miss', label: 'miss' },
      { id: 'unknown', label: 'unknown' },
    ],
  },
  paramsSchema: [
    { k: 'rule', label: '判断规则', t: 'textarea', required: true },
    { k: 'model', t: 'select', opts: ['glm-5', 'deepseek-v4', 'kimi-k2'] },
    { k: 'apiKey', t: 'secret', storage: 'safeStorage' },
    { k: 'withImages', t: 'boolean', default: false },
    { k: 'ruleClass', t: 'text' },
  ],
  exec: { lang: 'python', file: 'scripts/ai_judge.py', entry: 'run' },
  policy: { timeoutMs: 60000, retries: 0, onFailure: { type: 'failBranch', exit: 'unknown' } },
  io: {
    outputs: {
      hit: { fields: [{ name: 'verdicts', type: 'object[]' }] },
      miss: { fields: [{ name: 'verdicts', type: 'object[]' }] },
      unknown: { fields: [{ name: 'verdicts', type: 'object[]' }] },
    },
  },
  version: '1.0.0',
  packageVersion: '1.0.0',
};

/** 恰一错断言（§6.1b 逐条：违例→唯一错误且定位准确） */
function expectSingleError(result: { ok: boolean; errors: FieldError[] }, rule: string, field: string): void {
  expect(result.ok).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.rule).toBe(rule);
  expect(result.errors[0]?.field).toBe(field);
}

describe('§6.1a 最小合法定义通过（02 §8.1 示例形）', () => {
  it('示例形最小化（N1~N8 齐备）→ ok', () => {
    expect(validateDefinition(baseDef())).toEqual({ ok: true, errors: [] });
  });

  it('02 §8.1 示例全形（四类参数＋io.output 与 io.outputs 共存＋inner＋abort＋1.2.0/1.1.0）→ ok', () => {
    const doc: NodeDefinition = {
      type: 'xhs.search',
      kind: 'custom',
      meta: {
        name: '搜索采集（滚动翻页）',
        icon: '🔎',
        category: '社媒',
        color: 'accent',
        description: '搜索页合成填词提交→循环滚动采卡…',
        author: '@yeager',
        source: 'ai-forge',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [
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
      ],
      exec: {
        lang: 'python',
        file: 'scripts/xhs_search.py',
        entry: 'run',
        config: 'config/xhs_search.yaml',
        deps: 'deps/requirements.txt',
      },
      inner: [
        '会话判向 · 历史复放判新来信',
        '意图识别 · 咨询/售后/骚扰',
        '生成回复 · 角色卡 persona',
        '发送登记 · 回声写入会话缓存',
      ],
      policy: { timeoutMs: 60000, retries: 2, backoffMs: 2000, onFailure: { type: 'abort' } },
      io: {
        input: { type: 'object', fields: [{ name: 'keywords', type: 'string[]' }] },
        output: { fields: [{ name: 'notes', type: 'object[]', example: '[{title,likes,url}]' }] },
        outputs: { out: { fields: [{ name: 'notes', type: 'object[]' }] } },
      },
      version: '1.2.0',
      packageVersion: '1.1.0',
    };
    expect(validateDefinition(doc)).toEqual({ ok: true, errors: [] });
  });

  it('exec 可缺＝noScript 判定输入：exec/policy/io/inner 全缺省 → ok（N4/N6/N7 规则不触发）', () => {
    const doc = baseDef();
    doc.exec = null;
    doc.io = null;
    expect(validateDefinition(doc)).toEqual({ ok: true, errors: [] });
  });

  it('N3 白名单 8 类全量通过（text/number/select/textarea/boolean/secret/json/slider）', () => {
    const doc = baseDef();
    doc.paramsSchema = [
      { k: 'a', t: 'text' },
      { k: 'b', t: 'number' },
      { k: 'c', t: 'select', opts: ['x'] },
      { k: 'd', t: 'textarea' },
      { k: 'e', t: 'boolean' },
      { k: 'f', t: 'secret', storage: 'safeStorage' },
      { k: 'g', t: 'json' },
      { k: 'h', t: 'slider', min: 0, max: 10, step: 1 },
    ];
    expect(validateDefinition(doc)).toEqual({ ok: true, errors: [] });
  });
});

describe('§6.1b 八条违例逐条恰对应错误', () => {
  it('#1 N1 custom type 撞内置 12 类（BUILTIN_TYPE_IDS 静态查）→ N1-namespace @ type', () => {
    const doc = { ...baseDef(), type: 'http.request' };
    expectSingleError(validateDefinition(doc), 'N1-namespace', 'type');
  });

  it('#1 N1 ctx.hasType 动态查命中 → 拒；同型无 ctx（C-05 loadAll 单参注入路径）→ ok', () => {
    const doc = baseDef();
    expectSingleError(validateDefinition(doc, { hasType: () => true }), 'N1-namespace', 'type');
    expect(validateDefinition(doc)).toEqual({ ok: true, errors: [] }); // 缺省 ctx=仅静态查
  });

  it('#1 N1 builtin 定义不做命名空间检查（builtin 天然持内置 type）→ ok', () => {
    const doc = { ...baseDef(), type: 'http.request', kind: 'builtin' as const };
    expect(validateDefinition(doc)).toEqual({ ok: true, errors: [] });
  });

  it('#2 N2 outs 空 → N2-outs-empty @ ports.outs', () => {
    const doc = { ...baseDef(), ports: { ins: ['in'], outs: [] } };
    expectSingleError(validateDefinition(doc), 'N2-outs-empty', 'ports.outs');
  });

  it('#2 N2 出口 id 重复 → N2-outs-duplicate @ ports.outs[2].id', () => {
    const doc = {
      ...baseDef(),
      ports: {
        ins: ['in'],
        outs: [
          { id: 'out', label: 'out' },
          { id: 'hit', label: 'hit' },
          { id: 'out', label: 'out' },
        ],
      },
    };
    expectSingleError(validateDefinition(doc), 'N2-outs-duplicate', 'ports.outs[2].id');
  });

  it('#3 N3 t 白名单外 → N3-type @ paramsSchema[1].t', () => {
    const doc = baseDef();
    doc.paramsSchema = [...doc.paramsSchema, { k: 'when', t: 'datetime' }];
    expectSingleError(validateDefinition(doc), 'N3-type', 'paramsSchema[1].t');
  });

  it('#3 N3 validate.regex 非法正则 → N3-validate @ paramsSchema[0].validate.regex', () => {
    const doc = baseDef();
    doc.paramsSchema = [{ k: 'persona', t: 'text', required: true, validate: { regex: '[' } }];
    expectSingleError(validateDefinition(doc), 'N3-validate', 'paramsSchema[0].validate.regex');
  });

  it('#3 N3 validate.min 非数字（运行时脏数据）→ N3-validate @ paramsSchema[0].validate.min', () => {
    const doc = {
      ...baseDef(),
      paramsSchema: [{ k: 'limit', t: 'number', validate: { min: '1' } }],
    } as unknown as NodeDefinition;
    expectSingleError(validateDefinition(doc), 'N3-validate', 'paramsSchema[0].validate.min');
  });

  it('#4 N4 exec.lang 非法（运行时脏数据）→ N4-exec @ exec.lang', () => {
    const doc = {
      ...baseDef(),
      exec: { lang: 'go', file: 'scripts/a.py', entry: 'run' },
    } as unknown as NodeDefinition;
    expectSingleError(validateDefinition(doc), 'N4-exec', 'exec.lang');
  });

  it('#4 N4 file/entry 空 → 两错各定位 exec.file / exec.entry', () => {
    const doc = { ...baseDef(), exec: { lang: 'python' as const, file: '', entry: '' } };
    const result = validateDefinition(doc);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.field).sort()).toEqual(['exec.entry', 'exec.file']);
  });

  it('#5 N6 failBranch exit 不在 outs → N6-failBranch @ policy.onFailure.exit', () => {
    const doc = baseDef();
    doc.policy = { timeoutMs: 60000, retries: 0, onFailure: { type: 'failBranch', exit: 'failed' } };
    expectSingleError(validateDefinition(doc), 'N6-failBranch', 'policy.onFailure.exit');
  });

  it('#6 N7 io.output.fields 项缺 name → N7-output-fields @ io.output.fields[0].name', () => {
    const doc = {
      ...baseDef(),
      io: { output: { fields: [{ type: 'string' }] } },
    } as unknown as NodeDefinition;
    expectSingleError(validateDefinition(doc), 'N7-output-fields', 'io.output.fields[0].name');
  });

  it('#7 N7 io.outputs 键超出 outs → N7-outputs-keys @ io.outputs.halted', () => {
    const doc = baseDef();
    doc.io = { outputs: { halted: { fields: [] } } };
    expectSingleError(validateDefinition(doc), 'N7-outputs-keys', 'io.outputs.halted');
  });

  it('#7 N7 io.outputs per-exit fields 项缺 type → N7-outputs-fields @ io.outputs.out.fields[0].type', () => {
    const doc = {
      ...baseDef(),
      io: { outputs: { out: { fields: [{ name: 'notes' }] } } },
    } as unknown as NodeDefinition;
    expectSingleError(validateDefinition(doc), 'N7-outputs-fields', 'io.outputs.out.fields[0].type');
  });

  it('#8 N8 version 非 semver（缺 PATCH 段）→ N8-semver @ version', () => {
    const doc = { ...baseDef(), version: '1.0' };
    expectSingleError(validateDefinition(doc), 'N8-semver', 'version');
  });

  it('#8 N8 packageVersion 带 v 前缀 → N8-semver @ packageVersion', () => {
    const doc = { ...baseDef(), packageVersion: 'v1.0.0' };
    expectSingleError(validateDefinition(doc), 'N8-semver', 'packageVersion');
  });
});

describe('§6.1c failBranch 命中 outs（MA-1 形）通过', () => {
  it('MA-1 custom.ai-judge：三出口＋failBranch exit=unknown＋重试 0 → ok（具名失败出口不绑定固定出口名）', () => {
    expect(validateDefinition(AI_JUDGE)).toEqual({ ok: true, errors: [] });
  });

  it('负例孪生：exit 换 MA-2 形出口名 halted（不在本节点 outs）→ N6-failBranch 恰一错', () => {
    const doc = {
      ...AI_JUDGE,
      policy: {
        timeoutMs: 60000,
        retries: 0,
        onFailure: { type: 'failBranch' as const, exit: 'halted' },
      },
    };
    expectSingleError(validateDefinition(doc), 'N6-failBranch', 'policy.onFailure.exit');
  });
});

describe('组件级接口（C-02 §3 四组件行）', () => {
  it('checkNamespace(type,ctx)：静态命中→一错；双查均不命中→[]；checkExec(null)＝noScript 判定输入→[]', () => {
    expect(checkNamespace('logic.branch')).toHaveLength(1);
    expect(checkNamespace('xhs.search')).toEqual([]);
    expect(checkNamespace('xhs.search', { hasType: () => true })).toHaveLength(1);
    expect(checkExec(null)).toEqual([]);
    expect(checkSemver('1.0.0')).toBe(true);
    expect(checkSemver('1.0')).toBe(false);
  });

  it('C-05 注入兼容：validateDefinition 可直接赋给 DefinitionValidator（ctx 可选，T1-10 装配点零改动）', () => {
    const injectable: C05DefinitionValidator = validateDefinition;
    expect(injectable(baseDef())).toEqual({ ok: true, errors: [] });
    const bad = { ...baseDef(), ports: { ins: ['in'], outs: [] } };
    expect(injectable(bad).ok).toBe(false);
  });
});

describe('§6.5 单一来源断言（validateDefinition 出现处 ⊆ 本模块目录＋装配点）', () => {
  // 本 spec 位于 renderer/definition/ → '../' ＝ renderer/（URL 解析先剥文件名，security-baseline 同法算级）
  const RENDERER_ROOT = fileURLToPath(new URL('../', import.meta.url));
  // 白名单=合法消费方集合（C-02 §2 ↑被依赖）：definition/（本模块）＋node-registry/（C-05 装载）
  // ＋zip/（T5-07 联动：C-08 导入链 inspect 段逐定义校验——03 C-08 §2 imports ↓ 点名）。
  const ALLOWED_PREFIXES = ['definition/', 'node-registry/', 'zip/'];

  function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('client/src/renderer 内 validateDefinition 只出现于 definition/（本模块）/node-registry/（C-05 装配点）/zip/（C-08 导入链——T5-07 联动）', () => {
    const hits = listTsFiles(RENDERER_ROOT)
      .map((f) => relative(RENDERER_ROOT, f).split(sep).join('/'))
      .filter((rel) => readFileSync(join(RENDERER_ROOT, rel), 'utf8').includes('validateDefinition'));
    expect(hits).toContain('definition/node-definition-validator.spec.ts'); // 守断言非空集
    expect(hits.filter((rel) => rel.startsWith('definition/'))).toContain('definition/definition-validator.ts'); // 实现本体必在
    const stray = hits.filter((rel) => !ALLOWED_PREFIXES.some((p) => rel.startsWith(p)));
    expect(stray).toEqual([]);
  });
});
