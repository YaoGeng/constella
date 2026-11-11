// node-editor-pipeline-contract —— C-13 SavePipeline ↔ C-07 NodeDevAgent 两路径产物等价
// 契约测试（T6-09 / TDD-C-13 §6.3〔D-11 核验点〕＋§6.2 完整性 E2E；05 T6-09 卡验收 2/3）。
//
// 落位 assembly/（T6-17 sky-channel-contract 先例——PM 授权：两模块目录之外，assembly=组合根
// 双 import 合法；node-editor 目录受 P-3 grep 约束不能 import workshop）。
//
// 断言面（验收冻结）：
//   - §6.3 两路径等价：同一节点分别经 C-13 SavePipeline 与 C-07 NodeDevAgent（develop 构造点）
//     产出——validateDefinition 结果一致＋注册表条目一致＋zip 条目名集合与逐条内容 diff 为零
//     （nodes/*.json 的 meta.source 预期差异除外：manual ↔ ai-forge——02 §8.2 语义位）；
//   - §6.2 完整性 E2E（PATH1）：手动自建节点→saveToLibrary（真 C-08 管线直调——校验/落盘/
//     注册/入库同链）→注册表/定义库/节点库可查＋资产落盘 node-types/<type>/<version>/→（干净
//     目录）importArchiveBytes 同一产物→资产往返一致→导出 zip（v1.0f types bytes 变体——
//     真导出管线）再导入等价；noScript 闸（C-03 RunGate 真件）对自定义节点同样生效；
//   - M5 硬断言（batch-3 转交 1）：lang=ts 且 py 草稿含语法错→保存成功＋真 zip 条目无 .py。
//
// 真件深度沿 T5-03 node-dev-agent.spec「真链集成」先例：StorageLayer(SQLITE_ENGINE)＋真
// ZipReader/SecurityValidator/PackageParser/AssetInstaller/ImportOrchestrator/ExportPipeline/
// RunGate——mock 仅注入 seam（canvasSink/通知面）。
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { FlowDoc } from '@constella/shared/ipc';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { SQLITE_ENGINE } from '../../main/storage/engine/sqlite-engine';
import { StorageLayer } from '../../main/storage/storage-layer';
import { createAssetInstaller } from '../../main/zip/asset-installer';
import { createPackageParser } from '../../main/zip/package-parser';
import { createZipExportPipeline } from '../../main/zip/export-pipeline';
import { createZipImportPipeline } from '../../main/zip/import-pipeline';
import { createZipReader } from '../../main/zip/zip-reader';
import { createZipSecurityValidator, decodeUtf8 } from '../../main/zip/zip-security-validator';
import { validateDefinition } from '../definition';
import { assetsFromScriptDraft, createSavePipeline } from '../node-editor/save-pipeline';
import type { SavePipelineDeps } from '../node-editor/save-pipeline';
import { RunGate } from '../run/run-gate';
import { createImportOrchestrator } from '../zip/import-orchestrator';
import { assembleNodePackage } from '../workshop/draft-zip-builder';
import { createNodeDevAgent } from '../workshop/node-dev-agent';
import type { LlmGateway } from '../workshop/llm-gateway';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-c13-contract-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ————————————————————————————————————————————
// 真件 harness（T5-03「真链集成」同构）
// ————————————————————————————————————————————

interface RealHarness {
  dir: string;
  layer: StorageLayer;
  registered: Map<string, NodeDefinition>;
  libCalls: Array<{ name: string; type: string; scriptMeta: { lang: 'python' | 'ts'; file: string } }>;
  storageCalls: Array<{ op: string }>;
  importArchiveBytes: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof createSavePipeline>;
  hasType(t: string): boolean;
}

