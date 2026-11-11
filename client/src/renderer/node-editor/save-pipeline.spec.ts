// SavePipeline 套件（T6-09 / TDD-C-13 §3 SavePipeline 行＋§1 saveToLibrary 签名＋§6.1c/§6.1f；
// 05 T6-09 卡「保存链」链序逐环节）。
//
// 断言面（验收冻结；T6-19 口径同步——library 单写去重）：
//   - §6.1c 保存链：同名同型二连保存→register 覆盖不新增（mock Map size 恒 1）＋每次保存
//     register/upsertDefinition/importArchiveBytes 各恰一次（confirm
//     自动放行——用户确认已在保存钮收口，A-10.2 同 T5-03 草稿卡口径）；
//     library.upsert 单写=链内 ImportOrchestrator ⑥段（显式段已去——T6-19 A1 遗留1；
//     「恰一次」观察面从 SavePipelineDeps.libraryUpsert 移至链内段，真链断言归
//     assembly/node-editor-pipeline-contract.spec.ts）；
//   - §6.1f source='manual'：任意入参 source（zip/ai-forge）保存定义恒改写 manual（02 §8.2
//     upsert 四入口之手动编辑器）；
//   - M5（batch-3 转交 1）：保存链只打包当前 lang——未选中语言草稿文本的语法错不拦、不打包
//     （assembler 收到的 script 条目=当前 lang 恰一条）；反向当前 lang 有语法错→保存拒绝
//     （stepErrors.script N4-syntax 行定位）；
//   - 命名空间双查：撞内置→拒（N1-namespace 定位 meta）；edit 态 hasType 撞自身型→放行
//     （A-11.1 同名同型覆盖不误伤）。
//
// 真件面（真 zip 读端/真 C-08 管线/两路径等价）归 assembly/node-editor-pipeline-contract.spec.ts
// （assembly=唯一合法跨模块测试点——本目录受 P-3 grep 约束不能 import workshop）。
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { ImportArchiveOpts, ImportResult } from '../zip/import-orchestrator';
import { validateDefinition } from '../definition';
import { assetsFromScriptDraft, createSavePipeline, type SaveAssets, type SavePackageParts } from './save-pipeline';
import type { SavePipelineDeps } from './save-pipeline';

// ————————————————————————————————————————————
// fixtures
// ————————————————————————————————————————————

/** 手动编辑器合法全件草稿（N1~N8——source 故意给 zip：§6.1f 改写断言面） */
function manualDoc(over: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: 'demo.fetcher',
    kind: 'custom',
    meta: { name: '取数', icon: '🔧', category: '数据', source: 'zip' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '完成' }] },
    paramsSchema: [
      { k: 'query', t: 'text', required: true, default: '咖啡' },
      { k: 'limit', t: 'number', default: 10, min: 1, max: 100 },
    ],
    exec: null,
    policy: null,
    io: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...over,
  };
}

const PY_CODE = 'PARAMS = {"query": "咖啡", "limit": 10}\n\ndef run(ctx):\n    return {"items": []}\n';
const TS_CODE = 'export const PARAMS = { query: "咖啡", limit: 10 };\nexport async function run(ctx) { return { items: [] }; }\n';

interface Harness {
  deps: SavePipelineDeps;
  registered: Map<string, NodeDefinition>;
  upserted: NodeDefinition[];
  importCalls: Array<{ bytes: Uint8Array; opts?: ImportArchiveOpts }>;
  assembled: SavePackageParts[];
}

/** mock 四口＋真 assemble 形记录（zip bytes=桩——真读端 roundtrip/library 单写归 assembly spec） */
function makePipeline(opts: { hasType?: (t: string) => boolean } = {}): Harness & { pipeline: ReturnType<typeof createSavePipeline> } {
  const registered = new Map<string, NodeDefinition>();
  const upserted: NodeDefinition[] = [];
  const importCalls: Harness['importCalls'] = [];
  const assembled: SavePackageParts[] = [];
  const deps: SavePipelineDeps = {
    hasType: opts.hasType ?? ((t) => (BUILTIN_TYPE_IDS as readonly string[]).includes(t)),
    assemble: (parts) => {
      assembled.push(parts);
      return { bytes: new Uint8Array([1, 2, 3]) }; // 桩 bytes（真 zip 归 assembly 真件面）
    },
    register: (doc) => {
      registered.set(doc.type, doc); // Map 同键覆盖=同名同型覆盖语义（A-11.1）
    },
    upsertDefinition: async (doc) => {
      upserted.push(doc);
    },
    importer: {
      importArchiveBytes: async (bytes, callOpts) => {
        importCalls.push({ bytes, opts: callOpts });
        return { nodes: [], noScript: [] } satisfies ImportResult;
      },
    },
  };
  return { pipeline: createSavePipeline(deps), deps, registered, upserted, importCalls, assembled };
}

