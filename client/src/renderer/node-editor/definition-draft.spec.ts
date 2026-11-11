// DefinitionDraft 草稿 store 验收（T6-06；TDD-C-13 §3 DefinitionDraft/EditorShell 行＋§1
// openNodeEditor 接口段；01 §5.3 PATH1（入口/六环节/完整性）＝语义权威）。
//
// 断言面（05 T6-06 验收＝C-13 §6.1a 全字段往返＋§6.1b outs id 重复/type 撞内置子项＋
// 草稿路由 create/edit 两分支＋环节间校验门）：store 层直跑（纯内存——未保存不落盘、
// 不入 02 §3.3 六 store）；实时校验=T4-07 validateDefinition 单一来源（不自造规则——
// 环节门仅 01 §5.3 冻结的「名称必填」与 DSL PK 必填两条 PATH1 表单门，见实现注记）。
import { describe, expect, it, beforeEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import {
  EDITOR_STEPS,
  computeStepErrors,
  isDirty,
  useDefinitionDraftStore,
  type EditorStepKey,
} from './definition-draft';

/** 02 §8.1 示例全形（N1~N8 全维度齐备——validator spec 同源形）§6.1a 往返基线 */
function fullDef(): NodeDefinition {
  return {
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
    inner: ['会话判向 · 历史复放判新来信', '意图识别 · 咨询/售后/骚扰'],
    policy: { timeoutMs: 60000, retries: 2, backoffMs: 2000, onFailure: { type: 'abort' } },
    io: {
      input: { type: 'object', fields: [{ name: 'keywords', type: 'string[]' }] },
      output: { fields: [{ name: 'notes', type: 'object[]', example: '[{title,likes,url}]' }] },
    },
    version: '1.2.0',
    packageVersion: '1.1.0',
  };
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('草稿路由 create/edit 两分支（§1 openNodeEditor）', () => {
  it('create（无 seed）：mode=create、step=meta、kind=custom、source=manual 写入语义位、dirty=false', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const s = useDefinitionDraftStore.getState();
    expect(s.open).toBe(true);
    expect(s.mode).toBe('create');
    expect(s.step).toBe('meta');
    expect(s.draft.kind).toBe('custom');
    expect(s.draft.meta.source).toBe('manual'); // §1 StepMeta 行：source 可编辑态固定 'manual'
    expect(s.seedError).toBe(null);
    expect(isDirty(s)).toBe(false);
  });

  it('edit（seed.type）：经注入 getDefinition 载入既有定义→mode=edit、source 改写 manual、其余逐字段等值', () => {
    const seed = fullDef();
    useDefinitionDraftStore.getState().openNodeEditor(
      { type: 'xhs.search' },
      { getDefinition: (t) => (t === 'xhs.search' ? seed : undefined) },
    );
    const s = useDefinitionDraftStore.getState();
    expect(s.mode).toBe('edit');
    expect(s.draft.type).toBe('xhs.search');
    expect(s.draft.meta).toEqual({ ...seed.meta, source: 'manual' }); // 写入语义位=手动编辑器来源（02 §8.2 upsert 入口）
    expect(s.draft.paramsSchema).toEqual(seed.paramsSchema);
    expect(s.draft.exec).toEqual(seed.exec);
    expect(s.draft.inner).toEqual(seed.inner);
    expect(s.draft.policy).toEqual(seed.policy);
    expect(s.draft.io).toEqual(seed.io);
    expect(s.draft.version).toBe('1.2.0');
    expect(s.draft.packageVersion).toBe('1.1.0');
    expect(isDirty(s)).toBe(false); // 载入即基线（source 改写不计 dirty）
  });

  it('edit 载入 miss（getDefinition 未命中）→ seedError 置位（不静默降级 create）', () => {
    useDefinitionDraftStore.getState().openNodeEditor({ type: 'custom.none' }, { getDefinition: () => undefined });
    const s = useDefinitionDraftStore.getState();
    expect(s.open).toBe(true);
    expect(s.mode).toBe('edit');
    expect(s.seedError).toContain('custom.none');
  });

  it('edit 拒 builtin 定义（PATH1 编辑对象=既有 custom）→ seedError', () => {
    const builtin: NodeDefinition = { ...fullDef(), type: 'ai.llm', kind: 'builtin' };
    useDefinitionDraftStore.getState().openNodeEditor({ type: 'ai.llm' }, { getDefinition: () => builtin });
    expect(useDefinitionDraftStore.getState().seedError).toContain('ai.llm');
  });

  it('closeEditor：open=false（内存草稿随下次 open 重置；未保存不落盘——本模块零持久化 import）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    useDefinitionDraftStore.getState().closeEditor();
    expect(useDefinitionDraftStore.getState().open).toBe(false);
  });
});

