// install 链端到端集成（T5-10 / 任务卡验收「bytes 链端到端：download {data}→inspect({bytes})→
// confirm→commit——真 main 管线集成测试至少一例（真 SecurityValidator/AssetInstaller，mock 网络）」）。
//
// 真件：createZipImportPipeline（真 ZipReader/ZipSecurityValidator/PackageParser/AssetInstaller＋
// 真 StorageLayer/DAO——临时目录）、createImportOrchestrator（bridge.zipImport=pipeline 同进程直调
// ——零真 IPC）、createInstaller、createFlowInstaller（真 createFlowSwitcher＋真 flowStore）。
// mock：网络面（client.request download 返回构造 zip bytes——「mock 网络」）＋storageInvoke
// （flows.create/library.upsert 记录面）＋confirm（注入回调）。zip 构造=client 自产 zip-writer
// （§6.8 P-3：三方 zip 库 import 唯一面=main/zip——renderer 测试文件亦不越面）。
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PackageDetail } from '@constella/shared/dto';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { SQLITE_ENGINE } from '../../main/storage/engine/sqlite-engine';
import { StorageLayer } from '../../main/storage/storage-layer';
import { createAssetInstaller } from '../../main/zip/asset-installer';
import { createPackageParser } from '../../main/zip/package-parser';
import { createZipImportPipeline } from '../../main/zip/import-pipeline';
import { createZipReader } from '../../main/zip/zip-reader';
import { createZipSecurityValidator } from '../../main/zip/zip-security-validator';
import { createZipWriter } from '../../main/zip/zip-writer';
import { useFlowStore } from '../canvas/stores/flow-store';
import { createCanvasSink, createFlowSwitcher } from '../canvas/sink/canvas-sink';
import { createImportOrchestrator } from '../zip/import-orchestrator';
import { createFlowInstaller } from './flow-installer';
import { createInstaller, MARKET_DOWNLOAD_TIMEOUT_MS } from './installer';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-install-chain-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '社媒' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}
const XHS_DEF = defOf({
  type: 'xhs.search',
  meta: { name: '小红书搜索', icon: '📕', category: '社媒' },
  exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
});

let zipBuildSeq = 0;
async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  // client 自产 writer（store 档）——写临时盘取字节（§6.8 P-3 收窄：不经三方 zip 库）
  const savePath = path.join(tmp, `zipbuild-${zipBuildSeq++}.zip`);
  const r = await createZipWriter().write(Object.entries(files).map(([name, data]) => ({ name, data })), savePath);
  return new Uint8Array(r.bytes);
}

/** node/pack 包（C-08 四件套——与 main 侧 spec 同构） */
const NODE_PKG: Record<string, string> = {
  'manifest.json': JSON.stringify({
    kind: 'node',
    name: '小红书搜索',
    version: '1.0.0',
    scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
  }),
  'nodes/小红书搜索.json': JSON.stringify({
    type: 'xhs.search',
    name: '小红书搜索',
    position: { x: 12, y: 34 },
    params: { query: '咖啡' },
    definition: XHS_DEF,
  }),
  'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
};

