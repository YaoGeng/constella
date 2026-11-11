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
  assembleNodePackage,
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
import { createSavePipeline } from '../node-editor';
import type { NodeEditorSavePipeline } from '../node-editor';
import { createImportOrchestrator } from '../zip/import-orchestrator';
import type { InstallConfirmData } from '../market/install-confirm';
import { createLandEdgesBinder } from './land-edges';
import { createMarketAssembly, type MarketAssembly } from './market-assembly';
import { createLogReplayService, createReplayStorage, type LogReplayService } from '../taskcenter/log-replay-service';
import { createLogsBus, type LogsBus } from '../taskcenter/runs-bus';
import { runRecordFromSummary, type TaskRunRecord } from '../taskcenter/run-row';
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
  /** C-13 手动编辑器保存链（T6-16 生产接线——AppShell 经 bindNodeEditorEntryDeps 下发 DrawerShell「手动定义」入口） */
  nodeEditor: { savePipeline: NodeEditorSavePipeline };
  taskCenterDeps: TaskCenterDeps;
  /** runs 记录快照变化通知（T6-19 ②——AppShell 连接器→TaskCenter source.refresh 驱动位） */
  onRunsChanged(fn: () => void): () => void;
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
    // 脏闸=dirty 位直投影（RunEngineDeps 语义「true=有未保存改动」——demo L1792 dirty 即拒、
    // 无确认链；flowStore.guardDirty(action) 是「true=放行」的确认链反义面，T6-17 接线曾反接
    // ——经 T6-19 手动运行链接线暴露修正）
    guardDirty: (_flowId) => useFlowStore.getState().dirty,
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

  // ———— C-13 保存链生产构造（T6-16 生产接线——SavePipelineDeps 真件全绑定） ————
  //   importer=保存链专用导入编排：canvasSink no-op（入库保存不落画布——T6-09 契约 harness 同形；
  //   落图归 C-07 adoptDraft/C-09 安装链各自面）；「开发即沉淀」＝资产落盘/定义/注册表同链。
  //   P-3：assemble=workshop assembleNodePackage 经构造注入传真件——assembly=合法跨模块点
  //   （node-editor 不 import workshop 不变量不变）；零新通道（definitions.upsert/library.upsert/
  //   zip:import 均既有面）。
  const definitionStore = new IpcDefinitionStore(storage);
  const savePipeline = createSavePipeline({
    assemble: assembleNodePackage,
    hasType: (t) => registry.has(t),
    register: (doc) => registry.register(doc),
    upsertDefinition: (doc) => definitionStore.upsertDefinition(doc),
    // library.upsert 单写=链内 ImportOrchestrator ⑥段（T6-19 A1 遗留1 去重——显式段已去）
    importer: createImportOrchestrator({
      bridge: { zipImport: (payload) => api.zipImport(payload), storageInvoke: (req) => api.storageInvoke(req) },
      registry: { has: (t) => registry.has(t), register: (doc) => registry.register(doc) },
      validate: validateDefinition,
      canvasSink: { dropNodes: () => [], markDirty: () => undefined }, // 入库保存零落图零脏标记
      viewportCenter,
      log,
    }),
  });

  // ———— 日志双路（logs$ Bus＝engine.onRunLog 单点 publish）＋重放服务（启动序 restoreRunState） ————
  const logsBus = createLogsBus((fn) => engine.onRunLog(fn));
  const replay = createLogReplayService({
    storage: createReplayStorage(storage),
    restoreMirror: (flowId, runId, statuses) => useRunStore.getState().restoreRun(flowId, runId, statuses),
  });

  // ———— 活行入表/收尾刷新装配（T6-19 ②——A2 线遗留1；runs-source「listRuns 冷装载/refresh
  //     收尾刷新」注入位设计的生产消费面） ————
  //   listRuns=同步快照（boot 冷装载 runs.list 灌入）；活跃集变化（runOpened/runClosed——
  //   RunEngine 事件管线同点镜像写入，02 §3.3）→ runs.list 重读（runs.create/finish 已同点
  //   落库）→ 快照替换＋onRunsChanged 通知 → AppShell 连接器 source.refresh（runs$ 重投影：
  //   活跃 run 入任务表、收尾行状态翻转）。重读失败保持上次快照（不阻塞）；statuses 级镜像
  //   写不入驱动面（runs-source 已订阅 runStore 自行重投影）。
  let runsRecords: readonly TaskRunRecord[] = [];
  const runsListeners = new Set<() => void>();
  let runsReloadInFlight = false;
  let runsReloadQueued = false;
  const reloadRuns = (): void => {
    if (runsReloadInFlight) {
      runsReloadQueued = true;
      return;
    }
    runsReloadInFlight = true;
    void storage
      .invoke('runs.list', undefined)
      .then((res) => {
        // statuses 保留合并：既有快照（restore 装载/前次重读）的终态投影不因 runs.list 无
        // statuses 而丢（进度列数据源）
        runsRecords = res.items.map((s) => {
          const prev = runsRecords.find((r) => r.runId === s.id);
          return { ...runRecordFromSummary(s), ...(prev?.statuses !== undefined ? { statuses: prev.statuses } : {}) };
        });
        for (const fn of [...runsListeners]) fn();
      })
      .catch((err) => {
        /* 读失败保持上次快照（X-3 方向：不阻塞）——留一行日志（T6-16 终审 M-4：降级不静默） */
        log('[app-runtime] runs.list reload failed (keep last snapshot):', err);
      })
      .finally(() => {
        runsReloadInFlight = false;
        if (runsReloadQueued) {
          runsReloadQueued = false;
          reloadRuns();
        }
      });
  };
  const activeRunKey = (m: Readonly<Record<string, string>>): string =>
    [...Object.entries(m)].sort().map(([f, r]) => `${f}=${r}`).join('|');
  let lastActiveRunKey = activeRunKey(useRunStore.getState().activeRunOfFlow);
  const unsubRunSet = useRunStore.subscribe((s) => {
    const key = activeRunKey(s.activeRunOfFlow);
    if (key === lastActiveRunKey) return; // statuses 级写（lastRunOfFlow 变更）不触发重读
    lastActiveRunKey = key;
    reloadRuns();
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
    nodeEditor: { savePipeline },
    viewport: viewportHolder.face,
    bindViewport: (instance) => viewportHolder.bind(instance),
    onRunsChanged(fn) {
      runsListeners.add(fn);
      return () => {
        runsListeners.delete(fn);
      };
    },
    taskCenterDeps: {
      // 冷装载=boot() runs.list 灌入的同步快照（T6-19 ②——A2 遗留1：() => [] 空集已替换；
      // 活跃集变化重读＋通知→AppShell 连接器 source.refresh——见上方装配段）
      listRuns: () => runsRecords,
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
      const report = await registry.loadAll(definitionStore, validateDefinition);
      log(`[app-runtime] registry loaded: total=${report.total} loaded=${report.loaded} broken=${report.broken.length}`);
      reloadRuns(); // runs 记录冷装载（T6-19 ②——listRuns 快照数据面）
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
      unsubRunSet();
      runsListeners.clear();
      unsubFlowChanges();
      autoSaveScheduler.cancel();
      engine.dispose();
      logsBus.dispose();
    },
  };
}
