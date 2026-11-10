// app-runtime —— 产品壳运行时装配（T6-17；壳=唯一合法跨模块编排点，P-3 各模块间仍无
// import 边——本文件是装配层：对 storage/node-registry/definition/run/canvas/workshop/
// market/taskcenter/cdp/settings 的消费组合，方向恒为壳→模块）。
//
// 生产构造点（卡面①②）：
//   - FlowMaterializer：canvas=createCanvasSink（T3-08 导出面）、landEdges=createLandEdgesBinder
//     （T5-11 真绑定）、layout=**C-01 dagre LayoutEngine 注入**（T5-04 缺省线性占位就此替换）、
//     getDefinition=注册表 get；createAndSwitch 链走既有 market-assembly（wireRealFlowSwitcher
//     库 id 消费）；
//   - NodeDevAgent：spawnScript/subscribeScriptEvent=preload run:spawnScript/run:scriptEvent 直调
//     绑定（B-5 试跑链）、locateNode=panToNode、openDrawer=canvasStore drawer 打开、
//     assetScriptPath=⚠ 相对约定缺省（userData/node-types 绝对基址在 24 通道冻结面内无 renderer
//     可达暴露〔env:systemInfo 无路径字段〕——main resolveScriptPath 本就按 nodeTypesRoot 解析
//     相对形、功能等价；绝对化登记移交，见卡报告）；
//   - RunEngine 生产实例（TaskCenterDeps.abortRun 数据源＋logs$=onRunLog 单点）＋
//     RunTransport=preload 通道面映射（cron:fired 订阅/spawnScript/scriptEvent/cdp 会话/
//     killScript/destroyRun/cdpProbe——T4-14 白名单零新通道）。
// 视口桥：CanvasChrome onInit（ReactFlowProps 透传面）→结构化 ViewportInstanceFace 持有
// （panToNode/fitView/viewportCenter——画布库 import 收窄在 canvas/，装配层零直接 import）。
import type { LaneMemory, LogLevel } from '@constella/shared/ipc';
import type { ConstellaApi } from '../../preload/api';
import {
  AutoSaveScheduler,
  createSaveOrchestrator,
  IpcDefinitionStore,
  createStorageClient,
  type SaveOrchestrator,
  type StorageClient,
} from '../storage';
import { createNodeRegistry, type NodeRegistry } from '../node-registry';
import { validateDefinition } from '../definition';
import { createRunEngine, useRunStore, type RunEngine, type RunTransport } from '../run';
import { createCanvasSink } from '../canvas/sink/canvas-sink';
import { useCanvasStore } from '../canvas/canvas-store';
import { useFlowStore } from '../canvas/stores/flow-store';
import { layout as dagreLayout } from '../canvas/layout/layout-engine';
import {
  createFlowMaterializer,
  createFlowPlanner,
  createIntentRouter,
  createLlmGateway,
  createNodeDevAgent,
  type FlowMaterializer,
  type FlowPlanner,
  type IntentRouter,
  type LlmGateway,
  type NodeDevAgent,
} from '../workshop';
import { createImportOrchestrator } from '../zip/import-orchestrator';
import type { InstallConfirmData } from '../market/install-confirm';
import { createLandEdgesBinder } from './land-edges';
import { createMarketAssembly, type MarketAssembly } from './market-assembly';
import { createLogReplayService, createReplayStorage, type LogReplayService } from '../taskcenter/log-replay-service';
import { createLogsBus, type LogsBus } from '../taskcenter/runs-bus';
import type { TaskCenterDeps } from '../taskcenter/task-center-context';
import { useSettingsStore } from '../settings';
import { createCdpSessionsModel, createLaneProjector, createPreloadCdpChannels } from '../cdp';
import { useShellStore } from './shell-store';

// ————————————————————————————————————————————
// 视口桥（ReactFlow instance 结构化持有——P-3：画布库 import 只在 canvas/）
// ————————————————————————————————————————————