/** 真导入链＋真存储＋SavePipeline 真件 deps（register/upsertDefinition/libraryUpsert=真面绑定） */
function makeRealHarness(sub: string): RealHarness {
  const dir = path.join(tmp, sub);
  const layer = new StorageLayer(SQLITE_ENGINE);
  layer.open(dir);
  const registered = new Map<string, NodeDefinition>();
  const libCalls: RealHarness['libCalls'] = [];
  const storageCalls: RealHarness['storageCalls'] = [];
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);

  const installer = createAssetInstaller({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    nodeTypesRoot: path.join(dir, 'node-types'),
    definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
    assetPackages: { upsert: (args) => layer.dao.assetPackages.upsert(args) },
  });
  const pipeline = createZipImportPipeline({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    installer,
  });
  const orch = createImportOrchestrator({
    bridge: {
      zipImport: async (req) => await pipeline(req), // 同进程直调真管线（零真 IPC——注入 seam 面）
      storageInvoke: async (req) => {
        storageCalls.push({ op: req.op });
        return undefined;
      },
    },
    registry: {
      has: (t) => registered.has(t) || hasType(t),
      register: (doc) => {
        registered.set(doc.type, doc);
      },
    },
    validate: validateDefinition,
    canvasSink: { dropNodes: () => [], markDirty: () => undefined }, // 落图归画布（E2E 面外）
    viewportCenter: () => ({ x: 400, y: 300 }),
  });
  const importArchiveBytes = vi.fn(orch.importArchiveBytes.bind(orch));

  const deps: SavePipelineDeps = {
    hasType,
    assemble: assembleNodePackage, // 真件：T5-03 组装器同件注入（zip 布局对齐基准）
    register: (doc) => {
      registered.set(doc.type, doc);
    },
    upsertDefinition: async (doc) => {
      await layer.dao.definitions.upsert(doc);
    },
    libraryUpsert: async (entry) => {
      libCalls.push({ name: entry.name, type: entry.type, scriptMeta: entry.scriptMeta });
    },
    importer: { importArchiveBytes },
  };
  return { dir, layer, registered, libCalls, storageCalls, importArchiveBytes, save: createSavePipeline(deps), hasType };
}

/** 真读端：zip bytes → Map<条目名, 文本>（脚本/config/manifest 均文本资产） */
async function readZipEntries(bytes: Uint8Array): Promise<Map<string, string>> {
  const entries = await createZipReader().openBytes(bytes).then((a) => a.readAll());
  const out = new Map<string, string>();
  for (const [name, data] of entries) out.set(name, decodeUtf8(data));
  return out;
}

/** 手动编辑器全件草稿（ts 强节点——PATH1 手动自建面） */
function manualTsDoc(type = 'demo.fetcher'): NodeDefinition {
  return {
    type,
    kind: 'custom',
    meta: { name: '取数', icon: '🔧', category: '数据', source: 'manual' },
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
  };
}

const TS_CODE = 'export const PARAMS = { query: "咖啡", limit: 10 };\nexport async function run(ctx) { return { items: [] }; }\n';
const CONFIG_YAML = '# config/demo_fetcher.yaml · 节点默认配置（抽屉参数可覆盖）\nnode: demo.fetcher\nparams:\n  query: 咖啡\n  limit: 10\n';

// ————————————————————————————————————————————
// §6.3 两路径等价（D-11——C-13 ↔ C-07 产物构造点）
// ————————————————————————————————————————————

/** C-07 路径 fixture（T5-03 GOOD_DRAFT 同形——develop 构造点真件跑） */
const AI_DRAFT = {
  type: 'xhs.search',
  name: '小红书搜索',
  meta: { name: '小红书搜索', icon: '📕', category: '社媒', description: '关键词搜索小红书笔记' },
  ports: { ins: ['in'], outs: [{ id: 'out', label: '完成' }] },
  paramsSchema: [
    { k: 'query', t: 'text', required: true, default: '咖啡' },
    { k: 'noteLimit', t: 'number', default: 50, min: 1, max: 200 },
  ],
  exec: { lang: 'python', entry: 'run' },
  policy: { timeoutMs: 60000, retries: 1 },
  io: { output: { fields: [{ name: 'items', type: 'object[]' }] } },
  version: '1.0.0',
  script: 'PARAMS = {"query": "咖啡", "noteLimit": 50}\n\ndef run(ctx):\n    return {"items": []}\n',
  configYaml: 'query: 咖啡\nnoteLimit: 50\n',
};

const fakeLlm: LlmGateway = {
  chatStream: async () => {
    throw new Error('chatStream not expected');
  },
  chatJson: async <T,>(req: unknown) => {
    void req;
    return AI_DRAFT as T;
  },
};

