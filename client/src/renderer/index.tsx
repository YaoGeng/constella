// Constella renderer 入口（T0-08 最小壳 → T3-01 CanvasModule → T6-17 完整产品壳装配收口）。
// 经 app:// 特权协议加载（S-1 ③）。两形态：
//   - 产品态（无 #e2e hash）：AppShell（assembly/app-shell——星空垫底/画布+FlowLogPanel/
//     任务中心/设置/工坊/广场/＋节点＋C-10 定位编排；runtime=assembly/app-runtime 生产构造
//     〔FlowMaterializer/NodeDevAgent 生产接线＋RunEngine＋market 真装配 confirm=InstallConfirm〕）；
//   - #e2e 模式：canvas-e2e.mjs 最小装配（无 storage/preload 消费面——registry=最小定义集、
//     settings 无 attach 默认值路径），__CONSTELLA_E2E__ 钩子照旧。
import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { FlowDoc } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import './styles/tailwind.css';
import { CanvasChrome } from './canvas';
import { CanvasToastProvider } from './canvas/toast';
import { CanvasEdgeAnimContext, CanvasRegistryContext, CanvasSnapContext } from './canvas/registry-context';
import { RunStatusBinding } from './canvas/run-status-binding';
import { useFlowStore } from './canvas/stores/flow-store';
import { useCanvasStore } from './canvas/canvas-store';
import { useRunStore } from './run/run-store';
import { createNodeRegistry } from './node-registry';
import { selectEdgeAnim, selectSnap, useSettingsStore } from './settings';
import { AppShell } from './assembly/app-shell';
import { createAppRuntime } from './assembly/app-runtime';
import { createConfirmHost, createNotifyHost } from './assembly/confirm-host';
import { useShellStore } from './assembly/shell-store';

const IS_E2E = location.hash === '#e2e';

/** 产品运行时（模块级一次构造——#e2e 模式不构造：无 preload/storage 消费面） */
const product = IS_E2E
  ? null
  : (() => {
      const confirmHost = createConfirmHost();
      const notifyHost = createNotifyHost();
      const runtime = createAppRuntime({
        api: window.constella,
        notify: notifyHost.notify,
        confirm: confirmHost.confirm, // 真注入（缺省放行的反义——T6-17 卡面①）
        onUnauthorized: () => useShellStore.getState().openMarket(), // 登录引导=开广场（内含 LoginDialog）
      });
      return { runtime, confirmHost, notifyHost };
    })();

/** E2E 最小定义集（#e2e 模式装配——产品装载序 T1-10 经 storage 种子，e2e 环境无 storage）。 */
function e2eDefinitions(): NodeDefinition[] {
  const base = { paramsSchema: [], exec: null, version: '1.0.0', packageVersion: '1.0.0' };
  return [
    {
      ...base,
      type: 'llm.chat',
      kind: 'builtin',
      meta: { name: '对话', icon: '💬', category: 'AI' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    },
    {
      ...base,
      type: 'trigger.manual',
      kind: 'builtin',
      meta: { name: '手动', icon: '⚡', category: '触发' },
      ports: { ins: [], outs: [{ id: 'out', label: '输出' }] },
    },
  ];
}

/**
 * 应用装配根：
 * - snap/edgeAnim＝settingsStore 装配（T6-12：useState→订阅 settingsStore；产品态启动序
 *   attachSettingsStorage+load 在 AppShell boot 接线，#e2e 模式保持无 storage 默认值路径）。
 * - registry 装配：产品态=runtime.registry（T1-10 storage 装载序——AppShell 内 Provider 注入）；
 *   #e2e 模式装配最小定义集（三查/渲染需真 def）。
 * - E2E 钩子：仅 #e2e hash 时暴露 window.__CONSTELLA_E2E__（产品会话零暴露面；
 *   contextIsolation+sandbox 下 renderer window 无跨源可达性）。canvas-e2e.mjs 消费。
 */
function App() {
  const snap = useSettingsStore(selectSnap);
  const edgeAnim = useSettingsStore(selectEdgeAnim);
  const registry = useMemo(() => {
    if (!IS_E2E) return null;
    const reg = createNodeRegistry();
    for (const def of e2eDefinitions()) reg.register(def);
    return reg;
  }, []);

  useEffect(() => {
    if (!IS_E2E) return;
    (window as unknown as Record<string, unknown>).__CONSTELLA_E2E__ = {
      flow: useFlowStore.getState,
      canvas: useCanvasStore.getState,
      temporal: useFlowStore.temporal.getState,
      loadFlow: (flowId: string, doc: FlowDoc) => useFlowStore.getState().loadFlow(flowId, doc),
      // runStore 驱动面（§6.2f 运行态 E2E——真实事件源=RunEngine，e2e 环境无执行面直接驱动镜像）
      run: useRunStore.getState,
      // snap/edgeAnim 驱动面：settingsStore 镜像直写（#e2e 无 storage 默认值路径——不经
      // setSetting/settings.set op，与 canvas-e2e a1/a2 场景口径一致）
      setSnap: (v: boolean) =>
        useSettingsStore.setState((s) => ({ values: { ...s.values, snap: v } })),
      setEdgeAnim: (v: boolean) =>
        useSettingsStore.setState((s) => ({ values: { ...s.values, edgeAnim: v } })),
    };
    console.log('[constella-renderer] e2e hook armed (#e2e)');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (IS_E2E) {
    return (
      <CanvasToastProvider>
        <RunStatusBinding>
          <CanvasSnapContext.Provider value={snap}>
            <CanvasEdgeAnimContext.Provider value={edgeAnim}>
              <CanvasRegistryContext.Provider value={registry}>
                <CanvasChrome />
              </CanvasRegistryContext.Provider>
            </CanvasEdgeAnimContext.Provider>
          </CanvasSnapContext.Provider>
        </RunStatusBinding>
      </CanvasToastProvider>
    );
  }

  // 产品态：完整应用壳（T6-17 装配收口——registry Provider 在 AppShell 内按 runtime 注入）
  return (
    <CanvasToastProvider>
      <RunStatusBinding>
        <CanvasSnapContext.Provider value={snap}>
          <CanvasEdgeAnimContext.Provider value={edgeAnim}>
            <AppShell
              runtime={product!.runtime}
              confirmHost={product!.confirmHost}
              notifyHost={product!.notifyHost}
            />
          </CanvasEdgeAnimContext.Provider>
        </CanvasSnapContext.Provider>
      </RunStatusBinding>
    </CanvasToastProvider>
  );
}

const rootEl = document.querySelector('#root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
  console.log(
    IS_E2E
      ? '[constella-renderer] CanvasModule booted (T3-01, #e2e minimal assembly)'
      : '[constella-renderer] product shell booted (T6-17, app:// protocol)',
  );
}