/** ReactFlow instance 结构子集（ViewportController 同语义——setCenter/fitView/投影） */
export interface ViewportInstanceFace {
  setCenter(x: number, y: number, opts: { zoom: number; duration?: number }): unknown;
  setViewport(vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }): unknown;
  getZoom(): number;
  fitView(opts?: { padding?: number; duration?: number }): unknown;
  screenToFlowPosition(pos: { x: number; y: number }): { x: number; y: number };
}

/** 视口原语（locate 六原语之 panToNode/fitView＋CanvasSink viewportCenter 数据源） */
export interface ViewportFace {
  panToNode(nodeId: string): void;
  fitView(): void;
  /** 屏幕中心世界坐标（WaterfallPlacer/导入链落点基准） */
  viewportCenter(): { x: number; y: number };
}

interface ViewportHolder {
  face: ViewportFace;
  bind(instance: ViewportInstanceFace | null): void;
}

/** 视口持有器：instance 未绑（React 未挂载/测试）时 no-op＋保守中心（demo L1597 复位位） */
export function createViewportHolder(): ViewportHolder {
  let inst: ViewportInstanceFace | null = null;
  return {
    face: {
      panToNode(nodeId) {
        if (inst === null) return;
        const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
        if (node === undefined) return;
        // ViewportController.panToNode 同语义：居中（保持 zoom）＋选中＋闪烁重放
        void inst.setCenter(node.position.x + 96, node.position.y + 40, { zoom: inst.getZoom(), duration: 200 });
        useCanvasStore.getState().setSelection(nodeId);
        if (typeof document === 'undefined') return; // node 环境无 DOM（闪烁为纯视觉面）
        const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .cn-node`);
        if (el) {
          el.classList.remove('cn-node--flash');
          void (el as HTMLElement).offsetWidth; // 重启动画
          el.classList.add('cn-node--flash');
        }
      },
      fitView() {
        if (inst === null) return;
        if (useFlowStore.getState().nodes.length === 0) {
          void inst.setViewport({ x: 60, y: 40, zoom: 1 });
          return;
        }
        void inst.fitView({ padding: 0.15, duration: 200 });
      },
      viewportCenter() {
        if (inst === null) return { x: 60, y: 40 };
        return inst.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      },
    },
    bind(instance) {
      inst = instance;
    },
  };
}

// ————————————————————————————————————————————
// 运行时装配
// ————————————————————————————————————————————

export interface AppRuntimeDeps {
  /** preload 白名单面（window.constella——生产直传；测试 mock 同形） */
  api: ConstellaApi;
  /** toast 面（壳层队列——level 语义由宿主呈现） */
  notify(level: LogLevel, msg: string): void;
  /** InstallConfirm 真注入（confirm-host——必填＝结构性保证非缺省放行 `(async()=>true)`） */
  confirm(data: InstallConfirmData): Promise<boolean>;
  /** 未登录引导（UNAUTHORIZED→开广场〔内含 LoginDialog〕） */
  onUnauthorized?(): void;
  /** fetch 注入（生产缺省=window.fetch；测试 fake） */
  fetch?: typeof fetch;
  log?: (...args: unknown[]) => void;
}

export interface AppRuntime {
  storage: StorageClient;
  registry: NodeRegistry;
  engine: RunEngine;
  market: MarketAssembly;
  workshop: {
    llm: LlmGateway;
    router: IntentRouter;
    planner: FlowPlanner;
    nodeDev: NodeDevAgent;
    materializer: FlowMaterializer;
  };
  /** 保存编排（T1-08/T4-13 消费点——PM 2026-11-11 裁定补接线） */
  save: {
    orchestrator: SaveOrchestrator;
    /** AutoSaveScheduler 实例（dispatcher deps.scheduler 门控面——settings.autoSave 真实生效） */
    scheduler: AutoSaveScheduler;
    /** 手动保存编排（Ctrl+S——CanvasChrome onSave 注入位；dirty 守卫＋label=手动保存＋toast） */
    manual(): void;
  };
  logsBus: LogsBus;
  replay: LogReplayService;
  taskCenterDeps: TaskCenterDeps;
  viewport: ViewportFace;
  /** 视口 instance 绑定（CanvasChrome onInit→此处；卸载传 null） */
  bindViewport(instance: ViewportInstanceFace | null): void;
  /** 启动装载序：注册表装载（T1-10 先 register 后 markBroken）＋后台数据面首拍 */
  boot(): Promise<void>;
  /** 生命周期收口（engine/轮询/订阅/防抖排程） */
  dispose(): void;
}

/** 后台数据面轮询间隔（lane 内存快照＋cdp lanes 投影——env:systemInfo/cdp:listSessions） */
const POLL_MS = 10_000;

export function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const { api, notify } = deps;
  const log = deps.log ?? ((...args: unknown[]) => undefined);

  // ———— 存储面（C-06 storageClient——preload storage:invoke 桥） ————
  const storage = createStorageClient({ invoke: (req) => api.storageInvoke(req) });

  // ———— 注册表（C-05——boot() 装载序：先 register 后 markBroken，T1-10） ————
  const registry = createNodeRegistry();

  // ———— 视口桥（CanvasChrome onInit 绑定） ————
  const viewportHolder = createViewportHolder();
  const viewportCenter = (): { x: number; y: number } => viewportHolder.face.viewportCenter();

  // ———— RunEngine 生产实例（C-03——abortRun/onRunLog 源；transport=preload 通道面映射） ————
  const transport: RunTransport = {
    onCronFired: (fn) => api.cronFired((e) => fn({ flowId: e.flowId })),
    spawnScript: (req) => api.runSpawnScript(req),
    onScriptEvent: (fn) => api.runScriptEvent(fn),
    cdpCreateSession: (req) => api.cdpCreateSession(req),
    cdpNavigate: (req) => api.cdpNavigate(req),
    killScript: (req) => api.runKillScript(req),
    cdpDestroyRun: (req) => api.cdpDestroyRun(req),
    envCdpProbe: (req) => api.envCdpProbe(req),
  };
  const engine = createRunEngine({
    storage,
    registry,
    guardDirty: (flowId) => useFlowStore.getState().guardDirty(`run:${flowId}`),
    transport,
    notify,
  });

  // ———— 保存编排（T1-08 SaveOrchestrator＋AutoSaveScheduler——T4-13/T6-12 消费点补接线） ————
  const saveOrchestrator = createSaveOrchestrator(storage);
  const autoSaveScheduler = new AutoSaveScheduler({
    isEnabled: () => useSettingsStore.getState().values.autoSave,
    // silent 链（label=自动保存；防抖路径保存错误由 scheduler 内吞 console.error）
    onSave: () => saveOrchestrator.doSave(true, useFlowStore.getState().createSaveContext()),
  });
  // markDirty 挂点（P-3 注入位装配近似——flowStore 无 onChange 面）：订阅 set，dirty 在场即
  // schedule() 重置防抖窗（多次脏标记合并一次保存，demo L1299-1311）；干净态 set（loadFlow/
  // markSaved 复位）不排程。
  const unsubFlowChanges = useFlowStore.subscribe((s) => {
    if (s.dirty) autoSaveScheduler.schedule();
  });
  const saveManual = (): void => {
    const st = useFlowStore.getState();
    if (!st.dirty) return; // EditorKeyboard Ctrl+S 已含 dirty 门——直调面同守卫（demo 保存钮 dirty 门控同源）
    void saveOrchestrator
      .doSave(false, st.createSaveContext())
      .then(() => {
        autoSaveScheduler.cancel(); // 冗余防抖排程清空（手动已存——markSaved 基线复位，pending 触发只会多打一版「自动保存」）
        notify('ok', '已保存到本地'); // demo L1643 逐字
      })
      .catch((err) => notify('err', `保存失败：${err instanceof Error ? err.message : String(err)}`));
  };

  // ———— 市场装配（T5-11——confirm 真注入〔confirm-host〕＋全局注册表实例） ————
  const market = createMarketAssembly({
    bridge: {
      storageInvoke: (req) => api.storageInvoke(req),
      zipImport: (payload) => api.zipImport(payload),
      zipExport: (payload) => api.zipExport(payload),
      dialogSaveFile: (payload) => api.dialogSaveFile(payload),
      secret: {
        set: (req) => api.secretSet(req),
        get: (req) => api.secretGet(req),
        del: (req) => api.secretDel(req),
      },
    },
    baseUrl: () => useSettingsStore.getState().values['market.baseUrl'],
    viewportCenter,
    notify,
    confirm: deps.confirm,
    ...(deps.onUnauthorized !== undefined ? { onUnauthorized: deps.onUnauthorized } : {}),
    registry,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    log,
  });

  // ———— 工坊装配（C-07 五件——LlmGateway/IntentRouter/FlowPlanner/NodeDevAgent/FlowMaterializer） ————
  const llm = createLlmGateway({ storage, secrets: { get: (req) => api.secretGet(req) } });
  const router = createIntentRouter({ llm });
  const planner = createFlowPlanner({
    llm,
    libLister: async () => (await storage.invoke('library.list', undefined)).items,
    catalog: () => registry.list().map((d) => d.type),
    // 🏬plazaQuery 不注入＝缺省同离线（仅查 📚）：MarketListItem 无 type 字段、按类型精确查询
    // 不可达——广场来源接入登记移交（卡报告缺宿主/移交表）
  });
  // 现场开发导入链（C-08 bytes 直入——adoptDraft 半段唯一写入通道；与 market 链共享注册表/桥面）
  const devImporter = createImportOrchestrator({
    bridge: { zipImport: (payload) => api.zipImport(payload), storageInvoke: (req) => api.storageInvoke(req) },
    registry: { has: (t) => registry.has(t), register: (doc) => registry.register(doc) },
    validate: validateDefinition,
    canvasSink: createCanvasSink({ viewportCenter }),
    viewportCenter,
    derivePerms: (cats) => registry.derivePerms(cats),
    notify,
    log,
  });
  const nodeDev = createNodeDevAgent({
    llm,
    validate: validateDefinition,
    hasType: (t) => registry.has(t),
    importer: devImporter,
    locateNode: (nodeId) => viewportHolder.face.panToNode(nodeId),
    openDrawer: (nodeId) => useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId }),
    // assetScriptPath 缺省=相对约定 node-types/<type>/<pkgVersion>/<file>（main resolveScriptPath
    // 按 nodeTypesRoot 解析、功能等价；绝对基址无 renderer 可达面——登记移交）
    spawnScript: (req) => api.runSpawnScript(req),
    subscribeScriptEvent: (listener) => api.runScriptEvent(listener),
  });
  const materializer = createFlowMaterializer({
    canvas: createCanvasSink({ viewportCenter }),
    storage,
    layout: (nodes, edges) => dagreLayout([...nodes], [...edges]), // C-01 dagre 注入（缺省线性占位替换；readonly→可变副本）
    landEdges: createLandEdgesBinder(),
    getDefinition: (t) => registry.get(t),
  });

  // ———— 日志双路（logs$ Bus＝engine.onRunLog 单点 publish）＋重放服务（启动序 restoreRunState） ————
  const logsBus = createLogsBus((fn) => engine.onRunLog(fn));
  const replay = createLogReplayService({
    storage: createReplayStorage(storage),
    restoreMirror: (flowId, runId, statuses) => useRunStore.getState().restoreRun(flowId, runId, statuses),
  });

  // ———— C-04 管理面投影（LaneProjector.portsOf 数据源——refresh 轮询驱动） ————
  const cdpModel = createCdpSessionsModel(createPreloadCdpChannels(api));
  const laneProjector = createLaneProjector(cdpModel);

  // ———— C-10 定位编排（locate 六原语——脏闸→切流程→statuses 还原→panToNode/fitView） ————
  // switchFlow 异步装载（flows.get）与 locateRun 同步序的衔接：在途切换登记——panToNode 等
  // 装载落地再经视口桥（demo L2795-2797 renderNodes 后 panToNode 的 async 等价）。
  const switchesInFlight = new Map<string, Promise<void>>();
  const locate: TaskCenterDeps['locate'] = {
    isDirty: () => useFlowStore.getState().dirty,
    switchFlow(flowId) {
      // 既有流程切换：flows.get→loadFlow（locateRun 入口已做脏闸——此处不重复拦）
      const p = storage
        .invoke('flows.get', { id: flowId })
        .then((doc) => {
          useFlowStore.getState().loadFlow(flowId, doc);
        })
        .catch((err) => {
          notify('err', `切换流程失败（${flowId}）`);
          log('locate switchFlow failed:', err);
        })
        .finally(() => {
          switchesInFlight.delete(flowId);
        });
      switchesInFlight.set(flowId, p);
    },
    restoreStatuses(_flowId) {
      // A-6.5 双写还原：statuses 画面=RunStatusBinding 对 runStore.lastRunOfFlow[activeFlowId] 的
      // 响应式只读投影——镜像由启动序 restoreRun 重建/RunEngine 事件同点维护，切流程后自动重
      // 派生，此处无额外动作（no-op 编排点；语义注见 locate-run.ts）
    },
    panToNode(flowId, nodeId) {
      const pending = switchesInFlight.get(flowId);
      const pan = (): void => viewportHolder.face.panToNode(nodeId);
      if (pending !== undefined) void pending.then(pan);
      else pan();
    },
    fitView: () => viewportHolder.face.fitView(),
    toast: (level, msg) => notify(level, msg),
  };

  // ———— lane 内存快照（env:systemInfo lanes——TaskNotices 预算告警数据面，轮询缓存） ————
  let laneMemories: readonly LaneMemory[] = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const refreshBackground = (): void => {
    void api
      .envSystemInfo()
      .then((res) => {
        laneMemories = res.lanes;
      })
      .catch(() => {
        /* 通道不可达——保持上次快照（不阻塞） */
      });
    for (const runId of Object.values(useRunStore.getState().activeRunOfFlow)) {
      void cdpModel.refresh(runId).catch(() => {
        /* 无会话/通道不可达——投影保持 []（in-band 语义） */
      });
    }
  };

  let onlineHintUnsub: (() => void) | null = null;

  return {
    storage,
    registry,
    engine,
    market,
    workshop: { llm, router, planner, nodeDev, materializer },
    save: { orchestrator: saveOrchestrator, scheduler: autoSaveScheduler, manual: saveManual },
    logsBus,
    replay,
    viewport: viewportHolder.face,
    bindViewport: (instance) => viewportHolder.bind(instance),
    taskCenterDeps: {
      // 冷装载=空集：启动序 restoreRunState→setRuns 驱动（T6-11 装配形态——AppShell Restore 连接器）
      listRuns: () => [],
      runStore: useRunStore,
      portsOf: (runId) => laneProjector.portsOf(runId),
      nodeName: (flowId, nodeId) => replay.nodeName(flowId, nodeId),
      abortRun: (runId) => engine.abortRun(runId),
      // onGoto 回退位：locate 已注入时 Provider 内 createGotoHandler 接管（此键不被调用）
      onGoto: () => undefined,
      activeFlowId: () => useFlowStore.getState().activeFlowId,
      // A-1.4 全局 Esc 层级序「CDP 查看窗→抽屉→任务中心→弹窗」：上层（抽屉/弹窗族）在场=
      // false（任务中心不应答）。CDP 查看窗挂载不在本卡（登记移交）——其开合位接入后在此补查。
      escGate: () =>
        useCanvasStore.getState().drawer === null &&
        !useShellStore.getState().marketOpen &&
        !useShellStore.getState().settingsOpen &&
        !useShellStore.getState().confirmPending,
      logs: logsBus,
      locate,
      laneMemories: () => laneMemories,
    },
    async boot() {
      const report = await registry.loadAll(new IpcDefinitionStore(storage), validateDefinition);
      log(`[app-runtime] registry loaded: total=${report.total} loaded=${report.loaded} broken=${report.broken.length}`);
      refreshBackground();
      if (pollTimer === null) pollTimer = setInterval(refreshBackground, POLL_MS);
      onlineHintUnsub = market.wireOnlineHint();
    },
    dispose() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      onlineHintUnsub?.();
      onlineHintUnsub = null;
      unsubFlowChanges();
      autoSaveScheduler.cancel();
      engine.dispose();
      logsBus.dispose();
    },
  };
}
