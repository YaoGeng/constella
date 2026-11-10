// ImportOrchestrator / WaterfallPlacer（T5-07 / TDD-C-08 §3 组件行＋§1 接口冻结形）——
// `vitest run zip-pipeline` 过滤面随行（renderer 侧；注入式 bridge/CanvasSink/registry——
// 零 zip 库依赖，§6.8 读写收窄 main）。
//
// 覆盖：两段式编排 inspect→confirm（注入回调——单测 ()=>true；取消→**四路零写入**：zip:commit
// 不调/画布不落/库不写/注册表不进）→commit→WaterfallPlacer 瀑布（每项右移 36px/下移 40px——
// demo L2630）→CanvasSink.dropNodes 整批单历史项接线→library.upsert（含 scriptMeta）→
// C-05 register；noScript warn 点名＋toast 计数（demo L2637-2643）；撞内置命名空间定义拒入
// 不静默改名（02 §12.4——C-02 validateDefinition 注入消费）；source='builtin' 免确认（W-35 A）。
import { describe, expect, it, vi } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PermLabel } from '@constella/shared/dto';
import type {
  ImportedNode,
  StorageInvokeReq,
  ZipImportReq,
  ZipImportRes,
} from '@constella/shared/ipc';
import type { PackageManifest } from '@constella/shared/manifest';
import { validateDefinition } from '../definition';
import {
  ImportCancelledError,
  createImportOrchestrator,
  type ImportCanvasSink,
  type ImportOrchestratorDeps,
  type ZipImportBridge,
} from './import-orchestrator';
import { WATERFALL_DX, WATERFALL_DY, createWaterfallPlacer } from './waterfall-placer';

// ————————————————————————————————————————————
// WaterfallPlacer（§3 组件行：positions(n)——视口中心瀑布，+36/+40）
// ————————————————————————————————————————————

describe('WaterfallPlacer（demo L2630）', () => {
  it('每项右移 36px/下移 40px（相邻差=步进常量；首项=视口中心锚定）', () => {
    const placer = createWaterfallPlacer({ viewportCenter: () => ({ x: 500, y: 400 }) });
    const positions = placer.positions(4);
    expect(positions).toHaveLength(4);
    for (let i = 1; i < 4; i++) {
      expect(positions[i]!.x - positions[i - 1]!.x).toBe(WATERFALL_DX); // 36
      expect(positions[i]!.y - positions[i - 1]!.y).toBe(WATERFALL_DY); // 40
    }
    expect(WATERFALL_DX).toBe(36);
    expect(WATERFALL_DY).toBe(40);
    // 首项锚定视口中心（demo L2630：base.x-NODE_W/2 / base.y-30——中心偏移首节点）
    expect(positions[0]!.x).toBeLessThan(500);
    expect(positions[0]!.y).toBeLessThan(400);
  });

  it('视口中心随调用取值（n=0 空数组；n=1 单点）', () => {
    const placer = createWaterfallPlacer({ viewportCenter: () => ({ x: 0, y: 0 }) });
    expect(placer.positions(0)).toEqual([]);
    expect(placer.positions(1)).toHaveLength(1);
  });
});

// ————————————————————————————————————————————
// ImportOrchestrator（§1 接口冻结形：importArchive(path,opts)——T5-03/T5-10 共用单一入口）
// ————————————————————————————————————————————

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '社媒' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: { lang: 'python', file: 'scripts/x.py', entry: 'run' },
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}
const XHS_DEF = defOf({ type: 'xhs.search' });

interface Harness {
  orch: ReturnType<typeof createImportOrchestrator>;
  calls: {
    zipImport: ZipImportReq[];
    storageInvoke: StorageInvokeReq[];
    dropNodes: Array<Array<{ type: string; x: number; y: number; params?: Record<string, unknown> }>>;
    registered: NodeDefinition[];
    markDirty: number;
    notify: Array<[string, string]>;
  };
}