describe('环节间校验门（未过门不得前进；回退自由）', () => {
  it('create 初始（名称空）→ meta 门未过：nextStep 不动、goToStep 跳步被拒', () => {
    const st = useDefinitionDraftStore.getState();
    st.openNodeEditor();
    st.patchMeta({ name: '我的节点' }); // 名称已填、type 仍空 → 门仍未过（PK 必填）
    let s = useDefinitionDraftStore.getState();
    s.nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('meta');
    useDefinitionDraftStore.getState().goToStep('ports');
    expect(useDefinitionDraftStore.getState().step).toBe('meta');

    useDefinitionDraftStore.getState().setType('xhs.mine');
    useDefinitionDraftStore.getState().nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('ports');
  });

  it('名称必填=PATH1 环节 1 门（01 §5.3）：错误定位 field=meta.name', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const errors = computeStepErrors(useDefinitionDraftStore.getState().draft);
    const nameErr = errors.meta?.find((e) => e.field === 'meta.name');
    expect(nameErr?.message).toContain('名称');
  });

  it('回退永远自由（save→meta 直跳不受门限制——往返编辑）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: 'n' });
    st.setType('xhs.mine');
    useDefinitionDraftStore.getState().goToStep('save'); // 全门净→跳到底
    expect(useDefinitionDraftStore.getState().step).toBe('save');
    useDefinitionDraftStore.getState().goToStep('meta');
    expect(useDefinitionDraftStore.getState().step).toBe('meta');
  });
});

