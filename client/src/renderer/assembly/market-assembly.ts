// market-assembly.ts —— market 域生产装配（T5-11 / batch-3 硬接线 4/6＋§2↑被依赖「L4 UI 经
// uiStore 开关消费本卡 hooks」的装配落位）。
//
// 装配面：
//   - MarketStack（T5-09 client＋auth 互注）＋ OfflineDegradation（观察 list 面：transport 失败
//     →report(kind)、成功→reportOnline＋cacheList——离线判定/缓存投影数据源）；
//   - ImportOrchestrator：**真 C-02 校验器注入**（T5-10 🔵3——validateDefinition 单一来源，
//     不透传 stub；ctx.hasType 排除自身由编排内构）＋真注册表面（C-05 NodeRegistry——缺省
//     createNodeRegistry，应用壳应传入全局实例）；
//   - Installer（download→importArchiveBytes→installs 计量——timeoutMs 收拢=MARKET_DOWNLOAD_TIMEOUT_MS
//     已在 T5-10 交付〔🔵2〕）＋ FlowInstaller（createAndSwitch 真接线＋脏闸真 flowStore）；
//   - Publisher（v1.0f 字节双变体出口）＋ PendingByteStore＋PendingPublishQueue（联网恢复补交
//     提示——degradation.onOnline 接线，flushPending 仍手动触发）。
import type { FlowDoc, StorageInvokeReq, ZipExportReq, ZipExportRes, ZipImportReq, ZipImportRes } from '@constella/shared/ipc';
import type { MarketListItem, MarketListQuery, MarketListRes, PermLabel } from '@constella/shared/dto';
import { createNodeRegistry } from '../node-registry';
import type { NodeRegistry } from '../node-registry';
import { validateDefinition } from '../definition/definition-validator';
import { createCanvasSink } from '../canvas/sink/canvas-sink';
import { createExportOrchestrator, type ZipExportBridge } from '../zip/export-orchestrator';
import { createImportOrchestrator } from '../zip/import-orchestrator';
import {
  createAuthSession,
  createMarketApiClient,
  isMarketTransportError,
} from '../market';
import type { MarketApiClient, SecretBridgeFace } from '../market';
import { createOfflineDegradation, type OfflineDegradation } from '../market/offline-degradation';
import { createPendingByteStore, createPendingPublishQueue } from '../market/pending-publish-queue';
import type { PendingPublishQueue } from '../market/pending-publish-queue';
import { createPublisher, type Publisher } from '../market/publisher';
import type { PublishSource } from '../market/publisher';
import { createInstaller, type InstallRef, type InstallResult } from '../market/installer';
import type { InstallConfirmData } from '../market/install-confirm';
import { createFlowInstaller } from '../market/flow-installer';
import { wireRealFlowSwitcher } from './flow-switcher';

/** preload/IPC 桥面（window.constella 子集——装配点直传；测试 mock 同形） */
export interface MarketAssemblyBridge extends ZipExportBridge {
  zipImport(payload: ZipImportReq): Promise<ZipImportRes>;
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
  secret: SecretBridgeFace;
}