/** py 主脚本草稿资产（当前 lang=python——config 含内容） */
function pyAssets(): SaveAssets {
  return {
    scripts: { 'scripts/demo_fetcher.py': PY_CODE },
    config: { 'config/demo_fetcher.yaml': 'node: demo.fetcher\nparams:\n  query: 咖啡\n  limit: 10\n' },
  };
}

// ————————————————————————————————————————————
// §6.1c 保存链（各恰一次＋同名同型覆盖）
// ————————————————————————————————————————————

describe('§6.1c 保存链：每次保存 register/upsertDefinition/importArchiveBytes 各恰一次', () => {
  it('library 单写去重（T6-19 A1 遗留1）：params 模板随包（assemble params 层——链内 ⑥段单写数据源）', async () => {
    const h = makePipeline();
    await h.pipeline.saveToLibrary(manualDoc(), pyAssets());
    // deps 已无 libraryUpsert 面（显式段结构性移除——单写=链内 ImportOrchestrator ⑥段；
    // 「每存恰一 op／真库行恰一」断言归 assembly/node-editor-pipeline-contract.spec.ts 真链面）
    expect(h.assembled[0]!.params).toEqual({ query: '咖啡', limit: 10 }); // N3 default 投影随包入链（library params 模板数据源）
  });

  it('保存通过：三口各恰一次＋exec 定型（file/lang/config 指针）', async () => {
    const h = makePipeline();
    const report = await h.pipeline.saveToLibrary(manualDoc(), pyAssets());
    expect(report).toEqual({ ok: true });
    expect(h.registered.size).toBe(1);
    expect(h.upserted).toHaveLength(1);
    expect(h.importCalls).toHaveLength(1);
    // 确认自动放行（保存钮=用户确认收口——A-10.2 不双收）
    expect(await h.importCalls[0]!.opts?.confirm?.({} as never)).toBe(true);
    // exec 定型：assets 唯一脚本条目→ExecSpec（file/entry/config 指针接线）
    const saved = h.registered.get('demo.fetcher')!;
    expect(saved.exec).toEqual({
      lang: 'python',
      file: 'scripts/demo_fetcher.py',
      entry: 'run',
      config: 'config/demo_fetcher.yaml',
    });
  });

  it('同名同型二连保存：均 ok＋register 覆盖不新增（Map size 恒 1——A-11.1）＋每次各恰一次', async () => {
    const h = makePipeline();
    const first = await h.pipeline.saveToLibrary(manualDoc(), pyAssets());
    const second = await h.pipeline.saveToLibrary(manualDoc({ version: '1.0.1' }), pyAssets());
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(h.registered.size).toBe(1); // 覆盖不新增（验收冻结断言）
    expect(h.registered.get('demo.fetcher')!.version).toBe('1.0.1'); // 第二次覆盖生效
    expect(h.upserted).toHaveLength(2); // 二连保存=两次动作各恰一次
    expect(h.importCalls).toHaveLength(2);
  });

  it('edit 态 hasType 撞自身型→放行（排除自身——同名同型覆盖不误伤，A-11.1；create 撞已注册名的拦截在环节门面）', async () => {
    const h = makePipeline({ hasType: () => true }); // 动态查恒 true——保存链排除自身后放行
    expect(await h.pipeline.saveToLibrary(manualDoc(), pyAssets())).toEqual({ ok: true });
    expect(h.importCalls).toHaveLength(1);
  });

  it('撞内置 12 类（ai.llm）→拒（BUILTIN_TYPE_IDS 静态查双保险）＋零写入', async () => {
    const h = makePipeline({ hasType: () => false }); // 动态查恒 false——静态查独拦
    const report = await h.pipeline.saveToLibrary(manualDoc({ type: 'ai.llm' }), pyAssets());
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.stepErrors.meta!.some((e) => e.rule === 'N1-namespace')).toBe(true);
    }
    expect(h.importCalls).toHaveLength(0);
    expect(h.registered.size).toBe(0);
  });
});

// ————————————————————————————————————————————
// §6.1f source='manual'
// ————————————————————————————————————————————

