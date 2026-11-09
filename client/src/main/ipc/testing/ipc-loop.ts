// in-memory ipcRenderer↔ipcMain 传输环（T4-14 测试基建——preload 真面/confirmClose 回程腿复跑宿主）。
//
// 复用 T4-13 mock electron（runtime/testing/mock-electron.ts，既有基建），仅两处按真实 Electron
// 语义接线：
//   1. invoke 拒绝摊平（实证 Electron 45.2.3，2026-11-09 头跑探针）：ipcMain.handle 的 reject 值
//      经 String() 摊平进 `Error invoking remote method '<ch>': ` 前缀 Error——与生产同形
//      （IpcGateway 端已编码 toString=JSON，preload normalizeIpcRejection 剥前缀恢复）；
//   2. m→r 推送派发：loop 窗 webContents.send(通道) → renderer 侧 ipcRenderer.on 监听触发；
//      ipcRenderer.send(通道) → main 侧 ipcMain.on/once 监听触发（app:confirmClose 回程腿）。
import type { IpcRendererLike } from '../../../preload/api';
import {
  createMockElectron,
  MockBrowserWindow,
  MockWebContents,
  type MockElectron,
  type MockIpcMain,
} from '../../runtime/testing/mock-electron';
import type { BrowserWindowConstructor, ElectronApi } from '../../runtime/electron-api';

export interface IpcLoopMock extends MockElectron {
  /** 装配用 electron 面（BrowserWindow 已换 loop 窗——webContents.send 派发 renderer 监听） */
  api: ElectronApi;
  /** renderer 侧 ipcRenderer 面（preload createConstellaApi 的注入对端） */
  ipcRenderer: IpcRendererLike;
}

/**
 * 组装 loop mock electron：与 createMockElectron 同一套实例（log/createdWindows 断言面复用），
 * 仅 BrowserWindow 换为 loop 窗（其 webContents.send 在 sent[] 记录之外派发 renderer 监听）。
 */
export function createLoopMockElectron(log: string[] = []): IpcLoopMock {
  const mock = createMockElectron(log);
  const ipcMain: MockIpcMain = mock.ipcMain;

  // renderer 侧监听注册表（ipcRenderer.on——由 loop 窗 webContents.send 派发）
  const rendererListeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();
  const addRendererListener = (channel: string, listener: (event: unknown, ...args: unknown[]) => void): void => {
    const list = rendererListeners.get(channel) ?? [];
    list.push(listener);
    rendererListeners.set(channel, list);
  };
  const dropRendererListener = (channel: string, listener: (event: unknown, ...args: unknown[]) => void): void => {
    const list = rendererListeners.get(channel);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  };

  /** loop 窗 webContents：send 在 sent[] 记录（T4-13 既有断言面）之外派发 renderer 监听 */
  class LoopWebContents extends MockWebContents {
    override send(channel: string, ...args: unknown[]): void {
      super.send(channel, ...args);
      for (const listener of [...(rendererListeners.get(channel) ?? [])]) listener({}, ...args);
    }
  }

  /** loop 窗（复用 mock 窗记录面——构造仍入 createdWindows/log）；webContents 字段遮蔽换 loop 面 */
  class LoopBrowserWindow extends (mock.BrowserWindow as unknown as new (
    options?: Record<string, unknown>,
  ) => MockBrowserWindow) {
    override readonly webContents: LoopWebContents = new LoopWebContents();

    constructor(options?: Record<string, unknown>) {
      super(options); // createdWindows 记录＋'window.create' log（T4-13 断言面不动）
    }
  }
  const BrowserWindow: BrowserWindowConstructor = LoopBrowserWindow as unknown as BrowserWindowConstructor;

  const ipcRenderer: IpcRendererLike = {
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = ipcMain.handlers.get(channel);
      if (handler === undefined) {
        // Electron 原生语义：未注册通道的 invoke reject（前缀消息由 normalizeIpcRejection 兜 INTERNAL）
        throw new Error(`Error invoking remote method '${channel}': No handler registered for '${channel}'`);
      }
      try {
        return await handler({}, ...args);
      } catch (err) {
        // Electron 实证语义（45.2.3）：reject 值经 String() 摊平进前缀消息
        throw new Error(`Error invoking remote method '${channel}': ${String(err)}`);
      }
    },
    send(channel: string, ...args: unknown[]): void {
      ipcMain.rendererSend(channel, ...args); // main 侧 on/once 监听（confirmClose 回程腿）
    },
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
      addRendererListener(channel, listener);
    },
    removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
      dropRendererListener(channel, listener);
    },
  };

  return {
    ...mock,
    api: { ...mock.api, BrowserWindow },
    ipcRenderer,
  };
}
