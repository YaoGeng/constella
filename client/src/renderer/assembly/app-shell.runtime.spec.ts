// app-shell.runtime 用例（T6-17 验收 1——装配级：runtime 生产构造点接线断言）。
//
// 断言面（卡面验收四项之三项，第四项定位编排脏闸贯通在此、挂载面存在性在 app-shell.spec.tsx）：
//   - confirm 真注入非缺省放行：createAppRuntime **必填** confirm（结构性无缺省）＋market 安装链
//     框1 confirm=false → 取消拒装（零 download 零导入）＝缺省放行 `(async()=>true)` 的反义；
//   - 试跑绑定链：NodeDevAgent.trialRun←preload run:spawnScript/run:scriptEvent 直调映射
//     （spawn 载荷按 trial 元数据展开；事件按 nodeRunId 过滤转发＋exit 自动退订）；
//   - FlowMaterializer 生产构造：layout=C-01 dagre 注入（非缺省线性占位坐标）＋landEdges 真绑定；
//   - C-10 定位编排脏闸贯通：dirty→LOCATE_DIRTY_TOAST 拒绝零切换；非 dirty→flows.get→
//     loadFlow 切换→panToNode 经视口桥（绑定 fake instance 断言 setCenter）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FlowDoc,
  RunStatus,
  RunSummary,
  ScriptEvent,
  StorageInvokeReq,
  ZipImportReq,
  ZipImportRes,
} from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { ConstellaApi } from '../../preload/api';
import { useFlowStore } from '../canvas/stores/flow-store';
import { LOCATE_DIRTY_TOAST, laneMemoryAlertText, locateRun, overBudgetLanes } from '../taskcenter';
import { DEFAULT_SETTINGS, useSettingsStore } from '../settings';
import type { AdoptDraftResult } from '../workshop';
import { createAppRuntime, type AppRuntime } from './app-runtime';
import { createConfirmHost } from './confirm-host';

// ————————————————————————————————————————————
// preload 面 mock（ConstellaApi 同形——按需覆写）
// ————————————————————————————————————————————

interface ApiHarness {
  api: ConstellaApi;
  storageCalls: StorageInvokeReq[];
  setStorage(op: string, impl: (req: StorageInvokeReq) => Promise<unknown>): void;
  spawnCalls: unknown[];
  pushScriptEvent(e: ScriptEvent): void;
  zipImportCalls: ZipImportReq[];
  setZipImport(impl: (payload: ZipImportReq) => Promise<ZipImportRes>): void;
  setEnvSystemInfo(impl: () => Promise<unknown>): void;
}

function makeApi(): ApiHarness {
  const storageCalls: StorageInvokeReq[] = [];
  const spawnCalls: unknown[] = [];
  const scriptEventListeners = new Set<(e: ScriptEvent) => void>();
  const zipImportCalls: ZipImportReq[] = [];
  const storageImpls = new Map<string, (req: StorageInvokeReq) => Promise<unknown>>();
  let zipImportImpl: (payload: ZipImportReq) => Promise<ZipImportRes> = async () => {
    throw new Error('zipImport 未配置');
  };
  let envSystemInfoImpl: () => Promise<unknown> = async () => ({
    os: 'test',
    cpuCores: 1,
    memTotal: 1,
    runtimeVersions: {},
    lanes: [],
  });
  const api = {
    appVersion: async () => ({ version: 'test' }),
    envSystemInfo: async () => envSystemInfoImpl(),
    envCdpProbe: async () => ({ ok: true }),
    shellOpenExternal: async () => undefined,
    dialogOpenFile: async () => ({ path: null }),
    dialogSaveFile: async () => ({ path: null }),
    storageInvoke: async (req: StorageInvokeReq) => {
      storageCalls.push(req);
      const impl = storageImpls.get(req.op);
      if (impl !== undefined) return impl(req);
      return undefined;
    },
    secretSet: async () => ({ ok: true }),
    secretGet: async () => ({ value: null }),
    secretDel: async () => ({ ok: true }),
    runSpawnScript: async (req: unknown) => {
      spawnCalls.push(req);
      return { ok: true, pid: 42 };
    },
    runKillScript: async () => ({ ok: true }),
    cdpCreateSession: async () => ({ laneKey: 'main', port: 9321 }),
    cdpNavigate: async () => ({ ok: true }),
    cdpListSessions: async () => ({ sessions: [] }),
    cdpOpenViewer: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    cronUpsert: async () => ({ ok: true }),
    cronCancel: async () => ({ ok: true }),
    zipExport: async () => ({ file: 'x', count: 0, scripts: [] }),
    zipImport: async (payload: ZipImportReq) => {
      zipImportCalls.push(payload);
      return zipImportImpl(payload);
    },
    cronFired: () => () => undefined,
    runScriptEvent: (fn: (e: ScriptEvent) => void) => {
      scriptEventListeners.add(fn);
      return () => {
        scriptEventListeners.delete(fn);
      };
    },
    appConfirmClose: () => () => undefined,
  } as unknown as ConstellaApi;
  return {
    api,
    storageCalls,
    setStorage: (op, impl) => {
      storageImpls.set(op, impl);
    },
    spawnCalls,
    pushScriptEvent: (e) => {
      for (const fn of [...scriptEventListeners]) fn(e);
    },
    zipImportCalls,
    setZipImport: (impl) => {
      zipImportImpl = impl;
    },
    setEnvSystemInfo: (impl) => {
      envSystemInfoImpl = impl;
    },
  };
}

