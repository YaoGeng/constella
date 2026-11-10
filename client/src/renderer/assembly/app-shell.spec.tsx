// @vitest-environment jsdom
// app-shell 用例（T6-17 验收 1——挂载面存在性＋InstallConfirm 真弹窗宿主＋跳工坊事件锚）。
//
// 断言面（卡面验收四项之「挂载面存在性」；confirm 真注入/试跑绑定链/定位编排脏闸贯通在
// app-shell.runtime.spec.ts）：
//   - 挂载面：星空垫底（#sky/#vignette/#fade）＋顶栏导航（任务中心/系统设置/广场/工坊/＋节点/
//     日志）＋任务中心抽屉开合＋设置弹窗受控开合＋广场弹窗＋工坊面板＋FlowLogPanel 画布右下
//     覆盖位＋「＋节点」create 抽屉；
//   - InstallConfirmHost：confirm-host 在途请求→[data-ic] 真弹窗——确认钮 resolve(true)／
//     取消钮 resolve(false)（缺省放行的 UI 反义）；
//   - DrawerShell「让 AI 开发」事件锚：constella:workshop:open{prefill}→工坊开＋输入框预填。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { ConstellaApi } from '../../preload/api';
import { useCanvasStore } from '../canvas/canvas-store';
import { useFlowStore } from '../canvas/stores/flow-store';
import { createStorageClient, type StorageBridge } from '../storage';
import { attachSettingsStorage, SettingsDialog, useSettingsStore } from '../settings';
import { useShellStore } from './shell-store';
import { useUiStore } from '../taskcenter';
import { useWorkshopStore } from '../workshop';
import { installMatchMedia, installRaf, patchCanvas2D, resetSkyGlobals } from '../sky/testing';
import { createAppRuntime, type AppRuntime } from './app-runtime';
import { AppShell } from './app-shell';
import { createConfirmHost } from './confirm-host';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

/** preload 面 mock（storage op 最小应答——restoreRunState/load 序走通；flows.save 记录供 Ctrl+S 用例） */
function makeApi(): { api: ConstellaApi; saveCalls: StorageInvokeReq[] } {
  const saveCalls: StorageInvokeReq[] = [];
  const api = {
    appVersion: async () => ({ version: 'test' }),
    envSystemInfo: async () => ({ os: 'test', cpuCores: 1, memTotal: 1, runtimeVersions: {}, lanes: [] }),
    envCdpProbe: async () => ({ ok: true }),
    shellOpenExternal: async () => undefined,
    dialogOpenFile: async () => ({ path: null }),
    dialogSaveFile: async () => ({ path: null }),
    storageInvoke: async (req: StorageInvokeReq) => {
      switch (req.op) {
        case 'settings.getAll':
          return {};
        case 'definitions.loadAll':
          return [];
        case 'runs.list':
        case 'flows.list':
          return { items: [] };
        case 'flows.create':
          return { id: 'flow-ctrls' };
        case 'flows.save':
          saveCalls.push(req);
          return { versionId: 'v-ctrls' };
        default:
          return undefined;
      }
    },
    secretSet: async () => ({ ok: true }),
    secretGet: async () => ({ value: null }),
    secretDel: async () => ({ ok: true }),
    runSpawnScript: async () => ({ ok: true, pid: 1 }),
    runKillScript: async () => ({ ok: true }),
    cdpCreateSession: async () => ({ laneKey: 'main', port: 9321 }),
    cdpNavigate: async () => ({ ok: true }),
    cdpListSessions: async () => ({ sessions: [] }),
    cdpOpenViewer: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    cronUpsert: async () => ({ ok: true }),
    cronCancel: async () => ({ ok: true }),
    zipExport: async () => ({ file: 'x', count: 0, scripts: [] }),
    zipImport: async () => {
      throw new Error('zipImport 未配置');
    },
    cronFired: () => () => undefined,
    runScriptEvent: (_fn: (e: ScriptEvent) => void) => () => undefined,
    appConfirmClose: () => () => undefined,
  } as unknown as ConstellaApi;
  return { api, saveCalls };
}

const cleanups: Array<() => void> = [];
let rt: AppRuntime | null = null;
let rtSaveCalls: StorageInvokeReq[] = [];
let skyPatch: ReturnType<typeof patchCanvas2D>;
let skyRaf: ReturnType<typeof installRaf>;
let skyMm: ReturnType<typeof installMatchMedia>;

async function mount(ui: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  // 启动序异步面收口（boot/load/restoreRunState 微任务链——act 内清空防外泄 setState 告警）
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { container, root };
}

function makeRuntime(): AppRuntime {
  const { api, saveCalls } = makeApi();
  rtSaveCalls = saveCalls;
  rt = createAppRuntime({
    api,
    notify: () => undefined,
    confirm: async () => true,
  });
  return rt;
}

