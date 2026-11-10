// NodeDevAgent 套件（T5-03 / TDD-C-07 §3 NodeDevAgent 行＋§1 六环节 3 段；02 §9.1「现场开发
// 生成物」＝N1~N8 定义＋scripts（run(ctx) 契约＋PARAMS 默认值表）＋config/*.yaml＋deps 声明
// →组装 zip→C-08 同一导入链「开发即沉淀」；v1.0e 对齐注＝内存 zip bytes 直入
// importArchiveBytes——03 L1101）。
//
// 断言面（验收冻结）：
//   - develop 段：LLM 生成→草稿自检（C-02 validateDefinition 单一来源——失败草稿卡报错不组装）
//     →store 组装器→NodeDraft（zip bytes/manifest/试跑元数据）；
//   - adopt 段：**adopt 前零写入**（importer 零调用）＋确认后 **importArchiveBytes 恰一次**
//     ＋链内注册/入库＋视口中心落节点（WaterfallPlacer 首项锚定＝demo L2438-2440 语义）
//     ＋定位闪烁/开抽屉（注入回调）＋markDirty；
//   - 真链集成：组装器 roundtrip 经真 SecurityValidator/ZipReader/PackageParser/AssetInstaller
//     （importArchiveBytes 全链——真 C-08 main 管线同进程直调，mock 仅 LLM 面）；
//   - B-5 试跑：**只有已确认安装的 node-types 资产可被加载（02 §12.2#3 冻结）**——试跑=
//     adopted 草稿资产路径 spawnScript 直调（lang 字面量 'py'|'ts'——02 §3.4 与 N4 'python'
//     不同源）＋事件回显（run:scriptEvent 订阅经注入，按 nodeRunId 过滤）。
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { ImportedNode, ScriptEvent, SpawnScriptReq, SpawnScriptRes, StorageInvokeReq } from '@constella/shared/ipc';
import { SQLITE_ENGINE } from '../../main/storage/engine/sqlite-engine';
import { StorageLayer } from '../../main/storage/storage-layer';
import { splitNodeRunId } from '../../main/sandbox'; // C-03 对端形断言（splitNodeRunId——每次 spawn 必经）
import { createAssetInstaller } from '../../main/zip/asset-installer';
import { createPackageParser } from '../../main/zip/package-parser';
import { createZipImportPipeline } from '../../main/zip/import-pipeline';
import { createZipReader } from '../../main/zip/zip-reader';
import { createZipSecurityValidator, decodeUtf8 } from '../../main/zip/zip-security-validator';
import { validateDefinition } from '../definition';
import {
  createImportOrchestrator,
  type ImportArchiveOpts,
  type ImportCanvasSink,
  type ImportSummary,
} from '../zip/import-orchestrator';
import { createConfirmGate } from './confirm-gate';
import type { LlmChatRequest, LlmGateway } from './llm-gateway';
import {
  NodeDevAgentError,
  createNodeDevAgent,
  type AdoptDraftResult,
  type NodeDevAgentDeps,
  type NodeDraft,
} from './node-dev-agent';
import { useWorkshopStore } from './workshop-store';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-node-dev-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ————————————————————————————————————————————
// fixtures：LLM 草稿（N1~N8＋script＋config＋deps 全件）
// ————————————————————————————————————————————

const GOOD_DRAFT = {
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
  deps: 'requests>=2.0',
};

/** LLM 假面（chatJson 定值＋请求记录——C-07 §6 验收惯例：LLM 经注入 fake transport） */
function fakeLlm(draft: unknown, opts: { failWith?: Error } = {}) {
  const requests: LlmChatRequest[] = [];
  const llm: LlmGateway = {
    chatStream: async () => {
      throw new Error('chatStream not expected in develop');
    },
    chatJson: async <T,>(req: LlmChatRequest): Promise<T> => {
      requests.push(req);
      if (opts.failWith !== undefined) throw opts.failWith;
      return draft as T;
    },
  };
  return { llm, requests };
}

/** adopt 面假导入链（真链集成另用真管线 harness） */
interface MockImportCall {
  bytes: Uint8Array;
  opts?: ImportArchiveOpts;
}

