// AppRuntime 组合根用例（T4-13 / TDD-C-M1 §3 AppRuntime 行＋生命周期段）。
//
// 判据＝03 C-M1 §3 AppRuntime 行（组合根+窗口管理：protocol.handle 注册/close 拦截→confirmClose/
// window-all-closed 覆盖〔S-3 坑②〕/非白名单导航转 openExternal/查看窗原语）＋§3 生命周期段
// （启动/退出双序全序）。electron 用 mock app 断言（卡面口径；真 electron 头跑归 T4-18/T4-20）。
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import type { MainServiceSlots, StorageServiceSlot } from './service-slots';
import { AppRuntime } from './app-runtime';
import { createMockElectron, type MockBrowserWindow } from './testing/mock-electron';

const RENDERER_DIR = path.resolve('C:\\mock-app\\dist\\renderer');
const PRELOAD_PATH = path.resolve('C:\\mock-app\\dist\\preload\\index.js');
const MAIN_URL = 'app://./index.html';

/** 五服务注入位 mock（全量注入＋双序 log 埋点；storage 另记 init options） */
function makeServiceMocks(log: string[], storageInitOptions: Array<{ preloadExamples: () => void | Promise<void> }>): MainServiceSlots {
  return {
    storage: {
      init(options) {
        storageInitOptions.push(options);
        log.push('storage.init');
      },
      close: () => {
        log.push('storage.close');
      },
    } satisfies StorageServiceSlot,
    vault: {
      init: () => {
        log.push('vault.init');
      },
    },
    cdp: {
      init: () => {
        log.push('cdp.init');
      },
      destroyAllLaneWindows: () => {
        log.push('cdp.destroyAllLaneWindows');
      },
    },
    cron: {
      start: () => {
        log.push('cron.start');
      },
      stop: () => {
        log.push('cron.stop');
      },
    },
    sandbox: {
      sweepOrphans: () => {
        log.push('sandbox.sweepOrphans');
      },
      dispose: () => {
        log.push('sandbox.dispose');
      },
    },
  };
}

interface Boot {
  runtime: AppRuntime;
  main: MockBrowserWindow;
  mock: ReturnType<typeof createMockElectron>;
  log: string[];
  storageInitOptions: Array<{ preloadExamples: () => void | Promise<void> }>;
}

/** 本套件可覆写的 AppRuntimeDeps 子集（electron/rendererDir 固定） */
interface RuntimeOverrides {
  preloadExamples?: () => void | Promise<void>;
  confirmCloseTimeoutMs?: number;
  services?: MainServiceSlots;
}

async function boot(overrides: RuntimeOverrides = {}): Promise<Boot> {
  const booted = createRuntime(overrides);
  await booted.runtime.startup();
  return { ...booted, main: booted.mock.createdWindows[0]! };
}

function createRuntime(overrides: RuntimeOverrides = {}) {
  const log: string[] = [];
  const mock = createMockElectron(log);
  const storageInitOptions: Array<{ preloadExamples: () => void | Promise<void> }> = [];
  const services = overrides.services ?? makeServiceMocks(log, storageInitOptions);
  const runtime = new AppRuntime({
    electron: mock.api,
    rendererDir: RENDERER_DIR,
    preloadPath: PRELOAD_PATH,
    services,
    confirmCloseTimeoutMs: 2000,
    ...overrides,
  });
  return { runtime, mock, log, storageInitOptions, services };
}

