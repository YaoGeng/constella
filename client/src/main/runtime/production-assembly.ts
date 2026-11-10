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
//     LLM 值源（V1.0 单配置直读）＋CDP lane 端点解析＋NET 端点解析（T5-12a）；run:* 通道在此
//     挂载（slot 无 init——SecretVault/Cdp 先例外，SandboxExecutor 通道面=装配期即挂）；
//   - NetProxyBridge（T5-12a 装配）：ctx.net 的 main 网络代理宿主——net 段 9321–9420 独立池＋
//     netEndpointOf=N1 类目门（scriptPath→type→定义类目含「网络」→openScope provision 首开
//     〔V1.0 缺省 allowlist ['*']，PM 缺省①〕）；全序织入=cdp slot 包装（启动 net.init=cdp.init
//     后主窗前／退出 net.dispose=sandbox.dispose 后 destroyAllLaneWindows 前，PM 缺省②——
//     AppRuntime 无 net 调用点，T5-12a 领地不含 app-runtime.ts，观察面位次等价）。
//   - ExamplePreloader（T5-08 装配）：示例资产 9 首启预装——deps.exampleAssetsDir 注入即生效
//     （AssetInstaller 直调＝C-08 main 侧管线复用；挂载点=StorageService.init 内 open() 迁移后、
//     种子流程前——M4 裁决 2/#11 经 AppRuntime preloadExamples 注入位）。缺省不注入=T4-13 空
//     实现缺省语义保持（无资产目录的测试宿主零预装）。
//
// onStep：生命周期步骤记录（冒烟「启动/退出全序」断言面——AppRuntime 调序经 slot 包装透出）。
import path from 'node:path';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import type { AiSettings } from '@constella/shared/settings';
import { CdpBridge, CdpPortPool, CdpSessionManager, type CdpBrowserWindowConstructor } from '../cdp';
import { CronScheduler, registerCronChannels, type CronFlowSource } from '../cron';
import { NetProxyBridge, netEligibleDefinition } from '../net';
import { SandboxExecutor, type SdkModulePaths } from '../sandbox';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { StorageService, type ZipExportPipeline, type ZipImportPipeline } from '../storage-bridge';
import {
  createAssetInstaller,
  createExamplePreloader,
  createPackageParser,
  createZipReader,
  createZipSecurityValidator,
} from '../zip';
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
  /** 示例资产目录（T5-08：client/assets/examples 9 zip 随分发——ExamplePreloader 预装源；缺省不注入=空实现挂点保持） */
  exampleAssetsDir?: string;
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
  /** NetProxyBridge（T5-12a）：net 段桥宿主——denials() 台账查询面（provision/端点管理=组件面） */
  net: NetProxyBridge;
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
  // ExamplePreloader 挂载步（T5-08）：真实现经下方 storage 装配后回填——回调调用点=startup
  // 步骤 4（StorageService.init→open() 迁移后、种子前），彼时 storage 已构造，闭包回填安全。
  // 缺省不注入（deps.exampleAssetsDir 未传）=T4-13 空实现缺省语义保持。
  let preloadExamplesHook: () => void | Promise<void> = () => {};
  const runtime = new AppRuntime({
    electron,
    rendererDir: deps.rendererDir,
    preloadPath: deps.preloadPath,
    preloadExamples: () => preloadExamplesHook(),
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

  // ———— ExamplePreloader（T5-08 / C-08 §3：示例资产 9 首启预装——source=builtin 免确认〔W-35
  // 裁定 A〕，AssetInstaller 直调=同一安全校验管线复用；幂等=assetPackages content_hash——
  // 二启零 delta。hasType=内置 12 ∪ definitions DAO（main 内直调，index.ts 同构闭包）。————
  if (deps.exampleAssetsDir !== undefined) {
    const hasKnownExampleType = (t: string): boolean =>
      (BUILTIN_TYPE_IDS as readonly string[]).includes(t) ||
      storage.layer.dao.definitions.loadAll().some((doc) => doc.type === t);
    const examplePreloader = createExamplePreloader({
      examplesDir: deps.exampleAssetsDir,
      installer: createAssetInstaller({
        reader: createZipReader(),
        validator: createZipSecurityValidator(),
        parser: createPackageParser({ hasType: hasKnownExampleType }),
        nodeTypesRoot: path.join(deps.userDataDir, 'node-types'),
        definitions: { upsert: (doc) => storage.layer.dao.definitions.upsert(doc) },
        assetPackages: {
          upsert: (args) => storage.layer.dao.assetPackages.upsert(args),
        },
      }),
      assetPackages: storage.layer.dao.assetPackages, // hasHash 幂等查面（T5-08 增补）
      ...(deps.log !== undefined ? { log: deps.log } : {}),
    });
    preloadExamplesHook = async () => {
      await examplePreloader.preloadIfMissing(); // {installed} 结果面归日志，挂点契约=void
    };
  }

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

  // ———— NetProxyBridge（T5-12a；生命周期全序织入位=下方 services.cdp 包装——文件头注记）————
  const net = new NetProxyBridge(); // createWssServer 缺省（loopback-only＋禁 deflate）；缺省 net 段 9321–9420

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
    // CONSTELLA_NET_WS 条件注入（T5-12a 兑现 T4-16 注入缝）：N1 类目门（PM 缺省①锚冻结）——
    // scriptPath→type→定义类目含「网络」（definitions DAO main 内直调，§2）→ openScope provision
    // 首开（V1.0 缺省 allowlist ['*']；V1.1 收缩位=NetProxyBridge.provision 执行点已留）；
    // 门不开=null（不注入 NET_WS——ctx.net=未绑定 stub）。openScope 为 async（绑定确认先于
    // env 注入——sandbox-executor seam 微调面，T5-12a 报告留痕）。
    netEndpointOf: (req) => {
      if (
        netEligibleDefinition(
          req.scriptPath,
          path.join(deps.userDataDir, 'node-types'),
          storage.layer.dao.definitions.loadAll(),
        ) === undefined
      ) {
        return null;
      }
      return net.openScope(req.nodeRunId); // run/node 作用域（scope key=nodeRunId）
    },
  });
  sandbox.init({
    registry: runtime.ipc,
    push: (channel, payload) => runtime.ipc.send(channel, payload), // run:scriptEvent（过 SecretMasker）
  });

  // ———— 五服务注入位（生命周期步骤记录包装——冒烟「启动/退出全序」断言面）————
  // net 槽（T5-12a）：AppRuntime 无 net 调用点（本卡领地不含 app-runtime.ts）——生命周期经
  // services.cdp slot 包装驱动（下方织入位），net 槽为实名注入位（PM 缺省②全序位次：
  // 启动=cdp.init 后、主窗加载 renderer 前；退出=sandbox.dispose 后、cdp.destroyAllLaneWindows 前）。
  const netSlot = {
    init: async (): Promise<void> => {
      step('net.init');
      await net.init(); // net 段 PortPool 预热（全段探活——cdp.init 同形）
    },
    dispose: async (): Promise<void> => {
      step('net.dispose');
      await net.dispose(); // closeAll（关全部 scope 端点＋还池）
    },
  };
  const services: MainServiceSlots = {
    storage: {
      init: async (options) => {
        step('storage.init');
        await storage.init(options);
        // T5-08：异步 preloadExamples 挂点（示例预装）→种子链收尾（C-06 §1 open 注记的
        // layer.opened 消费点）——startup 步骤 4 完成态=预装＋种子均落库，下游〔vault/cdp/
        // 主窗/renderer〕不见半开库（C-05 装载/flows 面零竞态）。同步钩子/缺省时 opened=null
        // 直通（T4-13/T4-20 既有语义不变）。
        await storage.layer.opened;
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
        // net.init 织入位（T5-12a / PM 缺省②：cdp.init 后、主窗加载 renderer 前——
        // AppRuntime startup 的 cdp.init 与 createMainWindow 之间）
        await netSlot.init();
      },
      destroyAllLaneWindows: async () => {
        // net.dispose 织入位（T5-12a / PM 缺省②：sandbox.dispose 后、cdp.destroyAllLaneWindows 前
        // ——AppRuntime shutdown 的 sandbox.dispose 与本步之间）
        await netSlot.dispose();
        step('cdp.destroyAllLaneWindows');
        await cdp.destroyAllLaneWindows();
      },
      laneMemory: () => cdp.laneMemory(),
    },
    net: netSlot,
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
  return { runtime, services, storage, vault, cron, cdp, sandbox, bridge, net };
}
