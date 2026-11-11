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
import type { FlowDoc, LaneMemory, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { ConstellaApi } from '../../preload/api';
import { useCanvasStore } from '../canvas/canvas-store';
import { useFlowStore } from '../canvas/stores/flow-store';
import { CanvasToastProvider } from '../canvas/toast';
import { useRunStore } from '../run';
import { useDefinitionDraftStore } from '../node-editor';
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

/** preload 面 mock（storage op 最小应答——restoreRunState/load 序走通；flows.save 记录供 Ctrl+S 用例；
 *  T6-19：impls 覆写面——运行按钮组/活行入表用例按 op 注入 mock IPC） */
function makeApi(
  opts: { lanes?: LaneMemory[] } = {},
): {
  api: ConstellaApi;
  saveCalls: StorageInvokeReq[];
  storageCalls: StorageInvokeReq[];
  setStorage(op: string, impl: (req: StorageInvokeReq) => Promise<unknown>): void;
} {
  const saveCalls: StorageInvokeReq[] = [];
  const storageCalls: StorageInvokeReq[] = [];
  const impls = new Map<string, (req: StorageInvokeReq) => Promise<unknown>>();
  // 脚本事件监听面（run:scriptEvent 订阅真形——kill→exit 帧推送＝run-taskcenter-smoke fake
  // transport 同款：被杀脚本的 exit 事件是 ExecDispatcher promise 的唯一 settle 面）
  const scriptEventListeners = new Set<(e: ScriptEvent) => void>();
  const api = {
    appVersion: async () => ({ version: 'test' }),
    envSystemInfo: async () => ({ os: 'test', cpuCores: 1, memTotal: 1, runtimeVersions: {}, lanes: opts.lanes ?? [] }),
    envCdpProbe: async () => ({ ok: true }),
    shellOpenExternal: async () => undefined,
    dialogOpenFile: async () => ({ path: null }),
    dialogSaveFile: async () => ({ path: null }),
    storageInvoke: async (req: StorageInvokeReq) => {
      storageCalls.push(req);
      const impl = impls.get(req.op);
      if (impl !== undefined) return impl(req);
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
    runKillScript: async (req: { nodeRunId: string }) => {
      // 强杀语义＝smoke fake transport 同款：推送 exit(1) 帧给订阅面（被杀脚本 promise settle）
      for (const fn of [...scriptEventListeners]) fn({ nodeRunId: req.nodeRunId, kind: 'exit', code: 1, ms: 1 });
      return { ok: true };
    },
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
    runScriptEvent: (fn: (e: ScriptEvent) => void) => {
      scriptEventListeners.add(fn);
      return () => {
        scriptEventListeners.delete(fn);
      };
    },
    appConfirmClose: () => () => undefined,
  } as unknown as ConstellaApi;
  return {
    api,
    saveCalls,
    storageCalls,
    setStorage: (op, impl) => {
      impls.set(op, impl);
    },
  };
}

const cleanups: Array<() => void> = [];
let rt: AppRuntime | null = null;
let rtSaveCalls: StorageInvokeReq[] = [];
let rtStorageCalls: StorageInvokeReq[] = [];
let rtSetStorage: ((op: string, impl: (req: StorageInvokeReq) => Promise<unknown>) => void) | null = null;
let rtNotify: ((level: 'info' | 'ok' | 'err' | 'warn', msg: string) => void) | null = null;
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

function makeRuntime(
  opts: { lanes?: LaneMemory[]; notify?: (level: 'info' | 'ok' | 'err' | 'warn', msg: string) => void } = {},
): AppRuntime {
  const { api, saveCalls, storageCalls, setStorage } = makeApi({ lanes: opts.lanes });
  rtSaveCalls = saveCalls;
  rtStorageCalls = storageCalls;
  rtSetStorage = setStorage;
  rtNotify = opts.notify ?? null;
  rt = createAppRuntime({
    api,
    notify: opts.notify ?? (() => undefined),
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
  useRunStore.getState().reset(); // T6-19：运行链用例隔离（activeRunOfFlow/lastRunOfFlow 镜像）
  useSettingsStore.setState({ loaded: false, values: useSettingsStore.getState().values });
  rtSetStorage = null;
  rtNotify = null;
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

describe('「手动定义」保存链生产接线（T6-16——DrawerShell→openNodeEditor deps.savePipeline）', () => {
  it('create 抽屉点「手动定义」→编辑器开＋deps.savePipeline=runtime 实例→保存钮不再 disabled/无「未装配」标', async () => {
    const confirmHost = createConfirmHost();
    const { container, root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        useCanvasStore.getState().openDrawer({ mode: 'create' });
      });
      await click(container.querySelector('[data-testid="drawer-custom-manual"]'));
      const st = useDefinitionDraftStore.getState();
      expect(st.open).toBe(true); // 生产入口打开 C-13 编辑器（create 态）
      expect(st.deps?.savePipeline).toBe(rt!.nodeEditor.savePipeline); // 生产 deps 注入（同实例——保存链可用）

      // 填充合法草稿推进到环节 6：保存钮 enabled＋「保存链未装配」态消解（T6-09 结构性测试的反义生产面）
      const fill = useDefinitionDraftStore.getState();
      fill.setType('demo.wired');
      fill.patchMeta({ name: '接线节点', category: '数据' });
      fill.setParamsSchema([{ k: 'q', t: 'text', required: true, default: 'x' }]);
      fill.patchScript({ lang: 'ts', ts: 'export const PARAMS = { q: "x" };\nexport async function run(ctx) { return {}; }\n' });
      useDefinitionDraftStore.getState().goToStep('save');
      await act(async () => {});
      const btn = document.querySelector('[data-testid="ne-save"]') as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      expect(btn?.disabled).toBe(false); // 不再 disabled
      expect(btn?.getAttribute('data-save-unwired')).toBeNull(); // 「保存链未装配」消解
    } finally {
      useDefinitionDraftStore.getState().reset();
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('lane 内存告警真数据 UI 复跑（T6-16——T6-11 mock 解除：env:systemInfo lanes→TaskNotices）', () => {
  it('超预算 lane 经 boot 轮询落 taskCenterDeps→任务中心面板渲染 [data-task-notice=lane-memory] 真形告警', async () => {
    const confirmHost = createConfirmHost();
    const runtime = makeRuntime({
      lanes: [{ laneKey: 'main', label: '主车道', workingSetBytes: 170 * 1024 * 1024 }], // >150MB 预算
    });
    const { container, root } = await mount(<AppShell runtime={runtime} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        await vi.waitFor(() => {
          expect(runtime.taskCenterDeps.laneMemories!()).toHaveLength(1); // boot 首拍真数据落地
        });
      });
      const notice = container.querySelector('[data-task-notice="lane-memory"]');
      expect(notice).toBeTruthy(); // 任务中心提示行在场（tasks tab 缺省）
      expect(notice?.textContent).toBe('「主车道」内存 170MB 超预算（150MB）'); // §8① 告警文案真形
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

// ————————————————————————————————————————————
// header 运行按钮组（T6-19 ①——walk 上线级阻断②：▶运行/■终止/保存/取消四钮装配；
// demo 锚：按钮组 L637-647、dirty 亮灭 L1300-1315、运行互斥 L1621-1631 syncModeUI、
// doSave L1638-1645、doCancel L1647-1654、startRun 三闸 L1788-1810、abortRun L1783-1787。
// undo/redo/版本下拉=V2 维持登记（NOTE-5）不装配。
// ————————————————————————————————————————————

describe('header 运行按钮组（T6-19——▶运行/■终止/保存/取消）', () => {
  const TRIGGER_DEF: NodeDefinition = {
    type: 'trigger.manual',
    kind: 'builtin',
    meta: { name: '手动触发', icon: '⚡', category: '触发' },
    ports: { ins: [], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
  const CUSTOM_DEF: NodeDefinition = {
    type: 'custom.x',
    kind: 'custom',
    meta: { name: '脚本节点', icon: '🔧', category: '数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: { lang: 'ts', file: 'scripts/x.ts', entry: 'run' },
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
  const FLOW: FlowDoc = {
    id: 'f-1',
    name: '按钮组流程',
    nodes: [
      { id: 't1', type: 'trigger.manual', name: '触发', position: { x: 0, y: 0 }, params: {} },
      { id: 'x1', type: 'custom.x', name: '脚本', position: { x: 200, y: 0 }, params: {} },
    ],
    edges: [{ id: 'e0', from: ['t1', 'out'], to: ['x1', 'in'] }],
  };

  /** 运行链 mock IPC（defs 经 definitions.loadAll 装载＋runs 域内存镜像——startRun 全链走通） */
  function wireRunOps(): void {
    rtSetStorage!('definitions.loadAll', async () => [TRIGGER_DEF, CUSTOM_DEF]);
    const recs = new Map<string, { id: string; flowId: string; name: string; status: string; t0: number; t1: number | null; aborted: number; failed: number; total: number; skips: unknown[]; createdAt: number }>();
    let seq = 0;
    rtSetStorage!('runs.list', async () => ({ items: [...recs.values()] }));
    rtSetStorage!('runs.create', async (req) => {
      const { flowId, name } = (req as { op: 'runs.create'; args: { flowId: string; name: string } }).args;
      const id = `r${++seq}`;
      recs.set(id, { id, flowId, name, status: 'running', t0: Date.now(), t1: null, aborted: 0, failed: 0, total: 0, skips: [], createdAt: Date.now() });
      return { id };
    });
    rtSetStorage!('runs.finish', async (req) => {
      const a = (req as { op: 'runs.finish'; args: { runId: string; status: string; t1: number } }).args;
      const rec = recs.get(a.runId);
      if (rec !== undefined) {
        rec.status = a.status;
        rec.t1 = a.t1;
      }
      return undefined;
    });
    rtSetStorage!('flows.get', async () => FLOW);
    for (const op of ['runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append']) rtSetStorage!(op, async () => undefined);
  }

  /** 便捷取钮（data-shell-btn 面） */
  const btn = (key: string): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`[data-shell-btn="${key}"]`);

  /** 等待断言（真定时器轮询——微任务/IPC 链收口；label=失败定位面） */
  async function waitFor(label: string, cond: () => boolean, ms = 2000): Promise<void> {
    await act(async () => {
      await vi.waitFor(() => {
        if (!cond()) throw new Error(`waitFor not met: ${label}`);
      }, { timeout: ms });
    });
  }

  it('四钮存在性＋clean/dirty 与运行互斥（demo L637-647/L1300-1315/L1621-1631）', async () => {
    const confirmHost = createConfirmHost();
    const { container, root } = await mount(<AppShell runtime={makeRuntime()} confirmHost={confirmHost} />);
    try {
      for (const key of ['save', 'cancel', 'run', 'stop']) {
        expect(btn(key), `btn=${key}`).toBeTruthy();
      }
      // clean（无当前流程）：保存/取消/运行禁用、终止禁用（demo 初始 markup L639-640/646-647 disabled 面）
      expect(btn('save')!.disabled).toBe(true); // demo L1315 clearDirty→disabled
      expect(btn('cancel')!.disabled).toBe(true);
      expect(btn('run')!.disabled).toBe(true); // 无当前流程（activeFlowId=null——壳无流程态禁用）
      expect(btn('stop')!.disabled).toBe(true); // demo L1625 btnStop.disabled=!running

      // 有当前流程 clean：运行可用；dirty：保存/取消亮起（demo L1304 markDirty→enabled）
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', FLOW);
      });
      expect(btn('run')!.disabled).toBe(false);
      expect(btn('save')!.disabled).toBe(true);
      await act(async () => {
        useFlowStore.getState().markDirty();
      });
      expect(btn('save')!.disabled).toBe(false); // demo L1304
      expect(btn('cancel')!.disabled).toBe(false);
      void container;
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('▶运行→engine.startRun(activeFlowId)（mock IPC runs.create）＋运行互斥翻转＋活行入任务表', async () => {
    const confirmHost = createConfirmHost();
    const runtime = makeRuntime(); // 先构造（rtSetStorage 绑定）再注 mock IPC（boot 装载序消费）
    wireRunOps();
    const { container, root } = await mount(<AppShell runtime={runtime} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', FLOW);
      });
      await click(container.querySelector('[data-shell-nav="tasks"]')); // 任务中心开（行可见面）

      await click(btn('run'));
      await waitFor('runs.create', () => rtStorageCalls.some((c) => c.op === 'runs.create')); // 运行链 mock IPC 边界
      const createCall = rtStorageCalls.find((c) => c.op === 'runs.create');
      expect((createCall as { args: { flowId: string } } | undefined)?.args?.flowId).toBe('f-1'); // 当前流程
      // 运行互斥（demo L1623-1625：btnRun.disabled=running / btnStop.disabled=!running）
      await waitFor('run disabled', () => btn('run')!.disabled === true);
      expect(btn('stop')!.disabled).toBe(false);
      // 活行入表（T6-19 ②）：onRunsChanged→source.refresh→任务表出现 running 行
      await waitFor('task row appears', () => document.querySelector('[data-task-center="rows"] [data-task-row]') !== null);
      const row = document.querySelector('[data-task-center="rows"] [data-task-row]');
      expect(row?.querySelector('[data-task-tone]')?.getAttribute('data-task-tone')).toBe('ok'); // running=青（STATUS_TONE）
      expect(row?.textContent).toContain('按钮组流程');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('■终止→abortRun 收尾行翻转 aborted（任务表行 tone off）', async () => {
    const confirmHost = createConfirmHost();
    const runtime = makeRuntime(); // 先构造（rtSetStorage 绑定）再注 mock IPC（boot 装载序消费）
    wireRunOps();
    const { container, root } = await mount(<AppShell runtime={runtime} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', FLOW);
      });
      await click(container.querySelector('[data-shell-nav="tasks"]'));
      await click(btn('run'));
      await waitFor('task row appears', () => document.querySelector('[data-task-row]') !== null);
      const runId = document.querySelector('[data-task-row]')!.getAttribute('data-task-row');

      await click(btn('stop')); // ■ 终止（当前流程活跃 run——demo L1957）
      await waitFor(`row ${runId} flips aborted`, () => {
        const row = document.querySelector(`[data-task-row="${runId}"]`);
        return row?.querySelector('[data-task-tone]')?.getAttribute('data-task-tone') === 'off' && (row?.textContent ?? '').includes('已终止');
      });
      // 互斥复位（demo L1623-1625）
      await waitFor('run re-enabled', () => btn('run')!.disabled === false);
      expect(btn('stop')!.disabled).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });


  it('保存钮→saveManual 链（flows.save label=手动保存）＋「已保存到本地」＋dirty 复位（demo L1638-1645）', async () => {
    const notify = vi.fn();
    const confirmHost = createConfirmHost();
    const { root } = await mount(<AppShell runtime={makeRuntime({ notify })} confirmHost={confirmHost} />);
    try {
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', FLOW);
        useFlowStore.getState().markDirty();
      });
      expect(btn('save')!.disabled).toBe(false);
      await click(btn('save'));
      await waitFor('flows.save called', () => rtSaveCalls.length === 1);
      expect((rtSaveCalls[0] as { args: { id: string; label: string } }).args).toMatchObject({ id: 'f-1', label: '手动保存' });
      expect(notify).toHaveBeenCalledWith('ok', '已保存到本地'); // demo L1643 逐字
      await waitFor('dirty reset', () => useFlowStore.getState().dirty === false); // markSaved 基线复位
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('取消钮→还原到上次保存点（nodes/edges 回基线＋dirty 复位）＋toast「已还原到上次保存」（demo L1647-1654）', async () => {
    const confirmHost = createConfirmHost();
    const { root } = await mount(
      <CanvasToastProvider>
        <AppShell runtime={makeRuntime()} confirmHost={confirmHost} />
      </CanvasToastProvider>,
    );
    try {
      await act(async () => {
        useFlowStore.getState().loadFlow('f-1', FLOW);
        useFlowStore.getState().addNodes([
          { id: 'new-1', type: 'constella-node', position: { x: 40, y: 40 }, data: { nodeId: 'new-1', type: 'custom.x', name: '新增', params: {} } },
        ]);
      });
      expect(useFlowStore.getState().dirty).toBe(true);
      expect(useFlowStore.getState().nodes).toHaveLength(3);

      await click(btn('cancel'));
      expect(useFlowStore.getState().nodes).toHaveLength(2); // 回基线（新增节点撤销）
      expect(useFlowStore.getState().dirty).toBe(false); // demo L1651 clearDirty
      expect(document.querySelector('.cn-toast')?.textContent).toBe('已还原到上次保存'); // demo L1653 逐字
      expect(btn('save')!.disabled).toBe(true); // clearDirty→保存/取消复归禁用（demo L1315）
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