describe('AppRuntime 启动序（C-M1 §3 生命周期段全序）', () => {
  it('按冻结全序执行：registerSchemes → whenReady → protocol.handle → storage.init → vault.init → cdp.init → 主窗加载 → cron.start → sweepOrphans', async () => {
    const { log } = await boot();
    expect(log).toEqual([
      'protocol.registerSchemesAsPrivileged',
      'app.whenReady',
      'protocol.handle:app',
      'storage.init',
      'vault.init',
      'cdp.init',
      'window.create',
      `window.loadURL:${MAIN_URL}`,
      'cron.start',
      'sandbox.sweepOrphans',
    ]);
  });

  it('重复 startup 拒绝（单次语义）', async () => {
    const { runtime } = await boot();
    await expect(runtime.startup()).rejects.toThrow(/startup/);
  });

  it('ExamplePreloader 挂载步：storage.init 恒收到 preloadExamples 回调（显式注入时原样传递）', async () => {
    const marker = (): void => {};
    const { storageInitOptions } = await boot({ preloadExamples: marker });
    expect(storageInitOptions).toHaveLength(1);
    expect(storageInitOptions[0]!.preloadExamples).toBe(marker);
  });

  it('ExamplePreloader 挂载步：未注入时缺省空实现收口为装配点（可调用、非 undefined）', async () => {
    const { storageInitOptions } = await boot();
    expect(storageInitOptions).toHaveLength(1);
    const hook = storageInitOptions[0]!.preloadExamples;
    expect(typeof hook).toBe('function');
    expect(hook()).toBeUndefined();
  });

  it('app:// 特权协议按 S-1 ③ 注册（standard/secure/supportFetchAPI/stream，ready 之前）', async () => {
    const { mock, log } = await boot();
    const schemes = mock.protocol.privilegedSchemes;
    expect(schemes).toHaveLength(1);
    expect(schemes[0]!.scheme).toBe('app');
    expect(schemes[0]!.privileges).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    });
    // registerSchemesAsPrivileged 必须先于 whenReady（Electron 约束；log 序已含，此处显式钉死）
    expect(log.indexOf('protocol.registerSchemesAsPrivileged')).toBeLessThan(log.indexOf('app.whenReady'));
  });
});

