// 生产装配（T4-20 组收尾 / TDD-C-M1 §2「main 内部：AppRuntime=组合根」＋§3 生命周期段）。
//
// 五服务真装配的唯一实现：main/index.ts（electron import 面）与本卡 electron 头跑冒烟宿主
// （runtime/testing/app-head-run-main.ts）共用本函数——生产装配单一来源，冒烟即生产同构。
//   - StorageService：SQLITE_ENGINE（better-sqlite3，P-3 收窄处）＋真 userData＋三通道；
//   - SecretVault：safeStorage 真面（index.ts 注入）＋损坏恢复面（vault-recovery，T4-15 🟡 移交）；
//   - CdpSessionManager：真 BrowserWindow＋CdpBridge（真 ws）＋PortPool（9221–9320）＋
//     C-06 main 内直调（lanes 台账=dao.lanes〔lanes-ledger 结构匹配直传〕、flowIdOfRun=runs DAO）；
//   - CronScheduler：settings KV=dao 适配（lastAliveAt 三写点）＋cron:fired→IpcGateway.send；
//   - SandboxExecutor：sandbox/node-types 根=userData 子目录＋vault.reveal 注密＋settings 'ai'
//     LLM 值源（V1.0 单配置直读）＋CDP lane 端点解析；run:* 通道在此挂载（slot 无 init——
//     SecretVault/Cdp 先例外，SandboxExecutor 通道面=装配期即挂）。
//
// NetProxyBridge 未装配（协调方裁决 2026-11-10：立 P5 补录卡 T5-12）——netEndpointOf 不注入
// ＝不注入 CONSTELLA_NET_WS（T4-16 冻结缺省：ctx.net=未绑定 stub→SDK_CAP_UNAVAILABLE）。
//
// onStep：生命周期步骤记录（冒烟「启动/退出全序」断言面——AppRuntime 调序经 slot 包装透出）。
import path from 'node:path';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import type { AiSettings } from '@constella/shared/settings';
import { CdpBridge, CdpPortPool, CdpSessionManager, type CdpBrowserWindowConstructor } from '../cdp';
import { CronScheduler, registerCronChannels, type CronFlowSource } from '../cron';
import { SandboxExecutor, type SdkModulePaths } from '../sandbox';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { StorageService, type ZipExportPipeline, type ZipImportPipeline } from '../storage-bridge';
import { createDaoSettingsKv } from '../vault/settings-kv';
import { createRecoverableVault, type RecoverableVault } from '../vault/vault-recovery';
import type { SafeStorageLike } from '../vault/secret-vault';
import { AppRuntime } from './app-runtime';
import type { ElectronApi } from './electron-api';
import type { MainServiceSlots } from './service-slots';

/** ElectronApi.app 之外的生产 app 面（ElectronApi 契约不扩——T4-13 冻结；装配层直传） */
export interface ProductionAppControl {
  /** factoryReset 编排（StorageService——§6.5d mock 断言面同形） */
  relaunch(): void;
  quit(): void;
  /** laneMemory 数据源（B-9：app 进程度表按 OS pid 关联——缺省不注入=laneMemory 面空跑） */
  getAppMetrics?(): Array<{ pid: number; memory: { workingSetSize: number } }>;
}

/** 生产装配依赖（electron 表面由调用方注入——index.ts=真 electron；头跑宿主=同真件） */
export interface ProductionAssemblyDeps {
  electron: ElectronApi;
  /** safeStorage 真面（须 app ready 后用——init 在 AppRuntime 启动序步骤 5） */
  safeStorage: SafeStorageLike;
  appControl: ProductionAppControl;
  rendererDir: string;
  preloadPath: string;
  userDataDir: string;
  /** @constella/sdk 双 subpath TS 源绝对路径（TsExecutor esbuild alias 目标——T4-16 装配注记） */
  sdkModules: SdkModulePaths;
  /** constella_sdk py 包源目录（缺省不注入='py' 链 RUN-ENV-MISSING 降级——T4-17 装配注记） */
  pyPackageDir?: string;
  /** settings python 路径覆盖（§8①；缺省=py -0p 一次解析） */
  pythonPathOverride?: string;
  /** cron tick 周期注入（缺省 60s 分钟粒度；头跑冒烟缩短） */
  cronTickMs?: number;
  /** cron 时钟注入（缺省 Date.now；头跑冒烟假钟——deps.now 测试缝，T4-19） */
  cronNow?: () => number;
  /** CDP 端口段注入（缺省=9221–9320 主段；头跑冒烟错段避既有套件并发竞态——T4-18 🔵/T4-06 登记） */
  cdpPortRange?: { first: number; last: number };
  /** zip:export 管线（C-08〔P5〕注入位；缺省=stub 骨架） */
  zipExportPipeline?: ZipExportPipeline;
  /** zip:import 管线（C-08〔P5〕注入位；缺省=stub 骨架） */
  zipImportPipeline?: ZipImportPipeline;
  /** 生命周期步骤记录（冒烟断言面；生产缺省不注入） */
  onStep?: (step: string) => void;
  /** 日志面（缺省 console） */
  log?: (...args: unknown[]) => void;
}