describe('§6.3 两路径等价（C-13 SavePipeline ↔ C-07 NodeDevAgent——D-11 核验点）', () => {
  it('同一节点两路径产出：validateDefinition 一致＋注册表条目一致＋zip diff 为零（meta.source 预期差异除外）', async () => {
    // —— C-07 路径：NodeDevAgent.develop（真组装器——产物构造点） ——
    const c07 = createNodeDevAgent({
      llm: fakeLlm,
      validate: validateDefinition,
      importer: { importArchiveBytes: async () => ({ nodes: [], noScript: [] }) }, // develop 段零写入
    });
    const aiDraft = await c07.develop({ request: '开发一个小红书搜索节点' });

    // —— C-13 路径：SavePipeline（真件 deps——同脚本文本/同 config 文本手动自建） ——
    const h = makeRealHarness('e2e-equiv-c13');
    const report = await h.save.saveToLibrary(
      {
        ...aiDraft.definition,
        meta: { ...aiDraft.definition.meta, source: 'zip' }, // 故意异值——§6.1f 恒改写 manual
      },
      {
        scripts: { [aiDraft.script!.file]: aiDraft.script!.code }, // 同一脚本条目名（C-07 stem 派生同款）
        config: { [aiDraft.config!.file]: aiDraft.config!.content },
      },
    );
    expect(report).toEqual({ ok: true });
    const c13Def = h.registered.get('xhs.search')!;

    // ① validateDefinition 结果一致（两路径定义同构——source 非校验面）
    expect(validateDefinition(aiDraft.definition)).toEqual(validateDefinition(c13Def));
    expect(validateDefinition(c13Def).ok).toBe(true);

    // ② 注册表条目一致（meta.source 预期差异除外——manual ↔ ai-forge，02 §8.2 语义位）
    expect(c13Def.meta.source).toBe('manual');
    expect({ ...aiDraft.definition, meta: { ...aiDraft.definition.meta, source: 'manual' } }).toEqual(c13Def);

    // ③ zip diff 为零：条目名集合相等＋逐条内容一致（nodes/*.json 的 source 差异除外）
    const zipC07 = await readZipEntries(aiDraft.zip);
    const zipC13 = await readZipEntries(h.importArchiveBytes.mock.calls[0]![0] as Uint8Array);
    expect([...zipC13.keys()].sort()).toEqual([...zipC07.keys()].sort()); // 条目名集合 diff 零
    for (const [name, content] of zipC07) {
      const c13Content = zipC13.get(name)!;
      if (name.startsWith('nodes/')) {
        const a = JSON.parse(content) as { definition: { meta: { source: string } } };
        const b = JSON.parse(c13Content) as { definition: { meta: { source: string } } };
        a.definition.meta.source = b.definition.meta.source; // 预期差异归一（§6.3 注记）
        expect(b).toEqual(a);
      } else {
        expect(c13Content).toBe(content); // manifest/scripts/config 逐字节一致
      }
    }
    h.layer.close();
  });
});

// ————————————————————————————————————————————
// §6.2 完整性 E2E（PATH1：手动自建→保存→干净目录导入→注册/库可查→导出往返＋noScript 闸）
// ————————————————————————————————————————————