const MANIFEST: PackageManifest = {
  kind: 'node',
  name: '示例资产',
  version: '1.0.0',
  scripts: { 小红书搜索: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
};

function inspectRes(): ZipImportRes {
  return {
    nodes: [
      {
        type: 'xhs.search',
        name: '小红书搜索',
        position: { x: 0, y: 0 },
        params: { query: '咖啡' },
        definition: XHS_DEF,
        noScript: false,
      },
    ],
    noScript: [],
    categories: ['社媒'],
    manifest: MANIFEST,
    token: 'a'.repeat(64),
  };
}

function commitRes(): { nodes: ImportedNode[]; noScript: string[] } {
  return {
    nodes: [
      {
        id: 'n-main-1',
        type: 'xhs.search',
        name: '小红书搜索',
        position: { x: 12, y: 34 },
        params: { query: '咖啡' },
      },
    ],
    noScript: [],
  };
}

function makeHarness(opts: {
  inspect?: ZipImportRes;
  commit?: ZipImportRes;
  commitReject?: Error;
  registryHas?: (t: string) => boolean;
  derivePerms?: (categories: readonly string[]) => PermLabel[];
} = {}): Harness {
  const calls: Harness['calls'] = {
    zipImport: [],
    storageInvoke: [],
    dropNodes: [],
    registered: [],
    markDirty: 0,
    notify: [],
  };
  const bridge: ZipImportBridge = {
    zipImport: vi.fn(async (payload: ZipImportReq) => {
      calls.zipImport.push(payload);
      if (payload.phase === 'inspect') return opts.inspect ?? inspectRes();
      if (opts.commitReject !== undefined) throw opts.commitReject;
      return opts.commit ?? commitRes();
    }),
    storageInvoke: vi.fn(async (req: StorageInvokeReq) => {
      calls.storageInvoke.push(req);
      return undefined;
    }),
  };
  const canvasSink: ImportCanvasSink = {
    dropNodes(specs) {
      calls.dropNodes.push(specs.map((s) => ({ ...s })));
      return specs.map((_, i) => `dropped-${i}`);
    },
    markDirty() {
      calls.markDirty += 1;
    },
  };
  const registered = new Map<string, NodeDefinition>();
  const deps: ImportOrchestratorDeps = {
    bridge,
    registry: {
      has: opts.registryHas ?? ((t) => registered.has(t)),
      register: (doc) => {
        calls.registered.push(doc);
        registered.set(doc.type, doc);
      },
    },
    validate: validateDefinition, // C-02 单一来源（T4-07）
    canvasSink,
    viewportCenter: () => ({ x: 400, y: 300 }),
    ...(opts.derivePerms !== undefined ? { derivePerms: opts.derivePerms } : {}),
    notify: (level, msg) => calls.notify.push([level, msg]),
  };
  return { orch: createImportOrchestrator(deps), calls };
}

describe('ImportOrchestrator——两段式编排', () => {
  it('inspect→confirm(注入回调收 summary)→commit→瀑布 dropNodes→library.upsert→C-05 register', async () => {
    const confirm = vi.fn(async () => true);
    const h = makeHarness();
    const res = await h.orch.importArchive('C:\\pkg.zip', { confirm });

    // confirm 收到 ImportSummary（无 token——清单面）
    expect(confirm).toHaveBeenCalledTimes(1);
    const summary = (confirm.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(['categories', 'manifest', 'noScript', 'nodes']);
    // 两段通道调用形：inspect {path,phase} → commit {path,phase,token}
    expect(h.calls.zipImport).toEqual([
      { path: 'C:\\pkg.zip', phase: 'inspect' },
      { path: 'C:\\pkg.zip', phase: 'commit', token: 'a'.repeat(64) },
    ]);

    // 瀑布落点（WaterfallPlacer 坐标）：单节点=视口中心锚定；params 透传
    expect(h.calls.dropNodes).toHaveLength(1);
    const spec = h.calls.dropNodes[0]![0]!;
    expect(spec.type).toBe('xhs.search');
    expect(spec.params).toEqual({ query: '咖啡' });
    expect(h.calls.markDirty).toBe(1);

    // library.upsert：含 scriptMeta（manifest.scripts 命中——demo L2632 有脚本连库条目带元信息）
    expect(h.calls.storageInvoke).toHaveLength(1);
    const libReq = h.calls.storageInvoke[0]!;
    expect(libReq.op).toBe('library.upsert');
    if (libReq.op !== 'library.upsert') throw new Error('unreachable');
    expect(libReq.args.entry).toMatchObject({
      name: '小红书搜索',
      type: 'xhs.search',
      params: { query: '咖啡' },
      scriptMeta: { lang: 'python', file: 'scripts/xhs_search.py' },
    });
    expect(typeof libReq.args.entry.id).toBe('string');

    // C-05 register（commit 后——注册表刷新）
    expect(h.calls.registered).toEqual([XHS_DEF]);
    expect(res).toEqual(commitRes());
    expect(h.calls.notify.some(([l]) => l === 'ok')).toBe(true);
  });

  it('inspect 后取消（confirm=false）→ 四路零写入：不调 commit/画布零落/库零写/注册表零进', async () => {
    const h = makeHarness();
    const err = await h.orch.importArchive('C:\\pkg.zip', { confirm: async () => false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportCancelledError);
    expect((err as ImportCancelledError).cancelled).toBe(true);
    expect(h.calls.zipImport).toEqual([{ path: 'C:\\pkg.zip', phase: 'inspect' }]); // 仅 inspect
    expect(h.calls.dropNodes).toHaveLength(0); // 画布零落
    expect(h.calls.storageInvoke).toHaveLength(0); // library 零写
    expect(h.calls.registered).toHaveLength(0); // 注册表零进
    expect(h.calls.markDirty).toBe(0);
  });

  it('未注入 confirm 且 source 非 builtin → 视为未确认取消（02 §12.2#2 安全缺省）', async () => {
    const h = makeHarness();
    await expect(h.orch.importArchive('C:\\pkg.zip')).rejects.toBeInstanceOf(ImportCancelledError);
    expect(h.calls.zipImport).toHaveLength(1); // 仅 inspect
  });

  it("source='builtin' 免确认（官方示例包——W-35 裁定 A）：无 confirm 直达 commit", async () => {
    const h = makeHarness();
    const res = await h.orch.importArchive('C:\\examples\\demo.zip', { source: 'builtin' });
    expect(h.calls.zipImport).toHaveLength(2);
    expect(res.nodes).toHaveLength(1);
  });

  it('commit 响应 token 复验失败（ZIP-UNSAFE-ENTRY 透传）→ 零画布零库', async () => {
    const h = makeHarness({
      commitReject: Object.assign(new Error('导入令牌复验失败：包内容与 inspect 清单不符'), { code: 'ZIP-UNSAFE-ENTRY' }),
    });
    await expect(h.orch.importArchive('C:\\pkg.zip', { confirm: async () => true })).rejects.toMatchObject({
      code: 'ZIP-UNSAFE-ENTRY',
    });
    expect(h.calls.dropNodes).toHaveLength(0);
    expect(h.calls.storageInvoke).toHaveLength(0);
  });

  it('noScript 节点：warn 日志点名＋toast 计数（demo L2637-2643）；库条目不带 scriptMeta；画布照落', async () => {
    const h = makeHarness({
      inspect: {
        nodes: [
          { type: 'xhs.search', name: '搜索', position: { x: 0, y: 0 }, params: {}, definition: XHS_DEF, noScript: true },
          { type: 'xhs.search', name: '搜索2', position: { x: 0, y: 0 }, params: {}, definition: XHS_DEF, noScript: true },
        ],
        noScript: ['搜索', '搜索2'],
        categories: ['社媒'],
        manifest: { kind: 'node', name: '缺脚本包', version: '1.0.0' }, // 无 scripts 映射
        token: 'a'.repeat(64),
      },
      commit: {
        nodes: [
          { id: 'n1', type: 'xhs.search', name: '搜索', position: { x: 0, y: 0 }, params: {}, noScript: true },
          { id: 'n2', type: 'xhs.search', name: '搜索2', position: { x: 0, y: 0 }, params: {}, noScript: true },
        ],
        noScript: ['搜索', '搜索2'],
      },
    });
    const res = await h.orch.importArchive('C:\\pkg.zip', { confirm: async () => true });
    // warn 点名（搜索、搜索2 都点名）＋toast 计数（2 个）
    const warn = h.calls.notify.filter(([l]) => l === 'warn').map(([, m]) => m);
    expect(warn.some((m) => m.includes('搜索') && m.includes('搜索2'))).toBe(true);
    expect(h.calls.notify.some(([, m]) => m.includes('2') && m.includes('缺脚本'))).toBe(true);
    // 库条目：无 scriptMeta（空占位形——与 DAO 缺省一致）
    expect(h.calls.storageInvoke).toHaveLength(2);
    const entries = h.calls.storageInvoke.map(
      (r) => (r as { args: { entry: { scriptMeta: { file: string }; name: string } } }).args.entry,
    );
    expect(entries.every((e) => e.scriptMeta.file === '')).toBe(true);
    // 画布照落（noScript 节点同样落画布——运行闸拦截归 C-03）
    expect(h.calls.dropNodes[0]).toHaveLength(2);
    expect(res.noScript).toEqual(['搜索', '搜索2']);
  });

  it('撞内置命名空间定义拒入并警示、不静默改名（02 §12.4——C-02 validateDefinition N1）', async () => {
    const h = makeHarness({
      inspect: {
        nodes: [
          {
            type: 'data.transform', // 撞内置 12 类
            name: '伪装内置',
            position: { x: 0, y: 0 },
            params: {},
            definition: defOf({ type: 'data.transform' }), // custom 声明内置 type
            noScript: false,
          },
        ],
        noScript: [],
        categories: [],
        manifest: { kind: 'node', name: '伪装包', version: '1.0.0' },
        token: 'a'.repeat(64),
      },
    });
    const err = await h.orch.importArchive('C:\\evil.zip', { confirm: async () => true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('data.transform'); // 点名
    expect((err as Error).message).toContain('拒入'); // 警示语义
    // 四路零写入（拒在 confirm 前）
    expect(h.calls.zipImport).toHaveLength(1);
    expect(h.calls.dropNodes).toHaveLength(0);
    expect(h.calls.storageInvoke).toHaveLength(0);
    expect(h.calls.registered).toHaveLength(0);
  });

  it('同名同型覆盖不误伤（A-11.1）：已注册同 type 的 custom 定义再导入=合法覆盖（ctx 排除自身）', async () => {
    const existing = { ...XHS_DEF, meta: { ...XHS_DEF.meta, name: '旧版' } };
    const h = makeHarness({ registryHas: (t) => t === 'xhs.search' });
    const res = await h.orch.importArchive('C:\\pkg.zip', { confirm: async () => true });
    expect(res.nodes).toHaveLength(1);
    expect(h.calls.registered).toEqual([XHS_DEF]); // 覆盖注册（不因撞已注册拒）
    void existing;
  });

  it('瀑布坐标（§6.5）：多节点逐项 +36/+40——dropNodes 收到的坐标=WaterfallPlacer 产物', async () => {
    const nodes = [1, 2, 3].map((i) => ({
      id: `n${i}`,
      type: 'xhs.search',
      name: `节点${i}`,
      position: { x: 0, y: 0 },
      params: {},
    }));
    const h = makeHarness({
      commit: { nodes, noScript: [] },
    });
    await h.orch.importArchive('C:\\pkg.zip', { confirm: async () => true });
    const specs = h.calls.dropNodes[0]!;
    expect(specs).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(specs[i]!.x - specs[i - 1]!.x).toBe(36); // 每项右移 36px
      expect(specs[i]!.y - specs[i - 1]!.y).toBe(40); // 每项下移 40px
    }
  });

  it('perms 同源推导（derivePerms 注入——C-05 同源）：confirm 前完成（安装确认面 12.2#2 消费）', async () => {
    const seen: string[] = [];
    const h = makeHarness({
      derivePerms: (categories) => {
        seen.push([...categories].join(','));
        return categories.includes('社媒') ? (['社媒'] as PermLabel[]) : [];
      },
    });
    await h.orch.importArchive('C:\\pkg.zip', { confirm: async () => true });
    expect(seen).toEqual(['社媒']);
  });
});