function importedNode(over: Partial<ImportedNode> = {}): ImportedNode {
  return { id: 'n-imp-1', type: 'xhs.search', name: '小红书搜索', position: { x: 304, y: 270 }, params: { query: '咖啡' }, ...over };
}

interface AgentHarness {
  deps: NodeDevAgentDeps;
  importCalls: MockImportCall[];
  located: string[];
  opened: string[];
  spawnReqs: SpawnScriptReq[];
  /** LLM chatJson 请求记录（develop 调用形断言面） */
  requests: LlmChatRequest[];
}

function makeAgent(llmDraft: unknown, opts: { importResult?: { nodes: ImportedNode[]; noScript: string[] } } = {}): AgentHarness & { agent: ReturnType<typeof createNodeDevAgent> } {
  const { llm, requests } = fakeLlm(llmDraft);
  const importCalls: MockImportCall[] = [];
  const located: string[] = [];
  const opened: string[] = [];
  const spawnReqs: SpawnScriptReq[] = [];
  const deps: NodeDevAgentDeps = {
    llm,
    validate: vi.fn(validateDefinition), // C-02 单一来源（T4-07）——真校验器注入
    hasType: (t) => (BUILTIN_TYPE_IDS as readonly string[]).includes(t),
    importer: {
      importArchiveBytes: async (bytes, callOpts) => {
        importCalls.push({ bytes, opts: callOpts });
        return opts.importResult ?? { nodes: [importedNode()], noScript: [] };
      },
    },
    locateNode: (nodeId) => located.push(nodeId),
    openDrawer: (nodeId) => opened.push(nodeId),
    spawnScript: async (req) => {
      spawnReqs.push(req);
      return { ok: true, pid: 4321 } satisfies SpawnScriptRes;
    },
  };
  return { agent: createNodeDevAgent(deps), deps, importCalls, located, opened, spawnReqs, requests };
}

// ————————————————————————————————————————————
// §3 develop(spec)：LLM 生成→草稿自检→组装→NodeDraft
// ———————————————————————————————————————————