/** flow 包（流程导出变体形：manifest kind=flow＋nodes/*.json=BFS 序 steps＋scripts 键=节点名） */
const FLOW_PKG: Record<string, string> = {
  'manifest.json': JSON.stringify({
    kind: 'flow',
    name: '示例流程',
    version: '1.0.0',
    scripts: { 小红书搜索: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
  }),
  'nodes/01.json': JSON.stringify({ type: 'trigger.manual', name: '手动触发', position: { x: 0, y: 0 }, params: {} }),
  'nodes/02.json': JSON.stringify({
    type: 'xhs.search',
    name: '小红书搜索',
    position: { x: 250, y: 0 },
    params: { query: '咖啡' },
    definition: XHS_DEF,
  }),
  'nodes/03.json': JSON.stringify({ type: 'data.transform', name: '清洗', position: { x: 500, y: 0 }, params: {} }),
  'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
};

interface ChainCalls {
  download: Array<{ path: string; timeoutMs?: number }>;
  installs: string[];
  storageInvoke: StorageInvokeReq[];
  flowsCreate: string[];
  confirm: number[]; // 每框收到的节点清单长度（框1=0；框2=inspect 精确数）
}

interface Chain {
  dir: string;
  layer: StorageLayer;
  calls: ChainCalls;
  install: ReturnType<typeof createInstaller>['install'];
  /** mock 网络：注入某包的 download 产物（302 预签名 follow 后字节体） */
  serve(kind: 'node' | 'flow', files: Record<string, string>): Promise<void>;
}

async function openChain(rel: string, opts: { confirmValue?: boolean } = {}): Promise<Chain> {
  const dir = path.join(tmp, rel);
  await mkdir(dir, { recursive: true });
  const layer = new StorageLayer(SQLITE_ENGINE);
  layer.open(dir);
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);
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
  const calls: ChainCalls = { download: [], installs: [], storageInvoke: [], flowsCreate: [], confirm: [] };
  const registered = new Map<string, NodeDefinition>();
  let servedKind: 'node' | 'flow' = 'node';
  let servedBytes: Uint8Array = new Uint8Array(0);

  const importer = createImportOrchestrator({
    bridge: {
      zipImport: async (req) => await pipeline(req), // 同进程直调真管线（零真 IPC——注入 seam 面）
      storageInvoke: async (req) => {
        calls.storageInvoke.push(req);
        return undefined;
      },
    },
    registry: {
      has: (t) => registered.has(t) || hasType(t),
      register: (doc) => registered.set(doc.type, doc),
    },
    // C-02 校验器单一来源（renderer 出现面=definition/node-registry/zip——T4-07 §6.5 断言）：
    // market 侧不重复注入（真校验注入面由 zip/ 域测试覆盖）；本集成测试注入透传放行
    // （fixture 定义均合法——C-02 拒入分支不在本测试断言面）
    validate: () => ({ ok: true, errors: [] }),
    canvasSink: createCanvasSink({ viewportCenter: () => ({ x: 400, y: 300 }) }), // 真落图 seam
    viewportCenter: () => ({ x: 400, y: 300 }),
    derivePerms: (cats) => (cats.includes('社媒') ? (['社媒'] as const) : []),
  });
  const flowInstaller = createFlowInstaller({
    canvasSink: { guardDirty: (a) => useFlowStore.getState().guardDirty(a) },
    flowSwitcher: createFlowSwitcher(), // 真切换 seam
    storageInvoke: async (req) => {
      if (req.op === 'flows.create') {
        calls.flowsCreate.push((req.args as { name: string }).name);
        return { id: 'flow-lib-9' };
      }
      return undefined;
    },
    viewportCenter: () => ({ x: 400, y: 300 }),
  });
  const installer = createInstaller({
    client: {
      detail: async (): Promise<PackageDetail> => ({
        id: 'pkg-1',
        kind: servedKind,
        name: servedKind === 'flow' ? '示例流程' : '小红书搜索',
        author: { id: 'u1', name: 'yeager' },
        perms: ['社媒'],
        downloadCount: 0,
        installCount: 0,
        starCount: 0,
        version: '1.0.0',
        updatedAt: '2026-11-08T02:11:00Z',
        versions: [],
      }),
      request: async <T,>(p: string, init?: { timeoutMs?: number }): Promise<T> => {
        if (p.endsWith('/download')) {
          calls.download.push({ path: p, timeoutMs: init?.timeoutMs });
          return { data: servedBytes, contentType: 'application/zip' } as unknown as T;
        }
        throw new Error(`unexpected ${p}`);
      },
      recordInstall: async (id: string) => {
        calls.installs.push(id);
        return { ok: true };
      },
    },
    importer,
    flowInstaller,
    confirm: async (data) => {
      calls.confirm.push(data.nodes.length);
      return opts.confirmValue ?? true;
    },
    derivePerms: (cats) => (cats.includes('社媒') ? (['社媒'] as const) : []),
    notify: () => {},
  });
  return {
    dir,
    layer,
    calls,
    install: installer.install,
    async serve(kind, files) {
      servedKind = kind;
      servedBytes = await buildZip(files);
    },
  };
}

const DOC = { id: 'f0', name: '初始', nodes: [], edges: [] };
beforeEach(() => {
  useFlowStore.getState().loadFlow('f0', DOC);
});