describe('§6.1b 校验回显（validateDefinition 单一来源→定位到环节+字段）', () => {
  it('outs id 重复 → errors.ports、rule=N2-outs-duplicate、field=ports.outs[1].id；门拦在 ports', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: '双出口' });
    st.setType('xhs.dual');
    st.setPorts({
      ins: ['in'],
      outs: [
        { id: 'hit', label: '命中' },
        { id: 'hit', label: '命中2' },
      ],
    });
    const s = useDefinitionDraftStore.getState();
    const errors = computeStepErrors(s.draft);
    const dup = errors.ports?.find((e) => e.rule === 'N2-outs-duplicate');
    expect(dup?.field).toBe('ports.outs[1].id');
    s.nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('ports'); // meta 门净→可进 ports
    useDefinitionDraftStore.getState().nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('ports'); // ports 门未过（outs 重复）→不得前进
    useDefinitionDraftStore.getState().goToStep('schema');
    expect(useDefinitionDraftStore.getState().step).toBe('ports'); // 跳步同受门拦
  });

  it('type 撞内置（BUILTIN_TYPE_IDS 静态查）→ errors.meta、rule=N1-namespace、field=type', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: '伪装内置' });
    st.setType(BUILTIN_TYPE_IDS[6] as string); // 'ai.llm'
    const errors = computeStepErrors(useDefinitionDraftStore.getState().draft);
    const hit = errors.meta?.find((e) => e.rule === 'N1-namespace');
    expect(hit?.field).toBe('type');
    expect(hit?.message).toContain('ai.llm');
  });

  it('type 撞已注册 custom（ctx.hasType 动态查·双查第二路）→ errors.meta；edit 自身同型不误伤', () => {
    useDefinitionDraftStore.getState().openNodeEditor(undefined, {
      hasType: (t) => t === 'custom.used',
    });
    useDefinitionDraftStore.getState().patchMeta({ name: '撞名' });
    useDefinitionDraftStore.getState().setType('custom.used');
    const collide = computeStepErrors(useDefinitionDraftStore.getState().draft, { hasType: (t) => t === 'custom.used' });
    expect(collide.meta?.some((e) => e.rule === 'N1-namespace' && e.field === 'type')).toBe(true);

    // edit 既有定义：ctx 排除自身——A-11.1 同型覆盖合法（NodeDevAgent 同口径）
    useDefinitionDraftStore.getState().reset();
    useDefinitionDraftStore.getState().openNodeEditor(
      { type: 'custom.used' },
      {
        getDefinition: () => ({ ...fullDef(), type: 'custom.used' }),
        hasType: (t) => t === 'custom.used',
      },
    );
    const self = computeStepErrors(
      useDefinitionDraftStore.getState().draft,
      { hasType: (t) => t === 'custom.used' },
      'custom.used',
    );
    expect(self.meta?.some((e) => e.rule === 'N1-namespace') ?? false).toBe(false);
  });

  it('规则→环节映射全表（N3/N4/N6/N7→script 前诸环节、N8→save——T6-07/08/09 消费位）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: '映射' });
    st.setType('xhs.map');
    const draft: NodeDefinition = {
      ...useDefinitionDraftStore.getState().draft,
      paramsSchema: [{ k: 'x', t: 'colorful' as never }], // N3 白名单外
      exec: { lang: 'go' as never, file: '', entry: '' }, // N4
      policy: { onFailure: { type: 'failBranch', exit: 'nowhere' } }, // N6（挂 StepSchema 高级声明分组）
      io: { outputs: { ghost: { fields: [{ name: 'a', type: 'string' }] } } }, // N7 键⊄outs
      version: '1.0', // N8
    };
    const errors = computeStepErrors(draft);
    expect(errors.schema?.some((e) => e.rule === 'N3-type' && e.field === 'paramsSchema[0].t')).toBe(true);
    expect(errors.script?.some((e) => e.rule === 'N4-exec')).toBe(true);
    expect(errors.schema?.some((e) => e.rule === 'N6-failBranch' && e.field === 'policy.onFailure.exit')).toBe(true);
    expect(errors.schema?.some((e) => e.rule === 'N7-outputs-keys' && e.field === 'io.outputs.ghost')).toBe(true);
    expect(errors.save?.some((e) => e.rule === 'N8-semver' && e.field === 'version')).toBe(true);
  });
});

describe('§6.1a 六环节表单→NodeDefinition 全字段往返保留', () => {
  it('edit 全形定义：六环节逐步走到底（门全净）→各维度逐字段等值（source 除外）；往返再走一遍仍保留', () => {
    const seed = fullDef();
    useDefinitionDraftStore.getState().openNodeEditor(
      { type: 'xhs.search' },
      { getDefinition: () => seed },
    );
    // 六环节顺序推进（create/edit 同门语义）：meta→ports→schema→script→inner→save
    for (const step of EDITOR_STEPS) {
      expect(useDefinitionDraftStore.getState().step).toBe(step);
      useDefinitionDraftStore.getState().nextStep();
    }
    expect(useDefinitionDraftStore.getState().step).toBe('save');
    const after = useDefinitionDraftStore.getState().draft;
    expect({ ...after.meta, source: seed.meta.source }).toEqual(seed.meta); // 仅 source 写入语义位
    expect(after.ports).toEqual(seed.ports);
    expect(after.paramsSchema).toEqual(seed.paramsSchema);
    expect(after.exec).toEqual(seed.exec);
    expect(after.inner).toEqual(seed.inner);
    expect(after.policy).toEqual(seed.policy);
    expect(after.io).toEqual(seed.io);
    expect(after.version).toBe(seed.version);
    expect(after.packageVersion).toBe(seed.packageVersion);

    // 往返：save→meta→save 再走一遍，仍逐字段保留
    useDefinitionDraftStore.getState().goToStep('meta');
    for (const _step of EDITOR_STEPS) {
      void _step;
      useDefinitionDraftStore.getState().nextStep();
    }
    const round2 = useDefinitionDraftStore.getState().draft;
    expect({ ...round2.meta, source: 'ai-forge' }).toEqual(seed.meta);
    expect(round2.paramsSchema).toEqual(seed.paramsSchema);
  });

  it('dirty 位：patchMeta 即脏；改回基线值→净', () => {
    useDefinitionDraftStore.getState().openNodeEditor(
      { type: 'xhs.search' },
      { getDefinition: () => fullDef() },
    );
    expect(isDirty(useDefinitionDraftStore.getState())).toBe(false);
    useDefinitionDraftStore.getState().patchMeta({ name: '改名' });
    expect(isDirty(useDefinitionDraftStore.getState())).toBe(true);
    useDefinitionDraftStore.getState().patchMeta({ name: '搜索采集（滚动翻页）' });
    expect(isDirty(useDefinitionDraftStore.getState())).toBe(false);
  });
});

