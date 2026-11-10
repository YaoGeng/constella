// Constella renderer 入口（T0-08 最小壳 → T3-01 起挂载 CanvasModule）。
// 经 app:// 特权协议加载（S-1 ③）；完整应用壳（header/任务中心/节点库）随 P5/P6 装配。
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
 * 应用装配根（画布宿主半段）：
 * - snap/edgeAnim＝settingsStore 装配（T6-12 兑现 P3 区头 b 项：useState→订阅 settingsStore，
 *   C-01 经 Context 消费不变）；#e2e 模式保持无 storage 默认值路径（不 attachStorage 不 load，
 *   canvas-e2e setSnap 经 setState 直写镜像）。产品态启动 getAll 装载（attachSettingsStorage+
 *   load）随 T6-17 应用壳装配接线。
 * - registry 装配：产品态经 T1-10 装载序（storage 种子）注入——当前最小壳未接线，Provider 缺省
 *   null（NodeCard fallback 卡）；#e2e 模式装配最小定义集（三查/渲染需真 def）。
 * - E2E 钩子：仅 #e2e hash 时暴露 window.__CONSTELLA_E2E__（产品会话零暴露面；
 *   contextIsolation+sandbox 下 renderer window 无跨源可达性）。canvas-e2e.mjs 消费。
 */
function App() {
  const snap = useSettingsStore(selectSnap);
  const edgeAnim = useSettingsStore(selectEdgeAnim);
  const isE2E = location.hash === '#e2e';
  const registry = useMemo(() => {
    if (!isE2E) return null;
    const reg = createNodeRegistry();
    for (const def of e2eDefinitions()) reg.register(def);
    return reg;
  }, [isE2E]);

  useEffect(() => {
    if (!isE2E) return;
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

const rootEl = document.querySelector('#root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
  console.log('[constella-renderer] CanvasModule booted (T3-01, app:// protocol)');
}