// ————————————————————————————————————————————
// 公共夹具
// ———————————————————————————————————————————

const runtimes: AppRuntime[] = [];

function makeRuntime(
  opts: { confirm?: (data: unknown) => Promise<boolean>; fetch?: typeof fetch } = {},
): { rt: AppRuntime; h: ApiHarness; notify: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> } {
  const h = makeApi();
  const notify = vi.fn();
  const confirm = vi.fn(opts.confirm ?? (async () => true));
  const rt = createAppRuntime({
    api: h.api,
    notify,
    confirm: (data) => confirm(data) as Promise<boolean>,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
  runtimes.push(rt);
  return { rt, h, notify, confirm };
}

beforeEach(() => {
  useFlowStore.getState().loadFlow(null, { name: '未命名流程', nodes: [], edges: [] });
  // market.baseUrl 装配读面=settingsStore 镜像（产品态由 load() 装载——测试直写镜像）
  useSettingsStore.setState({ values: { ...DEFAULT_SETTINGS, 'market.baseUrl': 'https://market.test' } });
});

afterEach(() => {
  for (const rt of runtimes.splice(0)) rt.dispose();
});

// ————————————————————————————————————————————

describe('confirm 真注入非缺省放行（market 安装链框1）', () => {
  const DETAIL = {
    id: 'pkg-1',
    kind: 'node',
    name: '下载包',
    author: { id: 'u1', name: 'alice' },
    perms: ['网络'],
    downloadCount: 0,
    installCount: 0,
    starCount: 0,
    version: '1.0.0',
    updatedAt: '2026-11-11T00:00:00Z',
    versions: [],
  };

  /** market fetch 面（detail/download/installs/login 伺服＋路径记录） */
  function marketFetch(paths: string[]): typeof fetch {
    return (async (url: RequestInfo | URL): Promise<Response> => {
      const path = String(url).replace('https://market.test', '');
      paths.push(path);
      if (path === '/api/auth/login') {
        return new Response(
          JSON.stringify({ accessToken: 'tok-a', refreshToken: 'tok-r', user: { id: 'u1', email: 'a@b.c', role: 'user' } }),
          { status: 200 },
        );
      }
      if (path === '/api/market/packages/pkg-1') return new Response(JSON.stringify(DETAIL), { status: 200 });
      if (path === '/api/market/packages/pkg-1/download') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (path === '/api/market/packages/pkg-1/installs') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('confirm=false → ImportCancelledError 拒装＋零 download 零导入（缺省放行的反义判别）', async () => {
    const paths: string[] = [];
    const { rt, h, confirm } = makeRuntime({ confirm: async () => false, fetch: marketFetch(paths) });
    await rt.market.browserFaces.auth.login('a@b.c', '12345678');

    await expect(rt.market.install({ id: 'pkg-1', kind: 'node' })).rejects.toThrow('已取消导入');
    // 框1 数据源=匿名 detail（confirm 恰一次、收到 detail 面 InstallConfirmData）
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatchObject({ kind: 'node', name: '下载包', source: 'market', trusted: true });
    // 取消即拒：download/installs 零调用、zip:import 零调用（12.2#2 确认前零下载零导入零计量）
    expect(paths.filter((p) => p.includes('download') || p.includes('installs'))).toHaveLength(0);
    expect(h.zipImportCalls).toHaveLength(0);
  });

  it('confirm=true → 框1 后继续 download（注入面双向判别）', async () => {
    const paths: string[] = [];
    const { rt } = makeRuntime({ confirm: async () => true, fetch: marketFetch(paths) });
    await rt.market.browserFaces.auth.login('a@b.c', '12345678');
    // 成功深链（框2→导入→计量）的链路回归由 market-assembly.spec 覆盖——此处只判注入方向
    await rt.market.install({ id: 'pkg-1', kind: 'node' }).catch(() => undefined);
    expect(paths).toContain('/api/market/packages/pkg-1/download');
  });
});

describe('试跑绑定链（NodeDevAgent←preload run:spawnScript/run:scriptEvent）', () => {
  it('trialRun：spawn 载荷按 trial 元数据展开＋scriptPath 相对约定（assetScriptPath 移交缺省）', async () => {
    const { rt, h } = makeRuntime();
    const adopted: AdoptDraftResult = {
      nodeId: 'n-1',
      type: 'xhs.search',
      name: '小红书搜索',
      trial: {
        lang: 'py',
        entry: 'run',
        scriptPath: 'xhs.search/1.0.0/scripts/xhs_search.py',
        timeoutMs: 15_000,
        retries: 2,
        params: { kw: '星丛' },
      },
    };
    const events: ScriptEvent[] = [];
    const handle = await rt.workshop.nodeDev.trialRun(adopted, {
      params: { limit: 5 },
      onEvent: (e) => events.push(e),
    });
    expect(handle.res).toEqual({ ok: true, pid: 42 });
    expect(h.spawnCalls).toHaveLength(1);
    const req = h.spawnCalls[0] as Record<string, unknown>;
    expect(req.scriptPath).toBe('xhs.search/1.0.0/scripts/xhs_search.py');
    expect(req.lang).toBe('py');
    expect(req.entry).toBe('run');
    expect(req.params).toEqual({ kw: '星丛', limit: 5 });
    expect(req.timeoutMs).toBe(15_000);
    expect(req.retries).toBe(2);
    expect(String(req.nodeRunId)).toMatch(/^trial-.+:n-1$/); // C-03 冻结形

    // scriptEvent 订阅绑定：仅本 run 事件转发＋exit 自动退订
    const nodeRunId = req.nodeRunId as string;
    h.pushScriptEvent({ nodeRunId: 'other:run', kind: 'stdout', chunk: '忽略' });
    h.pushScriptEvent({ nodeRunId, kind: 'stdout', chunk: '第一行' });
    h.pushScriptEvent({ nodeRunId, kind: 'exit', code: 0, ms: 12 });
    h.pushScriptEvent({ nodeRunId, kind: 'stdout', chunk: 'exit 后不应到达' });
    expect(events.map((e) => e.kind)).toEqual(['stdout', 'exit']);
    expect((events[0] as { chunk?: string }).chunk).toBe('第一行');
  });
});

describe('FlowMaterializer 生产构造（dagre layout 注入＋landEdges 真绑定）', () => {
  it('materialize：坐标=dagre 分层（非缺省线性占位）＋画布有边（landEdges）', async () => {
    const { rt, h } = makeRuntime();
    h.setStorage('flows.create', async () => ({ id: 'flow-new-1' }));
    h.setStorage('flows.save', async () => ({ versionId: 'v-1' }));

    const res = await rt.workshop.materializer.materialize({
      id: 'plan-1',
      flowName: '生成流程',
      steps: [
        { src: 'lib', type: 'a.start', name: '开始', params: {} },
        { src: 'new', type: 'b.mid', name: '中间', params: {} },
      ],
    });
    expect(res.ok).toBe(true);
    const { nodes, edges } = useFlowStore.getState();
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1); // landEdges 真绑定（T5-04→T6-17 装配不变量）
    // dagre LR 两步链：rank0 左上 (0,0)、rank1 (192+80,0)——缺省线性占位为 (40,200)/(290,200)
    const pos = nodes.map((n) => n.position);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 272, y: 0 });
    // 版本标记（02 §7.1 label 枚举——落盘同源）
    const save = h.storageCalls.find((c) => c.op === 'flows.save');
    expect(save?.args).toMatchObject({ id: 'flow-new-1', name: '生成流程', label: '流程工坊生成' });
  });
});

describe('confirm-host FIFO 串行（返工 MINOR-2——≥3 并发零悬挂）', () => {
  const dataOf = (name: string) =>
    ({
      kind: 'node',
      name,
      version: '1.0.0',
      author: '',
      source: 'market',
      trusted: true,
      perms: [],
      nodes: [],
      noScript: [],
      scriptFiles: [],
    }) as Parameters<ReturnType<typeof createConfirmHost>['confirm']>[0];

  it('并发 3 请求：FIFO 依序展示→依序 settle，三 promise 全决出、队尾清空（无一悬挂）', async () => {
    const host = createConfirmHost();
    const displayed: string[] = [];
    host.subscribe(() => {
      const cur = host.snapshot();
      if (cur !== null) displayed.push(cur.data.name);
    });
    const p1 = host.confirm(dataOf('包一'));
    const p2 = host.confirm(dataOf('包二'));
    const p3 = host.confirm(dataOf('包三'));
    expect(host.snapshot()?.data.name).toBe('包一'); // 队首上架（一次一框）

    host.snapshot()!.resolve(true);
    await Promise.resolve();
    expect(host.snapshot()?.data.name).toBe('包二'); // 决出即推进下一项
    host.snapshot()!.resolve(false);
    await Promise.resolve();
    expect(host.snapshot()?.data.name).toBe('包三');
    host.snapshot()!.resolve(true);
    await Promise.resolve();

    expect(await p1).toBe(true);
    expect(await p2).toBe(false);
    expect(await p3).toBe(true); // 三 promise 全 settle（初版猴补丁在 ≥3 并发时 p2 悬挂——此为判别）
    expect(displayed).toEqual(['包一', '包二', '包三']); // 每项都真展示过
    expect(host.snapshot()).toBeNull(); // 队清空
  });
});

describe('autoSave 排程链＋Ctrl+S 保存编排（PM 补接线——T1-08/T4-13 消费点）', () => {
  it('autoSave on→markDirty→800ms 防抖静默保存（label=自动保存）＋门控关即拒排程', async () => {
    vi.useFakeTimers();
    try {
      const { rt, h } = makeRuntime();
      h.setStorage('flows.create', async () => ({ id: 'flow-auto-1' }));
      h.setStorage('flows.save', async () => ({ versionId: 'v-auto-1' }));
      useSettingsStore.setState({ values: { ...useSettingsStore.getState().values, autoSave: true } });

      useFlowStore.getState().loadFlow(null, { name: '自动保存流程', nodes: [], edges: [] });
      useFlowStore.getState().markDirty(); // 脏标记→防抖窗起跳
      await vi.advanceTimersByTimeAsync(800);
      const saves = h.storageCalls.filter((c) => c.op === 'flows.save');
      expect(saves).toHaveLength(1);
      expect(saves[0]!.args).toMatchObject({ name: '自动保存流程', label: '自动保存' }); // silent 链
      expect(useFlowStore.getState().dirty).toBe(false); // onSaved→markSaved 基线复位
      expect(h.storageCalls.some((c) => c.op === 'flows.create')).toBe(true); // 无 id 画布首存建流程

      // 门控关：settings.autoSave=false → schedule 即拒（无新保存）
      useSettingsStore.setState({ values: { ...useSettingsStore.getState().values, autoSave: false } });
      useFlowStore.getState().markDirty();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(h.storageCalls.filter((c) => c.op === 'flows.save')).toHaveLength(1);
      void rt;
    } finally {
      vi.useRealTimers();
    }
  });

  it('save.manual（Ctrl+S 编排本体）：dirty→doSave(manual)＋「已保存到本地」；非 dirty no-op', async () => {
    const { rt, h, notify } = makeRuntime();
    h.setStorage('flows.create', async () => ({ id: 'flow-manual-1' }));
    h.setStorage('flows.save', async () => ({ versionId: 'v-manual-1' }));
    useFlowStore.getState().loadFlow(null, { name: '手动流程', nodes: [], edges: [] });

    rt.save.manual(); // 非 dirty——零调用零 toast
    await vi.waitFor(() => expect(h.storageCalls.filter((c) => c.op === 'flows.save')).toHaveLength(0));
    expect(notify).not.toHaveBeenCalled();

    useFlowStore.getState().markDirty();
    rt.save.manual();
    await vi.waitFor(() => {
      expect(h.storageCalls.filter((c) => c.op === 'flows.save')).toHaveLength(1);
    });
    expect(h.storageCalls.find((c) => c.op === 'flows.save')?.args).toMatchObject({ label: '手动保存' });
    expect(notify).toHaveBeenCalledWith('ok', '已保存到本地'); // demo L1643 逐字
    expect(useFlowStore.getState().dirty).toBe(false);
  });
});

describe('SavePipeline 生产接线（T6-16——C-13 保存链应用壳装配，mock IPC 边界）', () => {
  const TS_CODE = 'export const PARAMS = { query: "咖啡" };\nexport async function run(ctx) { return { items: [] }; }\n';

  it('rt.nodeEditor.savePipeline：真 assembleNodePackage 产物 bytes 直入 zip:import（inspect→commit）＋注册表/定义库/节点库三面绑定', async () => {
    const { rt, h } = makeRuntime();
    const phases: string[] = [];
    let inspectByteLength = 0;
    h.setZipImport(async (payload) => {
      phases.push(payload.phase);
      if (payload.phase === 'inspect') {
        inspectByteLength = (payload as { bytes: Uint8Array }).bytes.byteLength;
        return {
          nodes: [],
          noScript: [],
          categories: [],
          manifest: {
            kind: 'node',
            name: '取数',
            version: '1.0.0',
            scripts: { 'demo.fetcher': { file: 'scripts/demo_fetcher.ts', lang: 'ts', entry: 'run' } },
          },
          token: 'tok-save-1',
        };
      }
      return {
        nodes: [{ id: 'n-imp-1', type: 'demo.fetcher', name: '取数', position: { x: 0, y: 0 }, params: {} }],
        noScript: [],
      };
    });

    const report = await rt.nodeEditor.savePipeline.saveToLibrary(
      {
        type: 'demo.fetcher',
        kind: 'custom',
        meta: { name: '取数', icon: '🔧', category: '数据', source: 'zip' },
        ports: { ins: ['in'], outs: [{ id: 'out', label: '完成' }] },
        paramsSchema: [{ k: 'query', t: 'text', required: true, default: '咖啡' }],
        exec: null,
        policy: null,
        io: null,
        inner: null,
        version: '1.0.0',
        packageVersion: '1.0.0',
      },
      { scripts: { 'scripts/demo_fetcher.ts': TS_CODE }, config: {} },
    );
    expect(report).toEqual({ ok: true });
    // 产物=真 workshop assembleNodePackage（bytes 直入既有 zip:import 通道恰两段——24 通道零新增）
    expect(phases).toEqual(['inspect', 'commit']);
    expect(inspectByteLength).toBeGreaterThan(100);
    // ① 注册表绑定（C-05 register——source 恒改写 manual＋N4 exec 定型 ts）
    expect(rt.registry.get('demo.fetcher')?.meta.source).toBe('manual');
    expect(rt.registry.get('demo.fetcher')?.exec).toMatchObject({ lang: 'ts', file: 'scripts/demo_fetcher.ts', entry: 'run' });
    // ② 定义库绑定（IpcDefinitionStore.upsertDefinition→definitions.upsert op）
    expect(h.storageCalls.some((c) => c.op === 'definitions.upsert')).toBe(true);
    // ③ 节点库绑定（library.upsert 恰一——T6-19 单写去重：显式段已去，唯一写=链内 ImportOrchestrator ⑥段）
    expect(h.storageCalls.filter((c) => c.op === 'library.upsert')).toHaveLength(1);
  });
});

describe('lane 内存告警数据面复跑（T6-16——T6-11 mock 解除复跑：env:systemInfo lanes 真数据）', () => {
  it('boot→env:systemInfo lanes→taskCenterDeps.laneMemories 真数据可达（超预算行经 overBudgetLanes 真形告警）', async () => {
    const { rt, h } = makeRuntime();
    h.setStorage('definitions.loadAll', async () => []);
    // 真数据面形：main domain-channels lanes=deps.laneMemory()（production-assembly→CdpSessionManager
    // .laneMemory 聚合）；renderer 经既有 env:systemInfo 通道（24 冻结面）轮询——mock 仅 IPC 边界
    h.setEnvSystemInfo(async () => ({
      os: 'test',
      cpuCores: 1,
      memTotal: 1,
      runtimeVersions: {},
      lanes: [
        { laneKey: 'main', label: '主车道', workingSetBytes: 160 * 1024 * 1024 }, // 超预算（>150MB）
        { laneKey: 'side', label: '旁车道', workingSetBytes: 20 * 1024 * 1024 }, // 预算内（不告警）
      ],
    }));

    await rt.boot(); // 启动序首拍 refreshBackground（10s 轮询=POLL_MS）
    await vi.waitFor(() => {
      expect(rt.taskCenterDeps.laneMemories!()).toHaveLength(2); // 真数据落地装配位 getter
    });
    const over = overBudgetLanes(rt.taskCenterDeps.laneMemories!());
    expect(over.map((l) => l.laneKey)).toEqual(['main']); // 预算内 lane 不告警
    expect(laneMemoryAlertText(over[0]!)).toBe('「主车道」内存 160MB 超预算（150MB）'); // §8① 文案真形
  });
});

describe('C-10 定位编排脏闸贯通（locate 六原语真接线）', () => {
  const target = { runId: 'r-1', flowId: 'flow-9', focusNodeId: 'n-target' };

  it('dirty → LOCATE_DIRTY_TOAST 拒绝＋零切换（flows.get 零调用）', () => {
    const { rt, h, notify } = makeRuntime();
    useFlowStore.getState().markDirty();
    expect(locateRun(rt.taskCenterDeps.locate!, target)).toBe(false);
    expect(notify).toHaveBeenCalledWith('err', LOCATE_DIRTY_TOAST); // demo L2796 逐字
    expect(h.storageCalls.some((c) => c.op === 'flows.get')).toBe(false);
  });

  it('非 dirty → flows.get→loadFlow 切换→panToNode 经视口桥（fake instance setCenter）', async () => {
    const { rt, h } = makeRuntime();
    h.setStorage('flows.get', async (req) => ({
      name: '目标流程',
      nodes: [
        { id: 'n-target', type: 'a.start', name: '焦点', position: { x: 300, y: 120 }, params: {} },
      ],
      edges: [],
    }));
    const setCenter = vi.fn();
    const getZoom = vi.fn(() => 1);
    rt.bindViewport({
      setCenter,
      setViewport: vi.fn(),
      getZoom,
      fitView: vi.fn(),
      screenToFlowPosition: (p) => p,
    });

    expect(locateRun(rt.taskCenterDeps.locate!, target)).toBe(true);
    await vi.waitFor(() => {
      expect(useFlowStore.getState().activeFlowId).toBe('flow-9'); // 切到目标流程
    });
    // panToNode：等 switchFlow 装载后经视口桥（demo L1608 居中偏移 96/40＋保持 zoom）
    await vi.waitFor(() => {
      expect(setCenter).toHaveBeenCalledWith(300 + 96, 120 + 40, { zoom: 1, duration: 200 });
    });
    expect(h.storageCalls.some((c) => c.op === 'flows.get' && (c.args as { id: string }).id === 'flow-9')).toBe(true);
  });
});

// ————————————————————————————————————————————
// 活行入表/收尾刷新装配（T6-19 ②——A2 线遗留1；mock IPC 边界两例）
// runs-source 注入位设计消费面：listRuns=同步快照（boot 冷装载 runs.list 灌入）＋活跃集变化
// （runOpened/runClosed——RunEngine 事件管线同点镜像写入）→ runs.list 重读＋onRunsChanged
// 通知（AppShell 连接器→TaskCenter source.refresh）。
// ————————————————————————————————————————————

describe('活行入表/收尾刷新装配（T6-19——taskCenterDeps.listRuns 冷装载＋RunEngine 事件→runs$ 驱动）', () => {
  const TRIGGER_DEF: NodeDefinition = {
    type: 'trigger.manual',
    kind: 'builtin',
    meta: { name: '手动触发', icon: '⚡', category: '触发' },
    ports: { ins: [], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
  const CUSTOM_DEF: NodeDefinition = {
    type: 'custom.x',
    kind: 'custom',
    meta: { name: '脚本节点', icon: '🔧', category: '数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: { lang: 'ts', file: 'scripts/x.ts', entry: 'run' },
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
  const FLOW: FlowDoc = {
    id: 'f-1',
    name: '装配流程',
    nodes: [
      { id: 't1', type: 'trigger.manual', name: '触发', position: { x: 0, y: 0 }, params: {} },
      { id: 'x1', type: 'custom.x', name: '脚本', position: { x: 200, y: 0 }, params: {} },
    ],
    edges: [{ id: 'e0', from: ['t1', 'out'], to: ['x1', 'in'] }],
  };

  interface Rec {
    id: string;
    flowId: string;
    name: string;
    status: RunStatus;
    t0: number;
    t1: number | null;
    aborted: number;
    failed: number;
    total: number;
    skips: unknown[];
    createdAt: number;
  }

  /** runs 域 mock（runs.list/create/finish 内存镜像＋flows.get/双写 op——startRun 全链走通） */
  function wireRunOps(h: ReturnType<typeof makeApi>, preexisting = true): Map<string, Rec> {
    h.setStorage('definitions.loadAll', async () => []); // boot 装载序（registry.loadAll）
    const recs = new Map<string, Rec>();
    if (preexisting) {
      recs.set('r-pre', { id: 'r-pre', flowId: 'f-1', name: '装配流程', status: 'done', t0: 1, t1: 2, aborted: 0, failed: 0, total: 2, skips: [], createdAt: 1 });
    }
    let seq = 0;
    h.setStorage('runs.list', async () => ({ items: [...recs.values()] as RunSummary[] }));
    h.setStorage('runs.create', async (req) => {
      const { flowId, name } = (req as { op: 'runs.create'; args: { flowId: string; name: string } }).args;
      const id = `r${++seq}`;
      recs.set(id, { id, flowId, name, status: 'running', t0: Date.now(), t1: null, aborted: 0, failed: 0, total: 0, skips: [], createdAt: Date.now() });
      return { id };
    });
    h.setStorage('runs.finish', async (req) => {
      const a = (req as { op: 'runs.finish'; args: { runId: string; status: RunStatus; t1: number } }).args;
      const rec = recs.get(a.runId);
      if (rec !== undefined) rec.status = a.status;
      if (rec !== undefined) rec.t1 = a.t1;
      return undefined;
    });
    h.setStorage('flows.get', async () => FLOW);
    for (const op of ['runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append']) h.setStorage(op, async () => undefined);
    return recs;
  }

  it('冷装载：boot→runs.list→taskCenterDeps.listRuns 同步快照（真 runs.list 数据面——A2 遗留1：() => [] 空集已替换）', async () => {
    const { rt, h } = makeRuntime();
    wireRunOps(h);
    expect(rt.taskCenterDeps.listRuns()).toHaveLength(0); // boot 前=空快照（Provider 构造期冷面）
    await rt.boot();
    await vi.waitFor(() => {
      expect(rt.taskCenterDeps.listRuns()).toHaveLength(1);
    });
    expect(rt.taskCenterDeps.listRuns()[0]).toMatchObject({ runId: 'r-pre', flowId: 'f-1', flowName: '装配流程', status: 'done' });
  });

  it('活跃集变化→runs.list 重读＋onRunsChanged 通知：startRun 活行入快照（running）→abortRun 收尾翻转（aborted）', async () => {
    const { rt, h } = makeRuntime();
    wireRunOps(h, false);
    await rt.boot();
    rt.registry.register(TRIGGER_DEF); // boot loadAll 全量替换后注册（装载前注册会被 reset 清掉）
    rt.registry.register(CUSTOM_DEF);
    const changed = vi.fn();
    const unsub = rt.onRunsChanged(changed);

    const handle = await rt.engine.startRun('f-1'); // spawn 挂起（无脚本事件——节点 running 到 kill）
    expect(handle).not.toBeNull();
    await vi.waitFor(() => {
      // 活行入表：runs.create 落库＋runOpened 镜像→重读→快照含新 running 行
      expect(rt.taskCenterDeps.listRuns().some((r) => r.runId === handle!.runId && r.status === 'running')).toBe(true);
    });
    expect(changed).toHaveBeenCalled(); // 通知面（AppShell 连接器→source.refresh 的驱动源）

    rt.engine.abortRun(handle!.runId); // ■ 终止（收尾=drain→runs.finish(aborted)→runClosed 镜像→重读）
    await vi.waitFor(() => {
      expect(rt.taskCenterDeps.listRuns().find((r) => r.runId === handle!.runId)?.status).toBe('aborted');
    });
    unsub();
  });
});