describe('§6.1f source=manual（02 §8.2 upsert 四入口之手动编辑器）', () => {
  it('入参 source=zip→register/upsert/assembler 收到的定义恒 manual', async () => {
    const h = makePipeline();
    await h.pipeline.saveToLibrary(manualDoc(), pyAssets()); // fixture source='zip'
    expect(h.registered.get('demo.fetcher')!.meta.source).toBe('manual');
    expect(h.upserted[0]!.meta.source).toBe('manual');
    expect(h.assembled[0]!.definition.meta.source).toBe('manual');
    expect(h.assembled[0]!.definition.kind).toBe('custom'); // kind 恒 custom（✨ 语义）
  });

  it('入参 source=ai-forge（异源定义误入）→同样改写 manual（保存链语义位单一）', async () => {
    const h = makePipeline();
    await h.pipeline.saveToLibrary(manualDoc({ meta: { name: '取数', icon: '🔧', category: '数据', source: 'ai-forge' } }), pyAssets());
    expect(h.registered.get('demo.fetcher')!.meta.source).toBe('manual');
  });
});

// ————————————————————————————————————————————
// M5（batch-3 转交 1）：保存链只打包当前 lang
// ————————————————————————————————————————————

describe('M5 只打包当前 lang（未选中语言草稿不校验不打包）', () => {
  it('py 草稿含语法错而 lang=ts 且 ts 干净→保存成功＋assembler 恰一 script 条目为 .ts（zip 无 .py）', async () => {
    const h = makePipeline();
    // assetsFromScriptDraft（M5 落位点）：lang=ts→只产 .ts 条目，py 文本（含语法错）不进 assets
    const assets = assetsFromScriptDraft('demo.fetcher', {
      lang: 'ts',
      py: 'def run(ctx)\n  broken(((\n', // 未选中语言——语法错不拦不打包
      ts: TS_CODE,
      configYaml: '',
    });
    expect(assets.scripts).toEqual({ 'scripts/demo_fetcher.ts': TS_CODE });
    expect(assets.config).toEqual({});

    const report = await h.pipeline.saveToLibrary(manualDoc(), assets);
    expect(report).toEqual({ ok: true }); // 保存成功
    // 产物面：恰一 script 条目、.ts 后缀、内容=ts 文本——无 .py（真 zip 读端硬断言归 assembly spec）
    expect(h.assembled[0]!.script).toEqual({ file: 'scripts/demo_fetcher.ts', lang: 'ts', entry: 'run', code: TS_CODE });
    expect(h.assembled[0]!.script!.file.endsWith('.py')).toBe(false);
    expect(h.assembled[0]!.config).toBeUndefined(); // configYaml 空→不产 config 条目
    expect(h.registered.get('demo.fetcher')!.exec).toMatchObject({ lang: 'ts', file: 'scripts/demo_fetcher.ts' });
  });

  it('反向：当前 lang（python）有语法错→保存拒绝（stepErrors.script N4-syntax 行定位）＋零写入', async () => {
    const h = makePipeline();
    const report = await h.pipeline.saveToLibrary(manualDoc(), {
      scripts: { 'scripts/demo_fetcher.py': 'def run(ctx)\n  broken(((\n' },
      config: {},
    });
    expect(report.ok).toBe(false);
    if (!report.ok) {
      const syntax = report.stepErrors.script ?? [];
      expect(syntax.length).toBeGreaterThan(0);
      expect(syntax.every((e) => e.rule === 'N4-syntax' && e.field === 'script.code')).toBe(true);
      expect(syntax.some((e) => /^L\d+ /.test(e.message))).toBe(true); // 行定位形「L<行号> <message>」
    }
    expect(h.importCalls).toHaveLength(0);
    expect(h.registered.size).toBe(0);
  });
});

// ————————————————————————————————————————————
// 保存门其余分支（环节校验汇总＝SaveReport.stepErrors）
// ————————————————————————————————————————————