describe('install 链端到端（真 C-08 main 管线注入——bytes 直入，02 v1.0e PM 裁决）', () => {
  it('node 包：确认→download（大 timeoutMs）→真 inspect({bytes})→confirm→真 commit→画布/库/资产/计量全链落定', async () => {
    const ctx = await openChain('e2e-node');
    try {
      await ctx.serve('node', NODE_PKG);
      const res = await ctx.install({ id: 'pkg-1', kind: 'node' });

      // download：大 timeoutMs（评审转交项）
      expect(ctx.calls.download).toEqual([
        { path: '/api/market/packages/pkg-1/download', timeoutMs: MARKET_DOWNLOAD_TIMEOUT_MS },
      ]);
      // 两框（框1 detail 面 0 清单＋框2 inspect 精确清单 1）
      expect(ctx.calls.confirm).toEqual([0, 1]);
      // 真 commit 落盘＋双 upsert
      expect(ctx.layer.dao.definitions.loadAll().some((d) => d.type === 'xhs.search')).toBe(true);
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(1);
      expect(readdirSync(path.join(ctx.dir, 'node-types', 'xhs.search', '1.0.0')).length).toBeGreaterThan(0);
      // 真画布落图（CanvasSink 真件）＋name 透传（授权 1 端到端）
      expect(useFlowStore.getState().nodes).toHaveLength(1);
      expect((useFlowStore.getState().nodes[0]?.data as { name?: string }).name).toBe('小红书搜索');
      // library.upsert（经注入 bridge.storageInvoke）
      expect(ctx.calls.storageInvoke.filter((r) => r.op === 'library.upsert')).toHaveLength(1);
      // installs 计量恰一次
      expect(ctx.calls.installs).toEqual(['pkg-1']);
      expect(res).toMatchObject({ kind: 'node', nodeCount: 1 });
    } finally {
      ctx.layer.close();
    }
  });

  it('flow 包：确认→download→真 inspect({bytes})→confirm→真 commitBytes（资产落盘）→FlowInstaller 回放 3 节点 2 边＋切换＋计量', async () => {
    const ctx = await openChain('e2e-flow');
    try {
      await ctx.serve('flow', FLOW_PKG);
      const res = await ctx.install({ id: 'pkg-1', kind: 'flow' });

      expect(ctx.calls.download).toHaveLength(1);
      expect(ctx.calls.confirm).toEqual([0, 3]); // 框2=3 步精确清单
      // flow 链不走 node/pack 全链：当前画布不落节点（落新流程）、library 零写
      expect(ctx.calls.storageInvoke.filter((r) => r.op === 'library.upsert')).toHaveLength(0);
      // 真资产落盘（custom 步 scripts 落 node-types——SandboxExecutor 白名单面）
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(1);
      expect(readdirSync(path.join(ctx.dir, 'node-types', 'xhs.search', '1.0.0'))).toContain('scripts');
      // FlowInstaller：flows.create 恰一次＋新流程 3 节点 2 边（真 store）
      expect(ctx.calls.flowsCreate).toEqual(['示例流程']);
      const store = useFlowStore.getState();
      expect(store.nodes).toHaveLength(3);
      expect(store.edges).toHaveLength(2);
      expect(store.nodes.map((n) => (n.data as { name?: string }).name)).toEqual(['手动触发', '小红书搜索', '清洗']);
      expect(store.serialize().edges).toHaveLength(2);
      // 计量恰一次
      expect(ctx.calls.installs).toEqual(['pkg-1']);
      expect(res).toMatchObject({ kind: 'flow', nodeCount: 3, edgeCount: 2, flowId: 'flow-lib-9' });
    } finally {
      ctx.layer.close();
    }
  });

  it('确认前取消→真管线零触发（download/inspect/commit/installs 全零——12.2#2）', async () => {
    const ctx = await openChain('e2e-cancel', { confirmValue: false });
    try {
      await ctx.serve('node', NODE_PKG);
      await expect(ctx.install({ id: 'pkg-1', kind: 'node' })).rejects.toMatchObject({ name: 'ImportCancelledError' });
      expect(ctx.calls.download).toHaveLength(0);
      expect(ctx.calls.installs).toHaveLength(0);
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(0); // 零入库
      expect(() => readdirSync(path.join(ctx.dir, 'node-types'))).toThrow(); // 零落盘
      expect(useFlowStore.getState().nodes).toHaveLength(0); // 画布零落
    } finally {
      ctx.layer.close();
    }
  });
});
