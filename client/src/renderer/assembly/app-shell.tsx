// AppShell —— 产品壳装配件（T6-17；卡面③产品壳挂载位：星空垫底/画布〔含 FlowLogPanel 画布
// 右下覆盖位〕/任务中心〔Provider+Panel+C-10 定位编排 deps〕/设置弹窗入口/工坊面板/广场面板
// /节点库「＋节点」入口/导航徽标 RunBadge）。
//
// 壳=唯一合法跨模块编排点（P-3）：各面板组件的消费组合在此；模块间仍无 import 边。
// 壳视觉对齐 demo **仅登记移交 T6-16 walk**——本卡只交付挂载面与接线（最小可用视觉）。
// 挂载结构（z 序）：#sky/#vignette/#fade（SkyBackground 自注入 fixed z:0 垫底）→ 壳根
// （header 导航＋main〔canvas host＋右栏工坊〕）→ 任务中心抽屉 → 设置/广场/安装确认弹窗。
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LogLevel } from '@constella/shared/ipc';
import { CanvasChrome, type CanvasChromeProps } from '../canvas';
import { CanvasRegistryContext } from '../canvas/registry-context';
import { useCanvasToast } from '../canvas/toast';
import { useCanvasStore } from '../canvas/canvas-store';
import { useFlowStore } from '../canvas/stores/flow-store';
import { SkyBackground } from '../sky';
import {
  attachSettingsStorage,
  createSettingsDispatcher,
  SettingsDialog,
  useSettingsStore,
  type SettingsDispatcherDeps,
} from '../settings';
import {
  FlowLogPanel,
  RunBadge,
  TaskCenterPanel,
  TaskCenterProvider,
  runningCountOf,
  useRunRows,
  useTaskCenter,
  useUiStore,
} from '../taskcenter';
import { InstallConfirm, MarketBrowser, useOfflineState } from '../market';
import type { AppRuntime, ViewportInstanceFace } from './app-runtime';
import { useShellStore } from './shell-store';
import type { ConfirmHost, NotifyHost } from './confirm-host';
import { WorkshopPanel } from './workshop-panel';

/** CanvasChrome onInit 透传面（ReactFlowProps rest——instance 经结构化 face 持有，P-3） */
type CanvasOnInit = NonNullable<CanvasChromeProps['onInit']>;

/** bg 纯黑＝#sky/#vignette 隐藏（demo L2704-2711 applyBg 的 DOM 半段——T6-12 留位兑现） */
function applySkyHidden(black: boolean): void {
  const sky = document.getElementById('sky');
  const vignette = document.getElementById('vignette');
  if (sky !== null) sky.style.display = black ? 'none' : '';
  if (vignette !== null) vignette.style.display = black ? 'none' : '';
}

/** InstallConfirm 命令式宿主（confirm-host 在途请求→受控弹窗；决出＝resolve 归宿） */
function InstallConfirmHost({ host }: { host: ConfirmHost }) {
  const req = useSyncExternalStore(
    useCallback((fn: () => void) => host.subscribe(fn), [host]),
    () => host.snapshot(),
    () => host.snapshot(),
  );
  const setConfirmPending = useShellStore((s) => s.setConfirmPending);
  useEffect(() => {
    setConfirmPending(req !== null);
  }, [req, setConfirmPending]);
  if (req === null) return null;
  return <InstallConfirm data={req.data} onConfirm={() => req.resolve(true)} onCancel={() => req.resolve(false)} />;
}

/** 启动重放连接器（T6-11 装配形态：restoreRunState→setRuns/setMissed——Provider 内消费 handle） */
function TaskCenterRestore({ runtime }: { runtime: AppRuntime }) {
  const handle = useTaskCenter();
  useEffect(() => {
    let disposed = false;
    void runtime.replay
      .restoreRunState()
      .then((res) => {
        if (disposed) return;
        handle?.source.setRuns(res.records);
        handle?.notices.setMissed(res.missedFires);
      })
      .catch((err) => {
        console.error('[app-shell] restoreRunState failed:', err);
      });
    return () => {
      disposed = true;
    };
  }, [runtime, handle]);
  return null;
}

export interface AppShellProps {
  runtime: AppRuntime;
  /** InstallConfirm 命令式宿主（confirm 真注入的 UI 半段；缺省=不挂确认框〔仅测试〕） */
  confirmHost?: ConfirmHost;
  /** toast 绑定宿主（生产 runtime notify 的 UI 半段——挂载后绑定画布 toast 队列） */
  notifyHost?: NotifyHost;
}

