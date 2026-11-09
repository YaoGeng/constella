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
import { assembleProductionRuntime } from './runtime/production-assembly';
import { adaptElectronDialog, type ElectronApi } from './runtime/electron-api';

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
  userDataDir: app.getPath('userData'),
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
