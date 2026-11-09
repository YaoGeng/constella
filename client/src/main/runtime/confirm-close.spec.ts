// confirmClose 链路用例（T4-13 / TDD-C-M1 §1 app:confirmClose 行＋§3 AppRuntime 行；
// T4-14 复跑：回程腿换真 preload 面）。
//
// 语义（02 §3.3/§3.4）：main 拦截主窗 close → m→r 问 renderer dirty（app:confirmClose 带响应
// {dirty}）→ dirty 时原生 dialog.showMessageBox 确认丢弃/取消。两分支＋超时兜底＋
// 补跑 T3-05（app:confirmClose renderer 应答真通道——P3 区头 d 项收口：flowStore.dirty 经
// app:confirmClose 回程腿驱动 main 关窗决策）。
// 回程腿（T4-14 接管复跑）：stand-in 腿退役——经真 preload 面（preload/api.ts createConstellaApi
// ＋ipc-loop：webContents.send → ipcRenderer.on → 应答 → ipcRenderer.send → ipcMain.once，
// 与生产同径）；应答源=flowStore.dirty（T3-05 冻结语义）。
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { useFlowStore } from '../../renderer/canvas/stores/flow-store';
import { createConstellaApi } from '../../preload/api';
import { AppRuntime } from './app-runtime';
import { createLoopMockElectron } from '../ipc/testing/ipc-loop';
import type { MockBrowserWindow, MockWebContents } from './testing/mock-electron';

const RENDERER_DIR = 'C:\\mock-app\\dist\\renderer';

interface ConfirmBoot {
  runtime: AppRuntime;
  main: MockBrowserWindow;
  mainWc: MockWebContents;
  mock: ReturnType<typeof createLoopMockElectron>;
}

async function bootConfirm(timeoutMs = 2000): Promise<ConfirmBoot> {
  const mock = createLoopMockElectron();
  const runtime = new AppRuntime({
    electron: mock.api, // loop 窗：webContents.send 派发 renderer 侧监听（真推送径）
    rendererDir: RENDERER_DIR,
    preloadPath: 'C:\\mock-app\\dist\\preload\\index.js',
    confirmCloseTimeoutMs: timeoutMs,
  });
  await runtime.startup();
  const main = mock.createdWindows[0]!;
  return { runtime, main, mainWc: main.webContents, mock };
}

/** 真 preload 面回程腿（T4-14）：window.constella.appConfirmClose(responder) 注册
 *  ipcRenderer.on(app:confirmClose) → 应答 {dirty} → 同通道 ipcRenderer.send 回程 */
function wirePreloadConfirmClose(boot: ConfirmBoot, dirtySource: () => boolean): void {
  const api = createConstellaApi(boot.mock.ipcRenderer);
  api.appConfirmClose(() => ({ dirty: dirtySource() }));
}

describe('confirmClose dirty 两分支（C-M1 §1 app:confirmClose 行）', () => {
  it('不 dirty → 直关：无原生确认，关窗并触发退出', async () => {
    const boot = await bootConfirm();
    wirePreloadConfirmClose(boot, () => false);
    boot.main.close();
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toEqual([]);
    expect(boot.mock.app.quitCount).toBeGreaterThan(0);
  });

  it('dirty → 确认丢弃：原生 dialog.showMessageBox 弹出，response=0 关窗退出', async () => {
    const boot = await bootConfirm();
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response: 0, checkboxChecked: false });
    wirePreloadConfirmClose(boot, () => true);
    boot.main.close();
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1);
    const opts = boot.mock.dialog.messageBoxCalls[0]!.opts;
    expect(opts.buttons).toHaveLength(2); // 丢弃 / 取消 双按钮
    expect(opts.cancelId).toBe(1); // 取消为默认安全侧
    expect(boot.mock.app.quitCount).toBeGreaterThan(0);
  });

  it('dirty → 取消：不关窗、不退出，可再次发起 close', async () => {
    const boot = await bootConfirm();
    let response = 1;
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response, checkboxChecked: false });
    wirePreloadConfirmClose(boot, () => true);
    boot.main.close();
    await vi.waitFor(() => expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1));
    expect(boot.main.isDestroyed()).toBe(false);
    expect(boot.mock.app.quitCount).toBe(0);

    // 再次 close：改答确认 → 关窗（真 preload 面订阅常驻，main 侧 once 每问询重挂）
    response = 0;
    boot.main.close();
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toHaveLength(2);
  });

  it('renderer 无应答超时 → 安全兜底按 dirty 处理（弹原生确认，取消则保窗）', async () => {
    const boot = await bootConfirm(10);
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response: 1, checkboxChecked: false });
    boot.main.close(); // 不注册 preload 应答（模拟 renderer 未加载）→ 超时兜底
    await vi.waitFor(() => expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1));
    expect(boot.main.isDestroyed()).toBe(false);
  });
});

describe('补跑 T3-05：app:confirmClose renderer 应答真通道（flowStore.dirty 驱动 main 决策）', () => {
  it('flowStore.markDirty → 应答 {dirty:true} → main 弹原生确认（取消则保窗）', async () => {
    const boot = await bootConfirm();
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response: 1, checkboxChecked: false });
    useFlowStore.getState().markDirty();
    expect(useFlowStore.getState().dirty).toBe(true); // 前置：renderer 侧脏标记就绪

    wirePreloadConfirmClose(boot, () => useFlowStore.getState().dirty);
    boot.main.close();
    await vi.waitFor(() => expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1));
    expect(boot.main.isDestroyed()).toBe(false);
  });

  it('flowStore.markSaved → 应答 {dirty:false} → main 直关不弹确认', async () => {
    const boot = await bootConfirm();
    useFlowStore.getState().markDirty();
    useFlowStore.getState().markSaved('v-test');
    expect(useFlowStore.getState().dirty).toBe(false);

    wirePreloadConfirmClose(boot, () => useFlowStore.getState().dirty);
    boot.main.close();
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toEqual([]);
  });
});