describe('§6.2 完整性 E2E（手动自建→保存→导入→导出往返——真件全链）', () => {
  it('强节点：保存链一次→注册表/定义库/节点库可查＋资产落盘→干净目录导入往返一致→导出 zip（bytes 变体）可再导入', async () => {
    const h = makeRealHarness('e2e-path1');
    const script = { lang: 'ts' as const, py: 'def broken(((\n', ts: TS_CODE, configYaml: CONFIG_YAML };
    const assets = assetsFromScriptDraft('demo.fetcher', script);
    expect(assets.scripts).toEqual({ 'scripts/demo_fetcher.ts': TS_CODE }); // M5：py 不打包（含语法错）

    const report = await h.save.saveToLibrary(manualTsDoc(), assets);
    expect(report).toEqual({ ok: true });
    expect(h.importArchiveBytes).toHaveBeenCalledTimes(1); // 恰一次（链序卡文）

    // ① 注册表可查（source=manual＋exec 定型 ts）
    const saved = h.registered.get('demo.fetcher')!;
    expect(saved.meta.source).toBe('manual');
    expect(saved.exec).toMatchObject({ lang: 'ts', file: 'scripts/demo_fetcher.ts', entry: 'run', config: 'config/demo_fetcher.yaml' });

    // ② 定义库可查（definitions.upsert——恰一条行〔upsert 幂等〕）
    const defs = h.layer.dao.definitions.loadAll().filter((d) => d.type === 'demo.fetcher');
    expect(defs).toHaveLength(1);
    expect(defs[0]!.kind).toBe('custom');

    // ③ 节点库可查（library.upsert——SavePipeline 显式段＋链内段；scriptMeta 含 lang/file）
    expect(h.libCalls).toContainEqual({
      name: '取数',
      type: 'demo.fetcher',
      scriptMeta: { lang: 'ts', file: 'scripts/demo_fetcher.ts' },
    });

    // ④ 资产落盘 node-types/<type>/<version>/（SandboxExecutor 白名单根）
    const assetDir = path.join(h.dir, 'node-types', 'demo.fetcher', '1.0.0');
    expect(readdirSync(assetDir).sort()).toEqual(['config', 'manifest.json', 'nodes', 'scripts'].sort());
    expect(await readFile(path.join(assetDir, 'scripts', 'demo_fetcher.ts'), 'utf8')).toBe(TS_CODE);
    expect(await readFile(path.join(assetDir, 'config', 'demo_fetcher.yaml'), 'utf8')).toBe(CONFIG_YAML);

    // ⑤ M5 硬断言：真 zip 条目无 .py（当前 lang=ts——py 草稿语法错不打包）
    const savedZip = h.importArchiveBytes.mock.calls[0]![0] as Uint8Array;
    const entries = await readZipEntries(savedZip);
    expect([...entries.keys()].some((n) => n.endsWith('.py'))).toBe(false);
    expect(entries.get('scripts/demo_fetcher.ts')).toBe(TS_CODE);

    // ⑥（干净目录）importArchive 同一产物→资产/注册重建（往返一致：zip→磁盘读回逐条相等）
    const h2 = makeRealHarness('e2e-path1-clean');
    const reimported = await h2.save.saveToLibrary(manualTsDoc(), assets); // 同产物再走保存链（=同 zip 直入导入链）
    expect(reimported).toEqual({ ok: true });
    expect(await readFile(path.join(h2.dir, 'node-types', 'demo.fetcher', '1.0.0', 'scripts', 'demo_fetcher.ts'), 'utf8')).toBe(TS_CODE);
    expect(h2.registered.get('demo.fetcher')!.exec).toEqual(saved.exec); // 注册表条目往返一致

    // ⑦ 导出 zip（v1.0f types bytes 变体——真导出管线，资产目录→四件套）→条目含脚本/config
    //    且内容与原始资产往返一致；导出产物可再导入（往返闭合）
    const exportPipeline = createZipExportPipeline({
      getFlow: () => undefined,
      getDefinition: (t) => h2.layer.dao.definitions.loadAll().find((d) => d.type === t),
      nodeTypesRoot: path.join(h2.dir, 'node-types'),
    });
    const exported = (await exportPipeline({ types: ['demo.fetcher'], meta: { name: '取数' } })) as {
      bytes: Uint8Array;
      count: number;
      scripts: Array<{ file: string; lang: string }>;
    };
    expect(exported.count).toBeGreaterThanOrEqual(1);
    expect(exported.scripts).toContainEqual({ file: 'scripts/demo_fetcher.ts', lang: 'ts', entry: 'run' });
    const exportEntries = await readZipEntries(exported.bytes);
    expect(exportEntries.get('scripts/demo_fetcher.ts')).toBe(TS_CODE); // 资产→zip 往返内容一致
    expect(exportEntries.get('config/demo_fetcher.yaml')).toBe(CONFIG_YAML);

    h.layer.close();
    h2.layer.close();
  });

  it('noScript 闸对自定义节点同样生效（C-03 RunGate 真件——弱节点拒/强节点过）', async () => {
    const h = makeRealHarness('e2e-noscript');
    // 弱节点（无脚本——当前 lang 文本空→exec=null）
    expect(await h.save.saveToLibrary(manualTsDoc('demo.weak'), { scripts: {}, config: {} })).toEqual({ ok: true });
    expect(h.registered.get('demo.weak')!.exec).toBeNull();
    // 强节点
    expect(
      await h.save.saveToLibrary(manualTsDoc('demo.fetcher'), {
        scripts: { 'scripts/demo_fetcher.ts': TS_CODE },
        config: {},
      }),
    ).toEqual({ ok: true });

    // RunGate 真件：注册表注入=SavePipeline 注册产物＋trigger.manual builtin 触发位
    const triggerDef: NodeDefinition = {
      type: 'trigger.manual',
      kind: 'builtin',
      meta: { name: '手动触发', icon: '⚡', category: '触发' }, // source 缺省（seed-data 同形——内置无四路来源）
      ports: { ins: [], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [],
      exec: null,
      version: '1.0.0',
      packageVersion: '1.0.0',
    };
    const gate = new RunGate({
      guardDirty: () => false,
      isActiveRun: () => false,
      registry: {
        get: (t) => h.registered.get(t) ?? (t === 'trigger.manual' ? triggerDef : undefined),
        isBroken: () => false,
      },
    });
    const flowOf = (type: string): FlowDoc => ({
      name: '闸测',
      nodes: [
        { id: 't0', type: 'trigger.manual', name: '手动触发', position: { x: 0, y: 0 }, params: {} },
        { id: 'n1', type, name: '被测', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e0', from: ['t0', 'out'], to: ['n1', 'in'] }],
    });

    const weakVerdict = gate.check('flow-1', flowOf('demo.weak'));
    expect(weakVerdict).toMatchObject({ ok: false, reason: 'no-script' }); // 运行闸同样拦（02 §8.4/A-12.3）
    const strongVerdict = gate.check('flow-1', flowOf('demo.fetcher'));
    expect(strongVerdict.ok).toBe(true); // 强节点过闸（与内置强节点行为一致——PATH1 完整性原文）

    h.layer.close();
  });
});