describe('stepper 结构面', () => {
  it('EDITOR_STEPS 六环节序=PATH1（meta→ports→schema→script→inner→save）', () => {
    expect(EDITOR_STEPS).toEqual<EditorStepKey[]>(['meta', 'ports', 'schema', 'script', 'inner', 'save']);
  });
});

describe('N3/N6/N7 草稿读写面（T6-07 StepSchema 消费——draft.paramsSchema/policy/io）', () => {
  it('setParamsSchema/setPolicy/setIo 直写草稿维度；null 归位（高级声明未启用位）；写入即 dirty', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.setParamsSchema([{ k: 'keywords', t: 'textarea', validate: { minLines: 1 } }]);
    st.setPolicy({ timeoutMs: 0, retries: 2 }); // 0=显式有效值（X-4——非缺省默认 30s）
    st.setIo({ outputs: { out: { fields: [{ name: 'notes', type: 'object[]' }] } } });
    const d = useDefinitionDraftStore.getState().draft;
    expect(d.paramsSchema).toEqual([{ k: 'keywords', t: 'textarea', validate: { minLines: 1 } }]);
    expect(d.policy).toEqual({ timeoutMs: 0, retries: 2 });
    expect(d.io).toEqual({ outputs: { out: { fields: [{ name: 'notes', type: 'object[]' }] } } });
    expect(isDirty(useDefinitionDraftStore.getState())).toBe(true);

    useDefinitionDraftStore.getState().setPolicy(null);
    useDefinitionDraftStore.getState().setIo(null);
    const cleared = useDefinitionDraftStore.getState().draft;
    expect(cleared.policy).toBe(null);
    expect(cleared.io).toBe(null);
  });
});