describe('保存门：validateDefinition 单一来源→stepErrors 环节投影', () => {
  it('N8 semver 坏→stepErrors.save 定位 version 字段', async () => {
    const h = makePipeline();
    const report = await h.pipeline.saveToLibrary(manualDoc({ version: 'v1' }), pyAssets());
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.stepErrors.save!.some((e) => e.rule === 'N8-semver' && e.field === 'version')).toBe(true);
    }
    expect(h.importCalls).toHaveLength(0);
  });

  it('名称空→PATH1 表单门（N1-name-required）定位 meta', async () => {
    const h = makePipeline();
    const report = await h.pipeline.saveToLibrary(manualDoc({ meta: { name: ' ', icon: '🔧', category: '数据', source: 'manual' } }), pyAssets());
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.stepErrors.meta!.some((e) => e.rule === 'N1-name-required')).toBe(true);
    }
  });

  it('当前 lang 文本空→弱节点：exec=null＋assembler 无 script 条目（library scriptMeta 空占位=链内 ⑥段缺省形——真链断言归 assembly contract spec）', async () => {
    const h = makePipeline();
    const report = await h.pipeline.saveToLibrary(manualDoc(), { scripts: { 'scripts/demo_fetcher.py': '' }, config: {} });
    expect(report).toEqual({ ok: true });
    expect(h.registered.get('demo.fetcher')!.exec).toBeNull();
    expect(h.assembled[0]!.script).toBeUndefined();
  });

  it('assets 形违规：多脚本条目/非法后缀/路径穿越→SAVE-ASSETS 响亮拒绝（不静默折叠）', async () => {
    const h = makePipeline();
    await expect(h.pipeline.saveToLibrary(manualDoc(), { scripts: { 'a.py': 'x=1', 'b.ts': 'const x=1' }, config: {} })).rejects.toMatchObject({ code: 'SAVE-ASSETS' });
    await expect(h.pipeline.saveToLibrary(manualDoc(), { scripts: { 'scripts/run.js': 'x' }, config: {} })).rejects.toMatchObject({ code: 'SAVE-ASSETS' });
    await expect(h.pipeline.saveToLibrary(manualDoc(), { scripts: { 'scripts/../evil.py': 'x' }, config: {} })).rejects.toMatchObject({ code: 'SAVE-ASSETS' });
    expect(h.importCalls).toHaveLength(0);
  });

  it('导入链异常→上抛不吞（SAVE-IMPORT 包装——StepSave 呈错误面）', async () => {
    const h = makePipeline();
    (h.deps.importer as { importArchiveBytes: unknown }).importArchiveBytes = async () => {
      throw new Error('ZIP-UNSAFE-ENTRY');
    };
    const err = (await h.pipeline.saveToLibrary(manualDoc(), pyAssets()).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('SAVE-IMPORT');
    expect(err.message).toContain('ZIP-UNSAFE-ENTRY');
    expect(h.registered.size).toBe(1); // ④~⑤ 已执行（链序按卡文——失败不回滚，同值幂等重存即修复；library 单写在链内＝导入失败即未写）
  });
});

// ————————————————————————————————————————————
// assetsFromScriptDraft（M5 适配层——ScriptDraft→SaveAssets）
// ————————————————————————————————————————————

describe('assetsFromScriptDraft（type stem 派生——M4 对齐 C-07 产物布局）', () => {
  it('type 非字母数字段折叠为 _（xhs.search→xhs_search——与 C-07 toDraft 同款派生）', () => {
    const assets = assetsFromScriptDraft('xhs.search', { lang: 'python', py: PY_CODE, ts: '', configYaml: 'node: xhs.search\nparams:\n  query: 咖啡\n' });
    expect(assets.scripts).toEqual({ 'scripts/xhs_search.py': PY_CODE });
    expect(assets.config).toEqual({ 'config/xhs_search.yaml': 'node: xhs.search\nparams:\n  query: 咖啡\n' });
  });

  it('ts 变体：.ts 后缀＋ts 文本；空文本→不产条目（弱节点）', () => {
    const assets = assetsFromScriptDraft('demo.t', { lang: 'ts', py: PY_CODE, ts: TS_CODE, configYaml: '  ' });
    expect(assets.scripts).toEqual({ 'scripts/demo_t.ts': TS_CODE });
    expect(assets.config).toEqual({}); // configYaml 纯空白→不产条目
    const weak = assetsFromScriptDraft('demo.t', { lang: 'ts', py: PY_CODE, ts: '', configYaml: '' });
    expect(weak).toEqual({ scripts: {}, config: {} });
  });
});

// ————————————————————————————————————————————
// 真校验器联跑（C-02 单一来源——保存定义过八条规则）
// ————————————————————————————————————————————

describe('保存定义与 C-02 校验器一致性', () => {
  it('保存成功后的定义经 validateDefinition（无 ctx）零错误', async () => {
    const h = makePipeline();
    await h.pipeline.saveToLibrary(manualDoc(), pyAssets());
    const saved = h.registered.get('demo.fetcher')!;
    expect(validateDefinition(saved)).toEqual({ ok: true, errors: [] });
    expect(saved.inner === undefined || Array.isArray(saved.inner)).toBe(true); // inner 透传不改写
  });
});