export interface MarketAssemblyDeps {
  bridge: MarketAssemblyBridge;
  /** settings `market.baseUrl` 读取面（03 §7.3#2——默认空＋首次使用引导） */
  baseUrl(): string;
  /** 视口中心（CanvasSink/瀑布基准——应用壳经 ReactFlow instance 装配） */
  viewportCenter(): { x: number; y: number };
  /** toast 面 */
  notify(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  /** InstallConfirm 命令式封装（12.2#2 两拦截点共用一框——应用壳注入；缺省=直接放行仅供开发） */
  confirm?(data: InstallConfirmData): Promise<boolean>;
  /** 登录引导（LoginDialog 打开——UNAUTHORIZED 捕获面；缺省=toast 提示） */
  onUnauthorized?(): void;
  /** C-05 注册表（应用壳全局实例；缺省=装配内自建 ⚠——仅测试/独立场景用） */
  registry?: NodeRegistry;
  /** fetch 注入（生产=window.fetch；E2E/测试 mock） */
  fetch?: typeof fetch;
  log?: (...args: unknown[]) => void;
}

/** 装配产物（应用壳消费面——L4 UI 经 uiStore 开关取件） */
export interface MarketAssembly {
  client: MarketApiClient;
  degradation: OfflineDegradation;
  publisher: Publisher;
  queue: PendingPublishQueue;
  /** 广场弹窗接线（MarketBrowser props 工厂——onDownload→Installer 链） */
  browserFaces: {
    /** 观察面 list（离线判定＋缓存登记内嵌——MarketBrowser.listFace 直用） */
    list(q?: MarketListQuery): Promise<MarketListRes>;
    auth: ReturnType<typeof createAuthSession>;
    onDownload(item: MarketListItem): void;
    /** offline 态（MarketBrowser offline prop 数据源——useOfflineState 同源） */
    offline(): boolean;
  };
  /** 发布弹窗接线（PublisherDialog props 工厂） */
  publisherFaces: {
    listTypes(): Promise<Array<{ type: string; name: string; category: string; kind: 'builtin' | 'custom' }>>;
    listFlows(): Promise<{ items: Array<{ id: string; name: string }> }>;
    getFlow(flowId: string): Promise<FlowDoc>;
    derivePerms(types: readonly string[]): PermLabel[];
    publish(meta: { name: string; summary: string }, source: PublishSource): Promise<unknown>;
  };
  /** 安装面（卡片直调——browserFaces.onDownload 同链） */
  install(ref: InstallRef): Promise<InstallResult>;
  /** 联网恢复→待发布补交提示接线（返回卸载函数；flushPending 仍手动触发——02 §1.3） */
  wireOnlineHint(): () => void;
}

export function createMarketAssembly(deps: MarketAssemblyDeps): MarketAssembly {
  const registry = deps.registry ?? createNodeRegistry();
  const notify = deps.notify;

  // ———— MarketStack（client＋auth 互注——T5-09） ————
  let authRef: ReturnType<typeof createAuthSession> | null = null;
  const client = createMarketApiClient({
    baseUrl: deps.baseUrl,
    getAccessToken: () => authRef?.getAccessToken() ?? null,
    refreshAccessToken: () => {
      if (authRef === null) return Promise.reject(new Error('market assembly: auth 未装配'));
      return authRef.doRefresh();
    },
    fetch: deps.fetch,
  });
  const auth = createAuthSession({ send: (path, init) => client.request(path, init), secret: deps.bridge.secret });
  authRef = auth;

  // ———— OfflineDegradation ＋观察 list 面（离线判定源/缓存投影） ————
  const degradation = createOfflineDegradation();
  const observedList = async (q?: MarketListQuery): Promise<MarketListRes> => {
    try {
      const res = await client.list(q);
      degradation.reportOnline();
      degradation.cacheList(res);
      return res;
    } catch (err) {
      if (isMarketTransportError(err)) degradation.report(err.kind);
      throw err;
    }
  };

  // ———— 导入编排（真 C-02 校验器——T5-10 🔵3：validateDefinition 单一来源） ————
  const importer = createImportOrchestrator({
    bridge: { zipImport: deps.bridge.zipImport, storageInvoke: deps.bridge.storageInvoke },
    registry: { has: (t) => registry.has(t), register: (doc) => registry.register(doc) },
    validate: validateDefinition, // 真校验器（非透传 stub）
    canvasSink: createCanvasSink({ viewportCenter: deps.viewportCenter }),
    viewportCenter: deps.viewportCenter,
    derivePerms: (cats) => registry.derivePerms(cats),
    notify,
    log: deps.log,
  });

  // ———— FlowInstaller（createAndSwitch 真接线＋脏闸真 flowStore）＋Installer ————
  const flowWiring = wireRealFlowSwitcher({ invoke: deps.bridge.storageInvoke });
  const flowInstaller = createFlowInstaller({
    canvasSink: createCanvasSink({ viewportCenter: deps.viewportCenter }),
    flowSwitcher: flowWiring.switcher,
    storageInvoke: flowWiring.installStorage.invoke,
    viewportCenter: deps.viewportCenter,
    notify,
    log: deps.log,
  });
  const confirm = deps.confirm ?? (async () => true);
  // client 结构性满足 Installer/Publisher/Queue 三注入面（MarketApiClient ⊃ 各 face——泛型 request 原样保留）
  const installer = createInstaller({
    client,
    importer,
    flowInstaller,
    confirm,
    derivePerms: (cats) => registry.derivePerms(cats),
    notify,
    onUnauthorized: deps.onUnauthorized,
    log: deps.log,
  });

  // ———— Publisher＋队列（v1.0f 字节双变体出口＋会话字节仓共用） ————
  const exporter = createExportOrchestrator(deps.bridge, { log: deps.log });
  const byteStore = createPendingByteStore();
  const publisher = createPublisher({
    client,
    exporter,
    storageInvoke: deps.bridge.storageInvoke,
    byteStore,
    notify,
    onUnauthorized: deps.onUnauthorized,
    log: deps.log,
  });
  const queue = createPendingPublishQueue({
    storage: { invoke: deps.bridge.storageInvoke },
    client,
    byteStore,
    notify,
    log: deps.log,
  });

  return {
    client,
    degradation,
    publisher,
    queue,
    browserFaces: {
      list: observedList,
      auth,
      onDownload: (item) => {
        void installer.install({ id: item.id, kind: item.kind }).catch(() => {
          /* 失败面 toast 已在 Installer 内发——此处吞未处理拒绝（避免 unhandled rejection） */
        });
      },
      offline: () => degradation.state() === 'offline',
    },
    publisherFaces: {
      listTypes: async () =>
        registry.list().map((d) => ({ type: d.type, name: d.meta.name, category: d.meta.category, kind: d.kind === 'builtin' ? 'builtin' : 'custom' })),
      listFlows: async () => {
        const res = (await deps.bridge.storageInvoke({ op: 'flows.list' })) as { items: Array<{ id: string; name: string }> };
        return { items: res.items.map((f) => ({ id: f.id, name: f.name })) };
      },
      getFlow: async (flowId) => (await deps.bridge.storageInvoke({ op: 'flows.get', args: { id: flowId } })) as FlowDoc,
      derivePerms: (types) => registry.derivePerms(types),
      publish: (meta, source) =>
        publisher.publish({ kind: source.types !== undefined ? (source.types.length === 1 ? 'node' : 'pack') : 'flow', ...meta }, source),
    },
    install: (ref) => installer.install(ref),
    wireOnlineHint() {
      return degradation.onOnline(() => {
        void queue
          .list()
          .then(({ items }) => {
            if (items.length > 0) notify('info', `网络已恢复——有 ${items.length} 个待发布项可补交（发布弹窗/设置页手动触发）`);
          })
          .catch(() => {
            /* storage 不可达——跳过提示（不阻塞恢复） */
          });
      });
    },
  };
}