/** 装配产物（消费方=index.ts 启动/退出；头跑宿主控制面） */
export interface ProductionAssembly {
  runtime: AppRuntime;
  services: MainServiceSlots;
  storage: StorageService;
  vault: RecoverableVault;
  cron: CronScheduler;
  cdp: CdpSessionManager;
  sandbox: SandboxExecutor;
  bridge: CdpBridge;
}

/** 五服务真装配＋AppRuntime 组合（单一来源：index.ts 与头跑冒烟共用） */
export function assembleProductionRuntime(deps: ProductionAssemblyDeps): ProductionAssembly {
  const { electron, appControl } = deps;
  const step = (name: string): void => deps.onStep?.(name);

  // ———— AppRuntime（组合根——§3 生命周期段编排者）————
  // services 经 getter 惰性槽位注入：五服务构造依赖 runtime.ipc（通道注册面）而 AppRuntime
  // 构造又需 services——环以两段装配解（AppRuntime 消费 services 只在 startup/shutdown 时，
  // 彼时下方 services 已构造完成）。
  let slots: MainServiceSlots | undefined;
  const runtime = new AppRuntime({
    electron,
    rendererDir: deps.rendererDir,
    preloadPath: deps.preloadPath,
    services: {
      get storage() {
        return slots?.storage;
      },
      get vault() {
        return slots?.vault;
      },
      get cdp() {
        return slots?.cdp;
      },
      get cron() {
        return slots?.cron;
      },
      get sandbox() {
        return slots?.sandbox;
      },
    },
  });

  // ———— StorageService（启动序步骤 4／退出序末步）————
  const storage = new StorageService({
    engine: SQLITE_ENGINE,
    userDataDir: deps.userDataDir,
    registry: runtime.ipc,
    app: { relaunch: appControl.relaunch, quit: appControl.quit },
    ...(deps.zipExportPipeline !== undefined ? { zipExport: deps.zipExportPipeline } : {}),
    ...(deps.zipImportPipeline !== undefined ? { zipImport: deps.zipImportPipeline } : {}),
    ...(deps.log !== undefined ? { log: deps.log } : {}),
  });

  // ———— SecretVault（步骤 5；损坏恢复面=T4-15 🟡 移交最小恢复）————
  const vault = createRecoverableVault(
    {
      safeStorage: deps.safeStorage,
      userDataDir: deps.userDataDir,
      settings: createDaoSettingsKv(storage.layer.dao), // main 内直调（§2）
    },
    { ...(deps.log !== undefined ? { log: deps.log } : {}) },
  );

  // ———— CdpSessionManager（步骤 6；退出序销毁 lane 窗）————
  const bridge = new CdpBridge(); // createWssServer 缺省（loopback-only＋禁 deflate）
  const cdp = new CdpSessionManager({
    // 窄 cast 安全：运行时窗即真实 BrowserWindow（debugger/loadURL 面实存），CdpSessionManager
    // 只消费 CdpWindowFace 子集——cdp head-run 宿主同口径
    browserWindow: electron.BrowserWindow as unknown as CdpBrowserWindowConstructor,
    bridge,
    portPool: new CdpPortPool(deps.cdpPortRange), // 缺省 9221–9320（02 §3.2 C-04 行）
    viewers: runtime.viewers,
    lanes: storage.layer.dao.lanes, // C-06 main 内直调（lanes-ledger 结构匹配直传）
    flowIdOfRun: (runId) => storage.layer.dao.runs.get(runId).flowId, // runs DAO（隔离粒度=flow）
    ...(appControl.getAppMetrics !== undefined ? { processMetrics: appControl.getAppMetrics } : {}),
  });

  // ———— CronScheduler（步骤 8／退出序首步；cron:fired→IpcGateway.send）————
  const cron = new CronScheduler({
    settings: createDaoSettingsKv(storage.layer.dao), // lastAliveAt 三写点（CronSettingsKv 同形）
    ...(deps.cronNow !== undefined ? { now: deps.cronNow } : {}),
    ...(deps.cronTickMs !== undefined ? { tickMs: deps.cronTickMs } : {}),
  });
  cron.onFired((flowId) => runtime.ipc.send(IPC_CHANNELS.cronFired, { flowId }));
  registerCronChannels(cron, runtime.ipc); // cron:upsert/cron:cancel（slot 只管 start/stop——通道面装配期挂）
  /** start 注入源：读 flows/nodes 提取 trigger.cron（§3 生命周期段——经 StorageService 读） */
  const readCronFlows = (): CronFlowSource[] =>
    storage.layer.dao.flows.list().items.map((f) => ({
      id: f.id,
      nodes: storage.layer.dao.flows.get(f.id).nodes.map((n) => ({ type: n.type, params: n.params })),
    }));

  // ———— SandboxExecutor（步骤 9 sweepOrphans／退出序 dispose；run:* 通道装配期挂载）————
  const sandbox = new SandboxExecutor({
    sandboxRoot: path.join(deps.userDataDir, 'sandbox'),
    nodeTypesRoot: path.join(deps.userDataDir, 'node-types'),
    revealSecret: (refKey) => vault.reveal(refKey), // 跟随损坏恢复换新实例
    sdkModules: deps.sdkModules,
    ...(deps.pyPackageDir !== undefined ? { pyPackageDir: deps.pyPackageDir } : {}),
    ...(deps.pythonPathOverride !== undefined
      ? { pythonPathOverride: deps.pythonPathOverride }
      : {}),
    execPath: process.execPath, // electron main→electron.exe（TsExecutor 配 RUN_AS_NODE，S-5 ④）
    llm: () => {
      // V1.0 单配置直读（settings 'ai'——D-4；V1.1 resolve('workshop')=C-18 替换点，接口先定）
      const ai = storage.layer.dao.settings.getAll()['ai'] as AiSettings | undefined;
      return { baseUrl: ai?.baseUrl ?? '', apiKeyRef: ai?.apiKeyRef ?? null };
    },
    cdpEndpointOf: (laneKey) => bridge.endpointOf(laneKey), // CONSTELLA_CDP_WS 条件注入（T0-06）
    // netEndpointOf：NetProxyBridge 未装配（T5-12 P5 补录卡）——不注入＝不注入 CONSTELLA_NET_WS
  });
  sandbox.init({
    registry: runtime.ipc,
    push: (channel, payload) => runtime.ipc.send(channel, payload), // run:scriptEvent（过 SecretMasker）
  });

  // ———— 五服务注入位（生命周期步骤记录包装——冒烟「启动/退出全序」断言面）————
  const services: MainServiceSlots = {
    storage: {
      init: async (options) => {
        step('storage.init');
        await storage.init(options);
      },
      close: () => {
        step('storage.close'); // WAL checkpoint
        storage.close();
      },
    },
    vault: {
      init: async (options) => {
        step('vault.init');
        vault.slot.init(options);
      },
    },
    cdp: {
      init: async (options) => {
        step('cdp.init');
        await cdp.init(options);
      },
      destroyAllLaneWindows: async () => {
        step('cdp.destroyAllLaneWindows');
        await cdp.destroyAllLaneWindows();
      },
      laneMemory: () => cdp.laneMemory(),
    },
    cron: {
      start: async () => {
        step('cron.start');
        cron.start(readCronFlows());
      },
      stop: async () => {
        step('cron.stop'); // 刷 lastAliveAt
        cron.stop();
      },
    },
    sandbox: {
      sweepOrphans: async () => {
        step('sandbox.sweepOrphans');
        await sandbox.sweepOrphans();
      },
      dispose: async () => {
        step('sandbox.dispose'); // 在跑树 killTree＋复查
        await sandbox.dispose();
      },
    },
  };

  slots = services; // 惰性槽位就位（AppRuntime startup/shutdown 消费点在装配返回后）
  return { runtime, services, storage, vault, cron, cdp, sandbox, bridge };
}
