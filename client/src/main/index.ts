// Constella client — Electron main 进程入口（T0-08 最小壳 → T4-13 AppRuntime → T4-20 五服务真装配）。
//
// 职责＝唯一 electron import 面（P-3 收窄）＋生产装配消费：全部生命周期/窗口/协议/域通道
// 委托 AppRuntime（runtime/app-runtime.ts），五服务经 production-assembly.ts 组合注入
// （单一来源——T4-20 头跑冒烟宿主 runtime/testing/app-head-run-main.ts 同构复用）：
//   - StorageService：真 StorageLayer（better-sqlite3）＋storage:invoke/zip:* 三通道；
//   - SecretVault：electron safeStorage 真面＋vault.bin 损坏恢复面（vault-recovery）；
//   - CdpSessionManager：真 BrowserWindow/webContents.debugger＋CdpBridge（真 ws）＋
//     C-06 main 内直调（lanes 台账/runs DAO）；
//   - CronScheduler：settings KV=dao 适配＋cron:fired 推送；
//   - SandboxExecutor：sandbox/node-types=userData 子目录＋sdk 双 subpath alias＋py 包目录
//     （ts 链=electron-as-node；py 链=constella_sdk 包源同置，T4-17）。
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import path from 'node:path';
import { BUILTIN_TYPE_IDS, STORAGE_DAO_ERROR_CODES } from '@constella/shared/constants';
import { assembleProductionRuntime } from './runtime/production-assembly';
import { adaptElectronDialog, type ElectronApi } from './runtime/electron-api';
import { StorageError } from './storage/dao/dao-error';
import {
  createAssetInstaller,
  createPackageParser,
  createZipExportPipeline,
  createZipImportPipeline,
  createZipReader,
  createZipSecurityValidator,
} from './zip';

const electronApi: ElectronApi = {
  app,
  BrowserWindow,
  protocol,
  net,
  dialog: adaptElectronDialog(dialog), // owner 窗缺省走无窗重载（electron-api.ts 共用适配）
  shell,
  ipcMain,
};

// app 根（dev/electron . = client 包根；打包产物路径随 P6/B1 分发波校准——留痕）
const appRoot = app.getAppPath();
const userDataDir = app.getPath('userData');

// 已知节点类型面（T5-07：PackageParser 未知 type 兜底判定输入——内置 12 ∪ definitions DAO；
// 后向闭包：管线首调用远晚于装配完成，同 T5-06 getFlow/getDefinition 先例）
const hasKnownNodeType = (t: string): boolean =>
  (BUILTIN_TYPE_IDS as readonly string[]).includes(t) ||
  assembly.storage.layer.dao.definitions.loadAll().some((doc) => doc.type === t);

const assembly = assembleProductionRuntime({
  electron: electronApi,
  safeStorage, // SecretVault 真面（init 在 AppRuntime 启动序步骤 5——app ready 后）
  appControl: {
    relaunch: () => app.relaunch(),
    quit: () => app.quit(),
    getAppMetrics: () => app.getAppMetrics(), // laneMemory 数据源（B-9）
  },
  rendererDir: path.join(__dirname, '..', 'renderer'),
  preloadPath: path.join(__dirname, '..', 'preload', 'index.js'),
  userDataDir,
  // T5-06（C-08 §1 zip:export 行）：导出管线真面注入（T4-20 seam——缺省=stub ZIP-WRITE-FAILED；
  // 头跑冒烟宿主仍不传＝stub 退化面由 T4-20 冒烟守护，设计非遗漏）。DAO/定义经装配产物后向
  // 闭包接入（管线首调用远晚于装配完成——StorageService.init 期仅存函数引用）；资产根与
  // SandboxExecutor nodeTypesRoot 同源（node-types=userData 子目录，02 §8.4 自注册资产目录）。
  zipExportPipeline: createZipExportPipeline({
    getFlow: (flowId) => {
      try {
        return assembly.storage.layer.dao.flows.get(flowId);
      } catch (err) {
        if (err instanceof StorageError && err.code === STORAGE_DAO_ERROR_CODES.FLOW_NOT_FOUND) {
          return undefined; // → 管线转 ZIP-FLOW-NOT-FOUND
        }
        throw err;
      }
    },
    getDefinition: (type) =>
      assembly.storage.layer.dao.definitions.loadAll().find((doc) => doc.type === type),
    nodeTypesRoot: path.join(userDataDir, 'node-types'),
  }),
  // T5-07（C-08 §1 zip:import 两段式行）：导入管线真面注入（T4-20 seam——缺省=stub ZIP-INVALID；
  // 头跑冒烟宿主同 export 例不传＝stub 退化面继续被 T4-20 冒烟守护）。hasType=内置 12 ∪
  // definitions DAO（main 内直调——PackageParser 未知 type 兜底判定面）；definitions/
  // assetPackages=C-06 §2 直调点（commit 段落盘后双 upsert）。
  zipImportPipeline: createZipImportPipeline({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType: hasKnownNodeType }),
    installer: createAssetInstaller({
      reader: createZipReader(),
      validator: createZipSecurityValidator(),
      parser: createPackageParser({ hasType: hasKnownNodeType }),
      nodeTypesRoot: path.join(userDataDir, 'node-types'),
      definitions: { upsert: (doc) => assembly.storage.layer.dao.definitions.upsert(doc) },
      assetPackages: {
        upsert: (args) => assembly.storage.layer.dao.assetPackages.upsert(args),
      },
    }),
  }),
  sdkModules: {
    // monorepo sdk TS 源（T4-16 装配注记：client 无 workspace dep——esbuild alias 显式映射）
    sdk: path.resolve(appRoot, '..', 'sdk', 'src', 'index.ts'),
    bootstrap: path.resolve(appRoot, '..', 'sdk', 'src', 'bootstrap.ts'),
  },
  pyPackageDir: path.resolve(appRoot, '..', 'sdk', 'py'), // py 链装配（缺此=RUN-ENV-MISSING 降级）
});

void assembly.runtime.startup().catch((err: unknown) => {
  console.error('[constella-main] AppRuntime 启动失败:', err);
  app.quit();
});
