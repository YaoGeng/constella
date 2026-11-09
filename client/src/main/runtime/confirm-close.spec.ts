// confirmClose 链路用例（T4-13 / TDD-C-M1 §1 app:confirmClose 行＋§3 AppRuntime 行）。
//
// 语义（02 §3.3/§3.4）：main 拦截主窗 close → m→r 问 renderer dirty（app:confirmClose 带响应
// {dirty}）→ dirty 时原生 dialog.showMessageBox 确认丢弃/取消。两分支＋超时兜底＋
// 补跑 T3-05（app:confirmClose renderer 应答真通道——P3 区头 d 项收口：flowStore.dirty 经
// app:confirmClose 回程腿驱动 main 关窗决策；preload 真面=T4-14，本套以 stand-in preload 腿
// 模拟 ipcRenderer.on→handler→ipcRenderer.send 回程——通道名/应答形与冻结面一致）。
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { useFlowStore } from '../../renderer/canvas/stores/flow-store';
import { AppRuntime } from './app-runtime';
import { createMockElectron, type MockBrowserWindow, type MockWebContents } from './testing/mock-electron';

const RENDERER_DIR = 'C:\\mock-app\\dist\\renderer';

interface ConfirmBoot {
  runtime: AppRuntime;
  main: MockBrowserWindow;
  mainWc: MockWebContents;
  mock: ReturnType<typeof createMockElectron>;
}

async function bootConfirm(timeoutMs = 2000): Promise<ConfirmBoot> {
  const mock = createMockElectron();
  const runtime = new AppRuntime({
    electron: mock.api,
    rendererDir: RENDERER_DIR,
    preloadPath: 'C:\\mock-app\\dist\\preload\\index.js',
    confirmCloseTimeoutMs: timeoutMs,
  });
  await runtime.startup();
  const main = mock.createdWindows[0]!;
  return { runtime, main, mainWc: main.webContents, mock };
}

/** stand-in preload 腿（T4-14 交付真 preload 面；本套模拟其行为）：
 *  ipcRenderer.on(app:confirmClose) → 调 dirtySource → ipcRenderer.send 同通道回程 {dirty} */
async function answerAsPreload(
  boot: ConfirmBoot,
  dirtySource: () => boolean,
): Promise<void> {
  await vi.waitFor(() =>
    expect(boot.mainWc.sent.some((s) => s.channel === IPC_CHANNELS.appConfirmClose)).toBe(true),
  );
  boot.mock.ipcMain.rendererSend(IPC_CHANNELS.appConfirmClose, { dirty: dirtySource() });
}

describe('confirmClose dirty 两分支（C-M1 §1 app:confirmClose 行）', () => {
  it('不 dirty → 直关：无原生确认，关窗并触发退出', async () => {
    const boot = await bootConfirm();
    boot.main.close();
    await answerAsPreload(boot, () => false);
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toEqual([]);
    expect(boot.mock.app.quitCount).toBeGreaterThan(0);
  });

  it('dirty → 确认丢弃：原生 dialog.showMessageBox 弹出，response=0 关窗退出', async () => {
    const boot = await bootConfirm();
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response: 0, checkboxChecked: false });
    boot.main.close();
    await answerAsPreload(boot, () => true);
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
    boot.main.close();
    await answerAsPreload(boot, () => true);
    await vi.waitFor(() => expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1));
    expect(boot.main.isDestroyed()).toBe(false);
    expect(boot.mock.app.quitCount).toBe(0);

    // 再次 close：改答确认 → 关窗
    response = 0;
    boot.main.close();
    await answerAsPreload(boot, () => true);
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toHaveLength(2);
  });

  it('renderer 无应答超时 → 安全兜底按 dirty 处理（弹原生确认，取消则保窗）', async () => {
    const boot = await bootConfirm(10);
    boot.mock.dialog.showMessageBoxImpl = async () => ({ response: 1, checkboxChecked: false });
    boot.main.close();
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

    boot.main.close();
    // stand-in preload 腿应答源＝真实 flowStore.dirty（T3-05 卡冻结语义）
    await answerAsPreload(boot, () => useFlowStore.getState().dirty);
    await vi.waitFor(() => expect(boot.mock.dialog.messageBoxCalls).toHaveLength(1));
    expect(boot.main.isDestroyed()).toBe(false);
  });

  it('flowStore.markSaved → 应答 {dirty:false} → main 直关不弹确认', async () => {
    const boot = await bootConfirm();
    useFlowStore.getState().markDirty();
    useFlowStore.getState().markSaved('v-test');
    expect(useFlowStore.getState().dirty).toBe(false);

    boot.main.close();
    await answerAsPreload(boot, () => useFlowStore.getState().dirty);
    await vi.waitFor(() => expect(boot.main.isDestroyed()).toBe(true));
    expect(boot.mock.dialog.messageBoxCalls).toEqual([]);
  });
});