describe('主窗经 protocol 产物加载（S-1 ③）', () => {
  it('主窗以 app://./index.html 加载，安全基线恒定（contextIsolation/sandbox/无 Node/webSecurity）', async () => {
    const { mock } = await boot();
    const main = mock.createdWindows[0]!;
    expect(main.loadUrls).toEqual([MAIN_URL]);
    expect(main.options?.webPreferences).toEqual({
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('app:// 请求映射 rendererDir 静态产物（net.fetch file://）；目录逃逸拒绝', async () => {
    const { mock } = await boot();
    await mock.protocol.dispatch('app', MAIN_URL);
    expect(mock.net.fetched).toEqual([pathToFileURL(path.join(RENDERER_DIR, 'index.html')).href]);
    await mock.protocol.dispatch('app', 'app://./assets/main.js');
    expect(mock.net.fetched[1]).toBe(pathToFileURL(path.join(RENDERER_DIR, 'assets', 'main.js')).href);
    await expect(mock.protocol.dispatch('app', 'app://./..%2F..%2Fsecret.txt')).rejects.toThrow(
      /out-of-scope/,
    );
    expect(mock.net.fetched).toHaveLength(2);
  });
});

describe('window-all-closed 覆盖（S-3 坑②兜底：查看窗全关不退 app）', () => {
  it('全部查看窗关闭＋window-all-closed 触发 → app 不退、主窗不受影响', async () => {
    const { runtime, mock } = await boot();
    const main = mock.createdWindows[0]!;
    runtime.viewers.openViewer({ laneKey: 'f1·lane-主', url: 'https://a.example/' });
    runtime.viewers.openViewer({ laneKey: 'f1·lane-副', url: 'https://b.example/' });
    expect(mock.createdWindows).toHaveLength(3);

    for (const win of mock.createdWindows.slice(1)) win.close();
    expect(mock.app.listenerCount('window-all-closed')).toBeGreaterThan(0);
    mock.app.emitApp('window-all-closed');
    expect(mock.app.quitCount).toBe(0);
    expect(main.isDestroyed()).toBe(false);
  });

  it('查看窗 ✕ 只关窗：不触发 confirmClose 问询、不弹原生确认（A-8.2 不中断自动化）', async () => {
    const { runtime, mock } = await boot();
    const main = mock.createdWindows[0]!;
    const viewer = runtime.viewers.openViewer({ laneKey: 'f1·lane-主', url: 'https://a.example/' });
    viewer.close();
    expect(viewer.isDestroyed()).toBe(true);
    expect(main.webContents.sent).toEqual([]); // 无 app:confirmClose 推送
    expect(mock.dialog.messageBoxCalls).toEqual([]);
    expect(mock.app.quitCount).toBe(0);
  });
});

describe('查看窗原语（openViewer/置顶/复用——交面给 T4-18 消费）', () => {
  it('openViewer 创建可见窗口加载 url；同 laneKey 复用已开窗置顶；关窗后可再开', async () => {
    const { runtime, mock } = await boot();
    runtime.viewers.openViewer({ laneKey: 'k1', url: 'https://a.example/x' });
    const v1 = mock.createdWindows[1]!; // 主窗之后首个查看窗
    expect(v1.loadUrls).toEqual(['https://a.example/x']);
    expect(v1.options?.show).toBe(true);

    runtime.viewers.openViewer({ laneKey: 'k1', url: 'https://a.example/x' }); // 复用→置顶
    expect(v1.focusCount).toBe(1);
    expect(v1.moveTopCount).toBe(1);
    expect(mock.createdWindows).toHaveLength(2); // 仅主窗＋一个查看窗（未新建）

    v1.close();
    runtime.viewers.openViewer({ laneKey: 'k1', url: 'https://a.example/x' });
    const v2 = mock.createdWindows[2]!;
    expect(v2).not.toBe(v1);
    expect(v2.loadUrls).toEqual(['https://a.example/x']);
  });
});

describe('非白名单导航转 openExternal（02 §12.3 导航拦截）', () => {
  it('http/https 导航被拦截并转外部打开；app:// 自有协议放行', async () => {
    const { mock } = await boot();
    const wc = mock.createdWindows[0]!.webContents;
    expect(wc.emitWillNavigate('https://example.com/doc')).toBe(true);
    expect(mock.shell.opened).toEqual(['https://example.com/doc']);
    expect(wc.emitWillNavigate('app://./index.html')).toBe(false);
    expect(mock.shell.opened).toHaveLength(1);
  });

  it('非 http/https 协议（file:// 等）仅阻断不外开', async () => {
    const { mock } = await boot();
    const wc = mock.createdWindows[0]!.webContents;
    expect(wc.emitWillNavigate('file:///C:/Windows/system.ini')).toBe(true);
    expect(wc.emitWillNavigate('javascript:alert(1)')).toBe(true);
    expect(mock.shell.opened).toEqual([]);
  });

  it('window.open/target=_blank 全拒绝新窗，http/https 转外部打开', async () => {
    const { mock } = await boot();
    const wc = mock.createdWindows[0]!.webContents;
    expect(wc.callWindowOpenHandler('https://example.com/blank')).toEqual({ action: 'deny' });
    expect(mock.shell.opened).toEqual(['https://example.com/blank']);
    expect(wc.callWindowOpenHandler('file:///C:/evil.exe')).toEqual({ action: 'deny' });
    expect(mock.shell.opened).toHaveLength(1);
  });
});

describe('退出双序（before-quit：cron.stop → sandbox.dispose → cdp.destroyAllLaneWindows → storage.close）', () => {
  it('before-quit 拦截后按全序执行并重新 quit', async () => {
    const { mock, log } = await boot();
    const e = mock.app.emitApp('before-quit');
    expect(e.prevented).toBe(true);
    await vi.waitFor(() => expect(log).toContain('storage.close'));
    expect(log.slice(-4)).toEqual([
      'cron.stop',
      'sandbox.dispose',
      'cdp.destroyAllLaneWindows',
      'storage.close',
    ]);
    expect(mock.app.quitCount).toBe(1); // shutdown 完成后的补 quit
  });

  it('shutdown 幂等：二次触发不重复执行退出序', async () => {
    const { runtime, log } = await boot();
    await runtime.shutdown();
    await runtime.shutdown();
    expect(log.filter((l) => l === 'storage.close')).toHaveLength(1);
  });
});

describe('activate 重建主窗（macOS 面保留）', () => {
  it('无窗口时 activate 重建主窗并加载 renderer', async () => {
    const { mock } = await boot();
    const main = mock.createdWindows[0]!;
    main.destroy();
    mock.app.emitApp('activate');
    expect(mock.createdWindows).toHaveLength(2);
    expect(mock.createdWindows[1]!.loadUrls).toEqual([MAIN_URL]);
  });
});

describe('AppRuntime 域通道注册面', () => {
  it('启动后 AppRuntime 域四组通道经 ipcMain.handle 注册（app:version/env:systemInfo/dialog:*/shell:*）', async () => {
    const { mock } = await boot();
    for (const ch of [
      IPC_CHANNELS.appVersion,
      IPC_CHANNELS.envSystemInfo,
      IPC_CHANNELS.dialogOpenFile,
      IPC_CHANNELS.dialogSaveFile,
      IPC_CHANNELS.shellOpenExternal,
    ]) {
      expect(mock.ipcMain.handlers.has(ch)).toBe(true);
    }
  });
});