export function AppShell({ runtime, confirmHost, notifyHost }: AppShellProps) {
  const toast = useCanvasToast();
  const notify = useCallback((level: LogLevel, msg: string) => void toast(msg), [toast]);

  // runtime notify 绑定（生产：index.tsx 构造期 notify=notifyHost.notify——挂载后落到画布队列）
  useEffect(() => {
    notifyHost?.bind((level, msg) => void toast(msg));
    return () => notifyHost?.bind(null);
  }, [notifyHost, toast]);

  const settingsOpen = useShellStore((s) => s.settingsOpen);
  const closeSettings = useShellStore((s) => s.closeSettings);
  const marketOpen = useShellStore((s) => s.marketOpen);
  const closeMarket = useShellStore((s) => s.closeMarket);
  const openMarket = useShellStore((s) => s.openMarket);
  const workshopOpen = useShellStore((s) => s.workshopOpen);
  const openWorkshop = useShellStore((s) => s.openWorkshop);
  const flowLogOpen = useShellStore((s) => s.flowLogOpen);
  const toggleFlowLog = useShellStore((s) => s.toggleFlowLog);
  const closeFlowLog = useShellStore((s) => s.closeFlowLog);
  const autoSaveOn = useShellStore((s) => s.autoSaveOn);

  const activeFlowId = useFlowStore((s) => s.activeFlowId);
  const flowName = useFlowStore((s) => s.name);

  // ———— 设置装配（T6-12 启动序：attach+load→dispatcher.install 两加载序回放＋初始应用） ————
  // scheduler=runtime AutoSaveScheduler 实例（autoSave 开→schedule 门控真实生效——PM 补接线）
  const dispatcherDeps: SettingsDispatcherDeps = useMemo(
    () => ({
      toast: (text) => void toast(text),
      readDirty: () => useFlowStore.getState().dirty,
      scheduler: runtime.save.scheduler,
      onAutoSaveChange: (on) => useShellStore.getState().setAutoSaveOn(on),
      onBgChange: (black) => applySkyHidden(black),
    }),
    [toast, runtime],
  );
  const dispatcher = useMemo(() => createSettingsDispatcher(dispatcherDeps), [dispatcherDeps]);

  useEffect(() => {
    attachSettingsStorage(runtime.storage);
    let unmounted = false;
    void useSettingsStore
      .getState()
      .load()
      .then(() => {
        if (unmounted) return;
        dispatcher.applySetting('bg'); // bg 纯黑初始态（pause＋#sky 隐藏）
        dispatcher.applySetting('autoSave'); // 徽标初始联动＋scheduler 门控（开且 dirty→补排）
      })
      .catch(() => undefined);
    const uninstall = dispatcher.install(); // __skyReady 回放注册（两加载序恰一次）
    void runtime.boot().catch((err) => console.error('[app-shell] runtime boot failed:', err));
    return () => {
      unmounted = true;
      uninstall();
      runtime.dispose();
      attachSettingsStorage(null);
    };
  }, [runtime, dispatcher]);

  // ————「让 AI 开发」跳工坊事件（DrawerShell CustomEvent 锚——P-3 无 import 边） ————
  useEffect(() => {
    const onOpenWorkshop = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ prefill?: string }>).detail;
      useShellStore.getState().openWorkshop(detail?.prefill);
      toast('自定义节点由 AI 现场开发脚本资产包，或从广场 / zip 导入'); // demo L2098 逐字
    };
    document.addEventListener('constella:workshop:open', onOpenWorkshop);
    return () => document.removeEventListener('constella:workshop:open', onOpenWorkshop);
  }, [toast]);

  // ———— 视口 instance 绑定（CanvasChrome onInit 透传——panToNode/fitView/viewportCenter 源） ————
  const onCanvasInit = useCallback(
    (instance: Parameters<CanvasOnInit>[0]) => runtime.bindViewport(instance as ViewportInstanceFace),
    [runtime],
  );

  // ———— 节点库「＋节点」入口（demo L2646 btnNewBlank：编辑态守卫→create 抽屉） ————
  const openNodeLibraryCreate = useCallback((): void => {
    const { editMode } = useCanvasStore.getState();
    if (!editMode) {
      toast('先点「编辑」再添加节点'); // demo L2646 逐字
      return;
    }
    useCanvasStore.getState().openDrawer({ mode: 'create' });
  }, [toast]);

  const offline = useOfflineState(runtime.market.degradation);

  return (
    <>
      {/* 星空背景（视图根垫底——C-12；z 序=自身注入 fixed z:0，壳内容在其上） */}
      <SkyBackground />
      <div data-shell="root" className="relative z-[1] flex h-full flex-col">
        <TaskCenterProvider deps={runtime.taskCenterDeps}>
          <TaskCenterRestore runtime={runtime} />
          {/* 顶栏导航（demo L590-612 topbar 最小面——视觉对齐移交 T6-16） */}
          <header data-shell="topbar" className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--glass)] px-3 py-2 backdrop-blur-[10px]">
            <b data-shell="brand" className="text-sm text-[var(--tx)]">
              星丛 <span className="font-normal text-[var(--tx-2)]">Constella</span>
            </b>
            <nav data-shell="nav" className="ml-2 flex items-center gap-1">
              <button
                type="button"
                data-shell-nav="flow"
                title="适配视野"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={() => runtime.viewport.fitView()}
              >
                ⌖ 工作流
              </button>
              <TaskCenterNavButton />
              <button
                type="button"
                data-shell-nav="settings"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={() => useShellStore.getState().openSettings()}
              >
                系统设置
              </button>
              <button
                type="button"
                data-shell-nav="market"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={() => openMarket()}
              >
                广场
              </button>
              <button
                type="button"
                data-shell-nav="workshop"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={() => openWorkshop()}
              >
                ✨ 工坊
              </button>
              <button
                type="button"
                data-shell-nav="add-node"
                title="新建空白节点并打开抽屉"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={openNodeLibraryCreate}
              >
                ＋节点
              </button>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {autoSaveOn && (
                <span data-shell="autosave-badge" className="rounded border border-[var(--accent-line)] bg-[var(--accent-tint)] px-1.5 py-0.5 text-[10px] leading-4 text-[var(--accent-hi)]">
                  自动保存
                </span>
              )}
              <button
                type="button"
                data-shell-nav="flow-log"
                aria-pressed={flowLogOpen}
                className="rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
                onClick={toggleFlowLog}
              >
                📋 日志
              </button>
            </div>
          </header>

          {/* 主区：画布宿主〔外层 relative——FlowLogPanel 画布右下覆盖位，不改 canvas/ 内部〕＋工坊右栏 */}
          <main data-shell="stage" className="relative flex min-h-0 flex-1">
            <div data-shell="canvas-wrap" className="relative min-w-0 flex-1">
              <CanvasRegistryContext.Provider value={runtime.registry}>
                {/* onSave=Ctrl+S 编排注入位（T1-08/T4-13——EditorKeyboard dirty 门→manual doSave） */}
                <CanvasChrome onInit={onCanvasInit} onSave={runtime.save.manual} />
              </CanvasRegistryContext.Provider>
              {flowLogOpen && activeFlowId !== null && (
                <div data-shell="flow-log-slot" className="pointer-events-none absolute bottom-3 right-3 z-[18]">
                  <div className="pointer-events-auto">
                    <FlowLogPanel
                      flowId={activeFlowId}
                      flowName={flowName}
                      replayLogs={(fid) => runtime.replay.replayLogs(fid)}
                      subscribeLogs={(fn) => runtime.logsBus.subscribe(fn)}
                      onClose={closeFlowLog}
                    />
                  </div>
                </div>
              )}
            </div>
            {workshopOpen && <WorkshopPanel runtime={runtime} notify={notify} />}
          </main>

          {/* 任务中心抽屉（开合=taskcenter/uiStore；escGate 仲裁经 deps 注入） */}
          <TaskCenterPanel />
        </TaskCenterProvider>

        {/* 设置弹窗（受控 open——T6-12 ⚠ 留位兑现；deps=dispatcher 注入位） */}
        <SettingsDialog open={settingsOpen} onClose={closeSettings} deps={dispatcherDeps} />

        {/* 广场弹窗（MarketBrowser——createMarketAssembly browserFaces 消费＋离线态注入） */}
        {marketOpen && (
          <MarketBrowser
            listFace={{ list: (q) => runtime.market.browserFaces.list(q) }}
            auth={runtime.market.browserFaces.auth}
            onDownload={runtime.market.browserFaces.onDownload}
            onClose={closeMarket}
            offline={offline === 'offline'}
          />
        )}

        {/* 安装确认真弹窗（两拦截点共用一框——confirm-host UI 半段） */}
        {confirmHost !== undefined && <InstallConfirmHost host={confirmHost} />}
      </div>
    </>
  );
}

/** 任务中心导航钮（徽标=RunBadge〔runningCountOf〕；开合=taskcenter/uiStore toggle） */
function TaskCenterNavButton() {
  const rows = useRunRows();
  const toggle = useUiStore((s) => s.toggleTaskCenter);
  return (
    <button
      type="button"
      data-shell-nav="tasks"
      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[var(--tx-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-hi)]"
      onClick={toggle}
    >
      任务中心
      <RunBadge count={runningCountOf(rows)} />
    </button>
  );
}