function click(el: Element | null | undefined): Promise<void> {
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  // SkyBackground jsdom 面（matchMedia/rAF/canvas2D——sky/testing 官方桩）
  skyPatch = patchCanvas2D();
  skyRaf = installRaf();
  skyMm = installMatchMedia(false);
  useShellStore.getState().reset();
  useUiStore.getState().reset();
  useWorkshopStore.getState().reset();
  useCanvasStore.getState().closeDrawer();
  useFlowStore.getState().loadFlow(null, { name: '未命名流程', nodes: [], edges: [] });
  useSettingsStore.setState({ loaded: false, values: useSettingsStore.getState().values });
});

afterEach(async () => {
  for (const fn of cleanups.splice(0)) fn();
  // AppShell 卸载即 runtime.dispose（boot effect cleanup）——rt 由各用例 mount/unmount 生命周期持有
  rt = null;
  document.body.innerHTML = '';
  skyRaf.restore();
  skyMm.restore();
  skyPatch.restore();
  resetSkyGlobals();
});

describe('挂载面存在性（产品壳组合根）', () => {
  it('星空垫底＋顶栏导航全位（tasks/settings/market/workshop/add-node/flow-log）', async () => {
    const confirmHost = createConfirmHost();
    const { container, root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    cleanups.push(() => undefined);
    try {
      // 星空三兄弟（SkyBackground——视图根垫底）
      expect(document.querySelector('#sky')).toBeTruthy();
      expect(document.querySelector('#vignette')).toBeTruthy();
      expect(document.querySelector('#fade')).toBeTruthy();
      // 顶栏导航（demo L593-601 mainnav 最小面）
      expect(container.querySelector('[data-shell="topbar"]')).toBeTruthy();
      for (const key of ['flow', 'tasks', 'settings', 'market', 'workshop', 'add-node', 'flow-log']) {
        expect(container.querySelector(`[data-shell-nav="${key}"]`), `nav=${key}`).toBeTruthy();
      }
      // 画布宿主（CanvasChrome——react-flow 挂载）
      expect(container.querySelector('.react-flow')).toBeTruthy();
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('任务中心：导航点击→抽屉开（data-task-center=panel）；escGate 弹窗仲裁（设置开=不应答）', async () => {
    const confirmHost = createConfirmHost();
    const { container, root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      // 抽屉壳恒挂载（translate 收起态）——开合判据=data-open 镜像＋遮罩在场
      expect(document.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('false');
      expect(document.querySelector('[data-task-center="shade"]')).toBeNull();
      await click(container.querySelector('[data-shell-nav="tasks"]'));
      expect(document.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('true');
      expect(document.querySelector('[data-task-center="shade"]')).toBeTruthy();

      // escGate 仲裁输入：设置弹窗在场=任务中心层不应答（A-1.4 弹窗层在任务中心之上）
      await click(container.querySelector('[data-shell-nav="settings"]'));
      expect(document.querySelector('[data-settings="dialog"]')).toBeTruthy();
      const escGate = rt!.taskCenterDeps.escGate!;
      expect(escGate()).toBe(false); // 设置弹窗在场
      await act(async () => {
        (container.querySelector('[data-settings="close"]') as HTMLElement | null)?.click();
      });
      expect(document.querySelector('[data-settings="dialog"]')).toBeNull();
      expect(escGate()).toBe(true); // 弹窗关闭后应答回归
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('广场弹窗＋工坊面板＋「＋节点」create 抽屉＋FlowLogPanel 画布右下覆盖位', async () => {
    const confirmHost = createConfirmHost();
    const { container, root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      // 广场（MarketBrowser——baseUrl 空=首次使用引导面板形态）
      await click(container.querySelector('[data-shell-nav="market"]'));
      expect(document.querySelector('[data-browser="root"]')).toBeTruthy();
      await click(document.querySelector('[data-browser="close"]'));
      expect(document.querySelector('[data-browser="root"]')).toBeNull();

      // 工坊（输入框＋断点卡挂载宿主）
      await click(container.querySelector('[data-shell-nav="workshop"]'));
      expect(document.querySelector('[data-workshop="panel"]')).toBeTruthy();
      expect(document.querySelector('[data-workshop="input"]')).toBeTruthy();

      // 「＋节点」（demo L2646 btnNewBlank→create 抽屉；editMode 默认开）
      await click(container.querySelector('[data-shell-nav="add-node"]'));
      expect(useCanvasStore.getState().drawer?.mode).toBe('create');

      // FlowLogPanel（画布右下覆盖位——外层 relative 容器绝对定位，需 activeFlowId）
      expect(document.querySelector('[data-flow-log="panel"]')).toBeNull(); // 无流程=不挂
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', { name: '流程一', nodes: [], edges: [] });
      });
      await click(container.querySelector('[data-shell-nav="flow-log"]'));
      const slot = container.querySelector('[data-shell="flow-log-slot"]');
      expect(slot).toBeTruthy();
      expect(slot?.querySelector('[data-flow-log="panel"]')).toBeTruthy();
      expect(useShellStore.getState().flowLogOpen).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('InstallConfirm 真弹窗宿主（confirm 真注入的 UI 半段）', () => {
  it('confirm 请求→[data-ic] 弹窗；确认钮 resolve(true)／取消钮 resolve(false)', async () => {
    const confirmHost = createConfirmHost();
    const { root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      let p1: Promise<boolean> = Promise.resolve(false); // act 内赋值（emit 同步触发订阅重渲染）
      await act(async () => {
        p1 = confirmHost.confirm({
          kind: 'node',
          name: '小红书搜索',
          version: '1.0.0',
          author: '@alice',
          source: 'market',
          trusted: true,
          perms: ['社媒'],
          nodes: [],
          noScript: [],
          scriptFiles: ['scripts/xhs_search.py'],
        });
      });
      expect(document.querySelector('[data-ic="root"]')).toBeTruthy(); // 真弹窗（非缺省放行）
      expect(useShellStore.getState().confirmPending).toBe(true);
      await act(async () => {
        (document.querySelector('[data-ic="confirm"]') as HTMLElement).click();
      });
      await expect(p1).resolves.toBe(true);
      expect(document.querySelector('[data-ic="root"]')).toBeNull();

      let p2: Promise<boolean> = Promise.resolve(true);
      await act(async () => {
        p2 = confirmHost.confirm({
          kind: 'flow',
          name: '运营流程',
          version: '1.0.0',
          author: '',
          source: 'zip',
          trusted: false,
          perms: [],
          nodes: [],
          noScript: ['弱节点'],
          scriptFiles: [],
        });
      });
      await act(async () => {
        (document.querySelector('[data-ic="cancel"]') as HTMLElement).click();
      });
      await expect(p2).resolves.toBe(false); // 取消=拒绝安装（12.2#2 未确认不入库）
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('「让 AI 开发」跳工坊事件锚（DrawerShell CustomEvent——P-3 无 import 边）', () => {
  it('constella:workshop:open{prefill} → 工坊开＋输入框预填（demo L2094-2100 冻结行为）', async () => {
    const confirmHost = createConfirmHost();
    const { root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        document.dispatchEvent(
          new CustomEvent('constella:workshop:open', {
            detail: { prefill: '帮我开发一个自定义节点（带脚本资产包）：' },
          }),
        );
      });
      expect(useShellStore.getState().workshopOpen).toBe(true);
      const input = document.querySelector('[data-workshop="input"]') as HTMLInputElement | null;
      expect(input?.value).toBe('帮我开发一个自定义节点（带脚本资产包）：');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('Ctrl+S 保存编排注入面（PM 补接线——CanvasChrome onSave→manual doSave）', () => {  it('document keydown Ctrl+S（dirty）→ flows.save(label=手动保存)——EditorKeyboard→onSave→runtime.save.manual 链可达', async () => {
    const confirmHost = createConfirmHost();
    const { root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      // 非 dirty：Ctrl+S 被 EditorKeyboard dirty 门拦截（零保存）
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      });
      expect(rtSaveCalls).toHaveLength(0);

      await act(async () => {
        useFlowStore.getState().markDirty();
      });
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // manual doSave 异步链收口
      });
      expect(rtSaveCalls).toHaveLength(1);
      expect((rtSaveCalls[0] as { args: { label: string } }).args).toMatchObject({ label: '手动保存' });
      expect(useFlowStore.getState().dirty).toBe(false); // markSaved 基线复位
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('危险区 factoryReset 失败 toast（返工 MAJOR-1.1——batch-1 转交③装配链 deps.toast→dialog→section）', () => {
  it('factoryReset op 拒绝 → deps.toast err 恰一次（此前仅 console.error 吞错）', async () => {
    const bridge: StorageBridge = {
      invoke: async (req) => {
        if (req.op === 'settings.getAll') return {};
        if (req.op === 'settings.factoryReset') throw new Error('DB locked');
        return undefined;
      },
    };
    attachSettingsStorage(createStorageClient(bridge));
    const toast = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<SettingsDialog open onClose={() => undefined} deps={{ toast }} />);
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-settings-nav="danger"]')?.click();
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-danger="open"]')?.click();
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-danger="confirm"]')?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // 失败链微任务收口
      });
      expect(toast).toHaveBeenCalledTimes(1); // 恰一次（成功/未确认路径零调用——见 settings-dialog.spec 既有覆盖）
      expect(toast.mock.calls[0]![0]).toMatch(/^恢复出厂失败：DB locked$/);
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      attachSettingsStorage(null);
    }
  });
});