describe('develop-生成（N1~N8＋scripts＋config＋deps→zip 组装→NodeDraft）', () => {
  it('全件草稿：定义定形（kind=custom/source=ai-forge/exec.file 合成）＋zip 四件套＋manifest', async () => {
    const { agent, requests } = makeAgent(GOOD_DRAFT);
    const draft = await agent.develop({ request: '开发一个小红书搜索节点' });

    // LLM 调用形：system 提示词含 run(ctx) 契约＋PARAMS 默认值表；user 携带原句
    expect(requests).toHaveLength(1);
    const system = requests[0]!.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).toContain('run(ctx)');
    expect(system.content).toContain('PARAMS');
    expect(requests[0]!.messages[1]!.content).toContain('小红书搜索');

    // NodeDraft 定形（自带 id——T5-04 建议）
    expect(draft.id).toMatch(/^draft-/);
    expect(draft.type).toBe('xhs.search');
    expect(draft.name).toBe('小红书搜索');
    expect(draft.params).toEqual({});
    // 定义：N1 meta.source=ai-forge（02 §8.2 四路来源）；N4 exec.file 按型合成；config/deps 指针接线
    expect(draft.definition.kind).toBe('custom');
    expect(draft.definition.meta.source).toBe('ai-forge');
    expect(draft.definition.meta.icon).toBe('📕');
    expect(draft.definition.exec).toMatchObject({
      lang: 'python',
      file: 'scripts/xhs_search.py',
      entry: 'run',
      config: 'config/xhs_search.yaml',
      deps: 'deps/requirements.txt',
    });
    expect(draft.definition.policy).toEqual({ timeoutMs: 60000, retries: 1 });
    expect(draft.script).toMatchObject({ file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' });
    expect(draft.script!.code).toContain('def run(ctx)');
    expect(draft.config).toEqual({ file: 'config/xhs_search.yaml', content: GOOD_DRAFT.configYaml });
    expect(draft.deps).toEqual({ file: 'deps/requirements.txt', content: 'requests>=2.0' });
    // manifest（四件套清单面）
    expect(draft.manifest).toEqual({
      kind: 'node',
      name: '小红书搜索',
      version: '1.0.0',
      scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
    });
    // zip 可经真读端还原（roundtrip 详断言归 draft-zip-builder.spec；此处验内容面）
    const entriesMap = await createZipReader().openBytes(draft.zip).then((a) => a.readAll());
    expect(decodeUtf8(entriesMap.get('scripts/xhs_search.py')!)).toBe(GOOD_DRAFT.script);
    expect(JSON.parse(decodeUtf8(entriesMap.get('manifest.json')!))).toEqual(draft.manifest);
    // 定义本身过 C-02（草稿已自检——草稿卡「已通过自检」面）
    expect(validateDefinition(draft.definition)).toEqual({ ok: true, errors: [] });
  });

  it('develop 前后零写入：importer 零调用（生成段不触导入链——确认前零写入 A-10.2）', async () => {
    const { agent, importCalls } = makeAgent(GOOD_DRAFT);
    await agent.develop({ request: '开发一个节点' });
    expect(importCalls).toHaveLength(0);
  });

  it('spec 定型覆盖：规划缺口步骤带 type/name/params（spec.type 权威——LLM type 不采）', async () => {
    const { agent } = makeAgent({ ...GOOD_DRAFT, type: 'llm.wild.type' });
    const draft = await agent.develop({
      request: '缺一个取数步骤',
      type: 'demo.fetcher',
      name: '取数',
      params: { query: '猫' },
    });
    expect(draft.type).toBe('demo.fetcher');
    expect(draft.name).toBe('取数');
    expect(draft.params).toEqual({ query: '猫' });
    // nodes/*.json 携带实例参数预填层（落节点/入库随链消费）
    const entriesMap = await createZipReader().openBytes(draft.zip).then((a) => a.readAll());
    const nodeEntry = JSON.parse(decodeUtf8(entriesMap.get('nodes/取数.json')!)) as Record<string, unknown>;
    expect(nodeEntry.params).toEqual({ query: '猫' });
  });

  it('ts 变体：exec.lang=ts→.ts 后缀＋deps/package.json＋manifest lang=ts', async () => {
    const tsDraft = {
      ...GOOD_DRAFT,
      exec: { lang: 'ts', entry: 'run' },
      script: 'export const PARAMS = { query: "咖啡" };\nexport async function run(ctx) { return { items: [] }; }\n',
      deps: '{"dependencies":{}}',
    };
    const { agent } = makeAgent(tsDraft);
    const draft = await agent.develop({ request: '开发一个 ts 节点' });
    expect(draft.definition.exec).toMatchObject({ lang: 'ts', file: 'scripts/xhs_search.ts', entry: 'run', deps: 'deps/package.json' });
    expect(draft.manifest.scripts).toEqual({ 'xhs.search': { file: 'scripts/xhs_search.ts', lang: 'ts', entry: 'run' } });
  });

  it('弱节点（无 exec 无 script）：exec=null＋manifest 无 scripts 键（noScript 判定输入不虚报）', async () => {
    const weak = { ...GOOD_DRAFT };
    delete (weak as Record<string, unknown>).exec;
    delete (weak as Record<string, unknown>).script;
    const { agent } = makeAgent(weak);
    const draft = await agent.develop({ request: '开发一个纯数据节点' });
    expect(draft.definition.exec).toBeNull();
    expect(draft.manifest.scripts).toBeUndefined();
    expect(draft.script).toBeUndefined();
  });

  it('草稿自检未过（C-02 单一来源）：ports.outs 空→DEV-VALIDATE 逐条带 field/rule——不组装不上抛静默', async () => {
    const { agent, importCalls } = makeAgent({ ...GOOD_DRAFT, ports: { ins: [], outs: [] } });
    const err = await agent.develop({ request: '开发一个节点' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NodeDevAgentError);
    const e = err as NodeDevAgentError;
    expect(e.code).toBe('DEV-VALIDATE');
    expect(e.errors!.some((x) => x.field === 'ports.outs')).toBe(true); // N2 逐条列卡（草稿卡报错面）
    expect(importCalls).toHaveLength(0); // 未组装未导入
  });

  it('草稿自检未过：撞内置命名空间（type=data.transform）→N1 拒——不静默改名（02 §12.4）', async () => {
    const { agent } = makeAgent({ ...GOOD_DRAFT, type: 'data.transform' });
    const err = (await agent.develop({ request: '开发一个节点' }).catch((e: unknown) => e)) as NodeDevAgentError;
    expect(err.code).toBe('DEV-VALIDATE');
    expect(err.errors!.some((x) => x.field === 'type')).toBe(true);
  });

  it('草稿自检未过：paramsSchema t 出白名单→N3-type 逐条', async () => {
    const bad = { ...GOOD_DRAFT, paramsSchema: [{ k: 'color', t: 'color' }] };
    const { agent } = makeAgent(bad);
    const err = (await agent.develop({ request: '开发一个节点' }).catch((e: unknown) => e)) as NodeDevAgentError;
    expect(err.code).toBe('DEV-VALIDATE');
    expect(err.errors!.some((x) => x.field === 'paramsSchema[0].t')).toBe(true);
  });

  it('LLM lang 非枚举（js）→DEV-LLM-DRAFT 响亮拒绝——不静默折叠 python（构造性合法 C-02 抓不到，错误语言打包）', async () => {
    const { agent } = makeAgent({ ...GOOD_DRAFT, exec: { lang: 'js', entry: 'run' } });
    const err = (await agent.develop({ request: '开发一个节点' }).catch((e: unknown) => e)) as NodeDevAgentError;
    expect(err.code).toBe('DEV-LLM-DRAFT');
    expect(err.message).toContain('exec.lang');
  });

  it('LLM 可控条目名路径攻击面（exec.file ../ 穿越／deps.file 绝对路径）→develop 段即拒（错误前移——不待 adopt 后 ZIP-UNSAFE-ENTRY）', async () => {
    const traversal = makeAgent({ ...GOOD_DRAFT, exec: { lang: 'python', entry: 'run', file: 'scripts/../../evil.py' } });
    await expect(traversal.agent.develop({ request: 'x' })).rejects.toMatchObject({ code: 'DEV-LLM-DRAFT' });

    const absDeps = makeAgent({ ...GOOD_DRAFT, deps: { file: 'C:\\evil\\requirements.txt', content: 'requests' } });
    const err = (await absDeps.agent.develop({ request: 'x' }).catch((e: unknown) => e)) as NodeDevAgentError;
    expect(err.code).toBe('DEV-LLM-DRAFT');
    expect(err.message).toContain('deps.file');
    expect(traversal.importCalls).toHaveLength(0); // 草稿段即拒——零导入
  });

  it('LLM 草稿结构不可用→DEV-LLM-DRAFT 响亮报错（缺 type/缺 ports/缺 paramsSchema.k/exec 缺 script）', async () => {
    const noType = makeAgent({ ...GOOD_DRAFT, type: '' });
    await expect(noType.agent.develop({ request: 'x' })).rejects.toMatchObject({ code: 'DEV-LLM-DRAFT' });

    const noPorts = makeAgent((({ ports: _, ...rest }) => rest)(GOOD_DRAFT));
    await expect(noPorts.agent.develop({ request: 'x' })).rejects.toMatchObject({ code: 'DEV-LLM-DRAFT' });

    const noK = makeAgent({ ...GOOD_DRAFT, paramsSchema: [{ t: 'text' }] });
    await expect(noK.agent.develop({ request: 'x' })).rejects.toMatchObject({ code: 'DEV-LLM-DRAFT' });

    const noScript = makeAgent((({ script: _, ...rest }) => rest)(GOOD_DRAFT)); // 声明 exec 但缺 script 源码
    await expect(noScript.agent.develop({ request: 'x' })).rejects.toMatchObject({ code: 'DEV-LLM-DRAFT' });
  });

  it('LLM 生成失败上抛挂卡（02 §9.2 兜底链限意图面——生成段不兜底不吞）', async () => {
    const boom = new Error('LLM 输出无法收敛为 JSON');
    const { agent } = makeAgent(GOOD_DRAFT, {});
    // 直接以失败 LLM 面重装（fakeLlm failWith）
    const failing = fakeLlm(GOOD_DRAFT, { failWith: boom });
    const deps: NodeDevAgentDeps = {
      llm: failing.llm,
      validate: validateDefinition,
      importer: { importArchiveBytes: async () => ({ nodes: [], noScript: [] }) },
    };
    const failingAgent = createNodeDevAgent(deps);
    await expect(failingAgent.develop({ request: 'x' })).rejects.toBe(boom);
    void agent;
  });
});

// ————————————————————————————————————————————
// §1 六环节 5/6 段：草稿卡停确认→adoptDraft（确认后唯一写入）
// ———————————————————————————————————————————

describe('develop-确认（adoptDraft——importArchiveBytes 恰一次＋落节点/闪烁/开抽屉）', () => {
  it('确认后导入恰一次（bytes=草稿 zip、confirm 自动放行）＋链内产物回填＋试跑元数据', async () => {
    const h = makeAgent(GOOD_DRAFT);
    const draft = await h.agent.develop({ request: '开发一个节点' });
    const result = await h.agent.adoptDraft(draft);

    // 恰一次（验收冻结断言）
    expect(h.importCalls).toHaveLength(1);
    expect(h.importCalls[0]!.bytes).toBe(draft.zip); // 内存 bytes 直入（03 L1101 v1.0e）
    // 链内 confirm 自动放行：草稿卡停确认已在 ConfirmGate 收口（A-10.2 唯一确认点）
    expect(await h.importCalls[0]!.opts?.confirm?.({} as ImportSummary)).toBe(true);

    // 视口中心落节点后的定位闪烁＋开抽屉（demo L2443 panToNode+openDrawerNode 语义——注入回调）
    expect(h.located).toEqual(['n-imp-1']);
    expect(h.opened).toEqual(['n-imp-1']);
    expect(result).toMatchObject({ nodeId: 'n-imp-1', type: 'xhs.search', name: '小红书搜索' });
    // B-5 试跑元数据：lang 字面量 'py'（02 §3.4——与 N4 'python' 不同源）＋资产路径回传＋N6 策略
    expect(result.trial).toEqual({
      lang: 'py',
      entry: 'run',
      scriptPath: 'xhs.search/1.0.0/scripts/xhs_search.py',
      configYaml: GOOD_DRAFT.configYaml,
      timeoutMs: 60000,
      retries: 1,
      params: {},
    });
  });

  it('assetScriptPath 注入位：应用壳绑定绝对路径（node-types 白名单根——02 §12.2#3）', async () => {
    const h = makeAgent(GOOD_DRAFT);
    h.deps.assetScriptPath = (type, pkgVersion, file) => `C:/userData/node-types/${type}/${pkgVersion}/${file}`;
    const draft = await h.agent.develop({ request: '开发一个节点' });
    const result = await h.agent.adoptDraft(draft);
    expect(result.trial!.scriptPath).toBe('C:/userData/node-types/xhs.search/1.0.0/scripts/xhs_search.py');
  });

  it('ConfirmGate 接线（T5-04 注入位）：develop→stage 草稿卡→确认前零写入→confirm 后恰一次导入', async () => {
    const h = makeAgent(GOOD_DRAFT);
    const gate = createConfirmGate({ adoptDraft: (d) => h.agent.adoptDraft(d) });
    const draft = await h.agent.develop({ request: '开发一个节点' });
    const staged = gate.stage({ kind: 'draft', draft, id: draft.id }); // 草稿卡挂 ConfirmGate（id=draft.id）

    expect(h.importCalls).toHaveLength(0); // adopt 前零写入（A-10.2 冻结断言）
    const outcome = await gate.confirm(staged.id);
    expect(outcome.kind).toBe('draft');
    expect((outcome.result as AdoptDraftResult).nodeId).toBe('n-imp-1');
    expect(h.importCalls).toHaveLength(1); // 确认后恰一次
    // 草稿卡挂对话流（workshopStore draft 槽定形 NodeDraft——02 §3.3）
    useWorkshopStore.getState().reset();
    useWorkshopStore.getState().pushMessage('assistant', '草稿如下 — 请确认后加入画布', { kind: 'draft', draft });
    const card = useWorkshopStore.getState().messages.at(-1)!.card;
    expect(card !== undefined && card.kind === 'draft' && card.draft.id === draft.id).toBe(true);
    useWorkshopStore.getState().reset();
  });

  it('非 NodeDraft 入参→DEV-NOT-DRAFT（导入链零调用）；导入回零节点→DEV-IMPORT-EMPTY', async () => {
    const h = makeAgent(GOOD_DRAFT);
    await expect(h.agent.adoptDraft({ preview: '不是草稿' })).rejects.toMatchObject({ code: 'DEV-NOT-DRAFT' });
    expect(h.importCalls).toHaveLength(0);

    const empty = makeAgent(GOOD_DRAFT, { importResult: { nodes: [], noScript: [] } });
    const draft = await empty.agent.develop({ request: 'x' });
    await expect(empty.agent.adoptDraft(draft)).rejects.toMatchObject({ code: 'DEV-IMPORT-EMPTY' });
  });

  it('导入结果 noScript 点名（脚本未被链认）→trial=null（不可试跑——02 §12.2#3 白名单面）', async () => {
    const h = makeAgent(GOOD_DRAFT, { importResult: { nodes: [importedNode()], noScript: ['小红书搜索'] } });
    const draft = await h.agent.develop({ request: 'x' });
    const result = await h.agent.adoptDraft(draft);
    expect(result.trial).toBeNull();
    // 弱节点草稿（exec=null）同样不可试跑
    const weak = { ...GOOD_DRAFT };
    delete (weak as Record<string, unknown>).exec;
    delete (weak as Record<string, unknown>).script;
    const hw = makeAgent(weak);
    const weakDraft = await hw.agent.develop({ request: 'x' });
    expect((await hw.agent.adoptDraft(weakDraft)).trial).toBeNull();
  });
});

// ————————————————————————————————————————————
// 真链集成：bytes 直入 importArchiveBytes——真 SecurityValidator/AssetInstaller roundtrip
// ———————————————————————————————————————————

describe('develop-真链集成（组装器 roundtrip 经真 C-08 管线——「开发即沉淀」）', () => {
  it('develop→确认→importArchiveBytes 一次：安全校验/落盘/注册/入库/落点全链断言', async () => {
    const dir = path.join(tmp, 'e2e-adopt');
    const layer = new StorageLayer(SQLITE_ENGINE);
    layer.open(dir);
    const hasType = (t: string): boolean =>
      (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);

    const registered = new Map<string, NodeDefinition>();
    const storageCalls: StorageInvokeReq[] = [];
    const drops: Array<Array<{ type: string; name?: string; x: number; y: number; params?: Record<string, unknown> }>> = [];
    let markDirty = 0;
    const canvasSink: ImportCanvasSink = {
      dropNodes: (specs) => {
        drops.push(specs.map((s) => ({ type: s.type, name: s.name, x: s.x, y: s.y, params: s.params })));
        return specs.map((_, i) => `sink-${i}`);
      },
      markDirty: () => {
        markDirty += 1;
      },
    };
    const pipeline = createZipImportPipeline({
      reader: createZipReader(),
      validator: createZipSecurityValidator(),
      parser: createPackageParser({ hasType }),
      installer: createAssetInstaller({
        reader: createZipReader(),
        validator: createZipSecurityValidator(),
        parser: createPackageParser({ hasType }),
        nodeTypesRoot: path.join(dir, 'node-types'),
        definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
        assetPackages: { upsert: (args) => layer.dao.assetPackages.upsert(args) },
      }),
    });
    const orch = createImportOrchestrator({
      bridge: {
        zipImport: async (req) => await pipeline(req), // 同进程直调真管线（零真 IPC——注入 seam 面）
        storageInvoke: async (req) => {
          storageCalls.push(req);
          return undefined;
        },
      },
      registry: {
        has: (t) => registered.has(t) || hasType(t),
        register: (doc) => {
          registered.set(doc.type, doc);
        },
      },
      validate: validateDefinition, // C-02 单一来源（T4-07）
      canvasSink,
      viewportCenter: () => ({ x: 400, y: 300 }),
    });
    const importArchiveBytes = vi.fn(orch.importArchiveBytes.bind(orch));

    const located: string[] = [];
    const opened: string[] = [];
    const agent = createNodeDevAgent({
      llm: fakeLlm(GOOD_DRAFT).llm,
      validate: validateDefinition,
      hasType,
      importer: { importArchiveBytes },
      locateNode: (id) => located.push(id),
      openDrawer: (id) => opened.push(id),
    });

    const draft = await agent.develop({ request: '开发一个小红书搜索节点', params: { query: '咖啡' } });
    expect(importArchiveBytes).toHaveBeenCalledTimes(0); // adopt 前零写入（冻结断言——真链面）
    const result = await agent.adoptDraft(draft);
    expect(importArchiveBytes).toHaveBeenCalledTimes(1); // 确认后恰一次

    // ① 真 SecurityValidator 接受了组装器产物（zip 未被拒——roundtrip 前置证明）
    // ② 定义入库（definitions.upsert——AssetInstaller 链内）＋注册表刷新（C-05 register）
    expect(registered.get('xhs.search')).toEqual(draft.definition);
    expect(layer.dao.definitions.loadAll().some((d) => d.type === 'xhs.search' && d.kind === 'custom')).toBe(true);
    // ③ 资产落盘 node-types/<type>/<pkgVersion>/（SandboxExecutor 白名单根——脚本/config/deps 全量拷入）
    const assetDir = path.join(dir, 'node-types', 'xhs.search', '1.0.0');
    expect(readdirSync(assetDir).sort()).toEqual(
      ['config', 'deps', 'manifest.json', 'nodes', 'scripts'].sort(),
    );
    expect(await readFile(path.join(assetDir, 'scripts', 'xhs_search.py'), 'utf8')).toBe(GOOD_DRAFT.script);
    // ④ library.upsert（入库——含 scriptMeta）＋markDirty（链内 ⑤ 段）
    const libReq = storageCalls.find((r) => r.op === 'library.upsert');
    expect(libReq).toBeDefined();
    if (libReq !== undefined && libReq.op === 'library.upsert') {
      expect(libReq.args.entry).toMatchObject({
        name: '小红书搜索',
        type: 'xhs.search',
        scriptMeta: { lang: 'python', file: 'scripts/xhs_search.py' },
      });
    }
    expect(markDirty).toBe(1);
    // ⑤ CanvasSink 落点断言：视口中心锚定（WaterfallPlacer 首项=base.x-NODE_W/2/base.y-30——demo L2630）
    expect(drops).toHaveLength(1);
    expect(drops[0]).toEqual([
      { type: 'xhs.search', name: '小红书搜索', x: Math.round(400 - 192 / 2), y: 300 - 30, params: { query: '咖啡' } },
    ]);
    // ⑥ 定位闪烁/开抽屉收到导入产物节点 id（真 AssetInstaller 生成的 id 前缀）
    expect(located).toHaveLength(1);
    expect(located[0]).toMatch(/^n-xhs-search-/);
    expect(opened).toEqual(located);
    // ⑦ 试跑元数据：资产路径回传（相对约定——应用壳注入绝对解析器换算）
    expect(result.trial).toMatchObject({ lang: 'py', scriptPath: 'xhs.search/1.0.0/scripts/xhs_search.py' });

    layer.close();
  });
});

// ————————————————————————————————————————————
// B-5 试跑：adopted 资产 spawnScript 直调＋事件回显（02 §12.2#3 冻结合法面）
// ———————————————————————————————————————————

describe('develop-试跑（B-5——已装脚本 spawnScript 直调＋run:scriptEvent 回显）', () => {
  function adoptedWithTrial(trial: AdoptDraftResult['trial']): AdoptDraftResult {
    return { nodeId: 'n-imp-1', type: 'xhs.search', name: '小红书搜索', trial };
  }
  const TRIAL = {
    lang: 'py' as const,
    entry: 'run',
    scriptPath: 'xhs.search/1.0.0/scripts/xhs_search.py',
    configYaml: 'query: 咖啡\n',
    timeoutMs: 60000,
    retries: 1,
    params: { query: '咖啡' },
  };

  function eventBus() {
    const listeners = new Set<(e: ScriptEvent) => void>();
    return {
      subscribeScriptEvent: (l: (e: ScriptEvent) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      emit: (e: ScriptEvent) => [...listeners].forEach((l) => l(e)),
      size: () => listeners.size,
    };
  }

  it('spawnScript 直调：req 全形（nodeRunId/lang=py/scriptPath/entry/params/input/configYaml/N6）', async () => {
    const h = makeAgent(GOOD_DRAFT);
    const bus = eventBus();
    h.deps.subscribeScriptEvent = bus.subscribeScriptEvent;
    const events: ScriptEvent[] = [];

    const handle = await h.agent.trialRun(adoptedWithTrial(TRIAL), {
      input: { seed: 1 },
      onEvent: (e) => events.push(e),
    });
    expect(handle.res).toEqual({ ok: true, pid: 4321 });
    expect(h.spawnReqs).toHaveLength(1);
    expect(h.spawnReqs[0]).toMatchObject({
      lang: 'py',
      scriptPath: TRIAL.scriptPath,
      entry: 'run',
      params: { query: '咖啡' },
      input: { seed: 1 },
      configYaml: TRIAL.configYaml,
      timeoutMs: 60000,
      retries: 1,
    });
    expect(h.spawnReqs[0]!.nodeRunId).toMatch(/^trial-/);
    // 对端形断言（C-03 RunLoop 冻结形 `<runId>:<nodeId>`——main splitNodeRunId 每次 spawn 必经，
    // 畸形 id 在真 T4-16 对端 100% 被拒；默认值例）
    const split = splitNodeRunId(h.spawnReqs[0]!.nodeRunId);
    expect(split.runId).toMatch(/^trial-[0-9a-f-]+$/); // 首段非空（runId）
    expect(split.nodeId).toBe('n-imp-1'); // 次段非空（nodeId=adopt 产物）

    // 事件回显：本 run 转发、他 run 过滤；exit 后自动退订
    const id = h.spawnReqs[0]!.nodeRunId;
    bus.emit({ nodeRunId: id, kind: 'stdout', chunk: '{"items":[]}' });
    bus.emit({ nodeRunId: 'trial-other', kind: 'stdout', chunk: 'noise' });
    expect(events.map((e) => e.kind)).toEqual(['stdout']);
    expect(events[0]!.chunk).toBe('{"items":[]}');
    bus.emit({ nodeRunId: id, kind: 'exit', code: 0, ms: 12 });
    expect(events.map((e) => e.kind)).toEqual(['stdout', 'exit']);
    expect(bus.size()).toBe(0); // exit 自动退订
    handle.dispose();
  });

  it('opts.params 覆盖预填（手输参数优先）；opts.nodeRunId 指定（冻结形 `<runId>:<nodeId>` 原样透传——自定义值例）', async () => {
    const h = makeAgent(GOOD_DRAFT);
    h.deps.subscribeScriptEvent = eventBus().subscribeScriptEvent;
    await h.agent.trialRun(adoptedWithTrial(TRIAL), { params: { query: '茶' }, nodeRunId: 'run-42:n-imp-1', input: null });
    expect(h.spawnReqs[0]).toMatchObject({ params: { query: '茶' }, input: null });
    // 对端形断言（自定义值例）：含冒号且两段非空——splitNodeRunId 强校验通过
    expect(splitNodeRunId(h.spawnReqs[0]!.nodeRunId)).toEqual({ runId: 'run-42', nodeId: 'n-imp-1' });
  });

  it('未 adopted（trial=null）→DEV-NOT-ADOPTED（02 §12.2#3：只有已确认安装资产可加载）', async () => {
    const h = makeAgent(GOOD_DRAFT);
    await expect(h.agent.trialRun(adoptedWithTrial(null))).rejects.toMatchObject({ code: 'DEV-NOT-ADOPTED' });
    expect(h.spawnReqs).toHaveLength(0);
  });

  it('spawn 面未注入→DEV-NO-RUN-FACE；spawn 失败→退订不残留＋错误上抛', async () => {
    const h = makeAgent(GOOD_DRAFT);
    delete (h.deps as Partial<NodeDevAgentDeps>).spawnScript;
    await expect(h.agent.trialRun(adoptedWithTrial(TRIAL))).rejects.toMatchObject({ code: 'DEV-NO-RUN-FACE' });

    const bus = eventBus();
    const failing = makeAgent(GOOD_DRAFT);
    failing.deps.subscribeScriptEvent = bus.subscribeScriptEvent;
    (failing.deps as { spawnScript?: unknown }).spawnScript = async () => {
      throw new Error('RUN-SPAWN-FAILED');
    };
    await expect(failing.agent.trialRun(adoptedWithTrial(TRIAL), { onEvent: () => {} })).rejects.toMatchObject({
      message: 'RUN-SPAWN-FAILED',
    });
    expect(bus.size()).toBe(0); // 已订阅场景失败即退订（不残留订阅）
  });
});
