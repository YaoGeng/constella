// AppRuntime 域通道四组 handler 往返（T4-13 / TDD-C-M1 §1 矩阵 app:*/env:*/dialog:*/shell:* 行）。
//
// 判据＝03 C-M1 §1 矩阵：app:version（process.versions 聚合，无业务错误）／env:systemInfo
// （os/cpu/mem＋lanes 内存数组聚合，M4 #7）／dialog:openFile·saveFile（用户取消 in-band {path:null}）／
// shell:openExternal（仅 http/https；非法→SHELL-INVALID-URL）。经 mock ipcMain.invoke 断言往返形。
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  LANE_MEMORY_BUDGET_BYTES,
  type LaneMemory,
} from '@constella/shared/ipc';
import { AppRuntime } from './app-runtime';
import { createMockElectron } from './testing/mock-electron';

async function bootRuntime(overrides: {
  laneMemory?: () => LaneMemory[] | Promise<LaneMemory[]>;
} = {}) {
  const mock = createMockElectron();
  const runtime = new AppRuntime({
    electron: mock.api,
    rendererDir: 'C:\\mock-app\\dist\\renderer',
    preloadPath: 'C:\\mock-app\\dist\\preload\\index.js',
    services: overrides.laneMemory
      ? {
          cdp: {
            init: () => {},
            destroyAllLaneWindows: () => {},
            laneMemory: overrides.laneMemory,
          },
        }
      : undefined,
  });
  await runtime.startup();
  return { mock, runtime };
}

describe('app:version（process.versions 聚合，B-9）', () => {
  it('返回 {app,electron,chrome,node,platform}（app 取 app.getVersion）', async () => {
    const { mock } = await bootRuntime();
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.appVersion, {})) as {
      app: string;
      electron: string | undefined;
      chrome: string | undefined;
      node: string | undefined;
      platform: string;
    };
    expect(res.app).toBe('0.0.0-mock');
    expect(res.electron).toBe(process.versions.electron);
    expect(res.chrome).toBe(process.versions.chrome);
    expect(res.node).toBe(process.versions.node);
    expect(res.platform).toBe(process.platform);
  });
});

describe('env:systemInfo（B-9＋lanes 内存数组聚合，M4 #7）', () => {
  it('聚合 os/cpu/mem/runtimeVersions；lanes 数组自 CdpSessionManager 数据源透传（≤150MB 预算告警数据源）', async () => {
    const lanes: LaneMemory[] = [
      { laneKey: 'f-001·lane-主', label: '主', workingSetBytes: 64 * 1024 * 1024 },
      { laneKey: 'f-001·lane-副', label: '副', workingSetBytes: LANE_MEMORY_BUDGET_BYTES + 1 },
    ];
    const { mock } = await bootRuntime({ laneMemory: () => lanes });
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.envSystemInfo, {})) as {
      os: string;
      cpuCores: number;
      memTotal: number;
      runtimeVersions: Record<string, string | undefined>;
      lanes: LaneMemory[];
    };
    expect(res.os).toBe(os.platform());
    expect(res.cpuCores).toBe(os.cpus().length);
    expect(res.memTotal).toBe(os.totalmem());
    expect(res.runtimeVersions.node).toBe(process.versions.node);
    expect(res.lanes).toEqual(lanes);
  });

  it('无 Cdp 会话数据源（T4-18 未接入）→ lanes 恒为空数组非 undefined', async () => {
    const { mock } = await bootRuntime();
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.envSystemInfo, {})) as { lanes: LaneMemory[] };
    expect(res.lanes).toEqual([]);
  });
});

describe('dialog:openFile（用户取消 in-band {path:null}）', () => {
  it('取消 → {path:null}（in-band，非 reject）', async () => {
    const { mock } = await bootRuntime();
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.dialogOpenFile, {
      filters: [{ name: 'zip', extensions: ['zip'] }],
    })) as { path: string | null };
    expect(res).toEqual({ path: null });
  });

  it('选择文件 → {path}；filters 透传原生对话框；owner=主窗', async () => {
    const { mock } = await bootRuntime();
    mock.dialog.showOpenDialogImpl = async () => ({
      canceled: false,
      filePaths: ['C:\\tmp\\pack.zip'],
    });
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.dialogOpenFile, {
      filters: [{ name: 'zip', extensions: ['zip'] }],
    })) as { path: string | null };
    expect(res).toEqual({ path: 'C:\\tmp\\pack.zip' });
    expect(mock.dialog.openCalls[0]!.opts.filters).toEqual([{ name: 'zip', extensions: ['zip'] }]);
    expect(mock.dialog.openCalls[0]!.win).toBe(mock.createdWindows[0]);
  });
});

describe('dialog:saveFile（用户取消 in-band {path:null}）', () => {
  it('取消 → {path:null}', async () => {
    const { mock } = await bootRuntime();
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.dialogSaveFile, {
      defaultName: 'constella-f1.zip',
    })) as { path: string | null };
    expect(res).toEqual({ path: null });
  });

  it('选择保存位 → {path}；defaultName → defaultPath 透传', async () => {
    const { mock } = await bootRuntime();
    mock.dialog.showSaveDialogImpl = async () => ({
      canceled: false,
      filePath: 'C:\\out\\constella-f1.zip',
    });
    const res = (await mock.ipcMain.invoke(IPC_CHANNELS.dialogSaveFile, {
      defaultName: 'constella-f1.zip',
    })) as { path: string | null };
    expect(res).toEqual({ path: 'C:\\out\\constella-f1.zip' });
    expect(mock.dialog.saveCalls[0]!.opts.defaultPath).toBe('constella-f1.zip');
  });
});

describe('shell:openExternal（仅 http/https；非法→SHELL-INVALID-URL）', () => {
  it('合法 http/https → shell.openExternal 打开', async () => {
    const { mock } = await bootRuntime();
    await mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url: 'https://example.com/docs' });
    await mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url: 'http://example.com/' });
    expect(mock.shell.opened).toEqual(['https://example.com/docs', 'http://example.com/']);
  });

  it.each(['file:///C:/Windows/system.ini', 'ftp://example.com/x', 'javascript:alert(1)', 'not-a-url'])(
    '非法 url %s → reject {code:"SHELL-INVALID-URL"}',
    async (url) => {
      const { mock } = await bootRuntime();
      await expect(
        mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url }),
      ).rejects.toEqual({ code: IPC_ERROR_CODES.SHELL_INVALID_URL, message: expect.any(String) });
      expect(mock.shell.opened).toEqual([]);
    },
  );
});