describe('环节 4 脚本草稿态（T6-08——script.lang/py/ts/configYaml 内存草稿，未保存不落盘）', () => {
  it('create 初始：lang=python（demo 内置脚本 py 主导基线——设计值）、py/ts/configYaml 空文本、不 dirty', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const s = useDefinitionDraftStore.getState();
    expect(s.script).toEqual({ lang: 'python', py: '', ts: '', configYaml: '' });
    expect(isDirty(s)).toBe(false);
  });

  it('patchScript 各字段写入＋dirty；py/ts 双文本各自存续（lang 切换零拷贝零丢失）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    useDefinitionDraftStore.getState().patchScript({ py: 'x = 1' });
    useDefinitionDraftStore.getState().patchScript({ lang: 'ts' }); // 切 ts——py 文本保留
    useDefinitionDraftStore.getState().patchScript({ ts: 'const y = 2;' });
    useDefinitionDraftStore.getState().patchScript({ configYaml: 'node: t\nparams:\n' });
    const s = useDefinitionDraftStore.getState();
    expect(s.script).toEqual({ lang: 'ts', py: 'x = 1', ts: 'const y = 2;', configYaml: 'node: t\nparams:\n' });
    expect(isDirty(s)).toBe(true);
  });

  it('computeStepErrors 第四参：ts 语法错误 → errors.script、rule=N4-syntax、field=script.code、message 含 L<行号>', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const draft = useDefinitionDraftStore.getState().draft;
    const errors = computeStepErrors(draft, undefined, undefined, {
      lang: 'ts',
      py: '',
      ts: 'const a = 1;\nbad(((',
      configYaml: '',
    });
    const hit = errors.script?.filter((e) => e.rule === 'N4-syntax');
    expect(hit?.length).toBeGreaterThan(0);
    expect(hit?.every((e) => e.field === 'script.code')).toBe(true);
    expect(hit?.some((e) => e.message.includes('L2'))).toBe(true); // 第 2 行回指
  });

  it('py 语法错误（T0-04 同构口径）→ errors.script message=「L1 Syntax error」；合法注入物零 script 错', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const draft = useDefinitionDraftStore.getState().draft;
    const bad = computeStepErrors(draft, undefined, undefined, { lang: 'python', py: 'def f(:', ts: '', configYaml: '' });
    expect(bad.script?.some((e) => e.rule === 'N4-syntax' && e.message === 'L1 Syntax error')).toBe(true);

    const ok = computeStepErrors(draft, undefined, undefined, {
      lang: 'python',
      py: 'async def run(ctx):\n    return {"data": ctx.input}\n',
      ts: '',
      configYaml: '',
    });
    expect(ok.script).toBeUndefined(); // 合法＋空 ts 文本（未选中语言不校验）→ 无 script 错
  });

  it('门只看当前选中语言（py 错但 lang=ts → 不拦——保存链只打包当前 lang，T6-09 口径）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: '门语言' });
    st.setType('xhs.lang');
    useDefinitionDraftStore.getState().patchScript({ lang: 'ts', py: 'def f(:', ts: 'const ok = 1;' });
    const errors = computeStepErrors(
      useDefinitionDraftStore.getState().draft,
      undefined,
      undefined,
      useDefinitionDraftStore.getState().script,
    );
    expect(errors.script).toBeUndefined(); // py 未选中——其草稿文本暂存不拦门
  });

  it('语法错误拦 script 环节门：nextStep/goToStep(inner) 被拒；修正后可前进', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const st = useDefinitionDraftStore.getState();
    st.patchMeta({ name: '拦门' });
    st.setType('xhs.gate2');
    useDefinitionDraftStore.getState().patchScript({ py: 'def f(:' });
    useDefinitionDraftStore.getState().goToStep('script'); // 前置门净（meta/ports/schema）——可达
    expect(useDefinitionDraftStore.getState().step).toBe('script');
    useDefinitionDraftStore.getState().nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('script'); // script 门未过——不得前进
    useDefinitionDraftStore.getState().goToStep('save');
    expect(useDefinitionDraftStore.getState().step).toBe('script'); // 跳步同受门拦

    useDefinitionDraftStore.getState().patchScript({ py: 'x = 1\n' });
    useDefinitionDraftStore.getState().nextStep();
    expect(useDefinitionDraftStore.getState().step).toBe('inner'); // 修正后门过
  });

  it('config yaml 不入门错误（§6.1e 警告不拦截——键失配仅 UI 呈现）', () => {
    useDefinitionDraftStore.getState().openNodeEditor();
    const draft = useDefinitionDraftStore.getState().draft;
    const errors = computeStepErrors(draft, undefined, undefined, {
      lang: 'python',
      py: '',
      ts: '',
      configYaml: 'node: x\nparams:\n  ghost: 1\n', // 与 N3 键失配——警告面非门
    });
    expect(errors.script).toBeUndefined();
  });

  it('edit 载入：script 草稿空起（资产文本装载=装配点注入面，随 T6-09 保存链）且不 dirty', () => {
    useDefinitionDraftStore.getState().openNodeEditor(
      { type: 'xhs.search' },
      { getDefinition: () => fullDef() },
    );
    const s = useDefinitionDraftStore.getState();
    expect(s.script).toEqual({ lang: 'python', py: '', ts: '', configYaml: '' });
    expect(isDirty(s)).toBe(false);
  });
});
