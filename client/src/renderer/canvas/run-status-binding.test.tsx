// @vitest-environment jsdom
// RunStatusBinding —— runStore 只读订阅接线套件（T4-04；TDD-C-01 §2「C-03 runStore 只读
// statuses selector」＋02 §3.3；05 T3 波次区头 a 项「T4-04 接线」收口）。
// 断言面：
//   runStore.lastRunOfFlow.statuses → CanvasStatusContext → NodeCard 五态驱动（data-status/
//   徽标）；未入 statuses 节点=idle（无状态 class＋无徽标）；runStore.activeRunOfFlow →
//   flowStore.running 联动（开 run=true/收 run=false——运行中禁拖/禁 undo 的数据源）；
//   切流程（activeFlowId）取对应 flow 的镜像。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { NodeCard } from './nodes/NodeCard';
import { CanvasRegistryContext } from './registry-context';
import { RunStatusBinding } from './run-status-binding';
import { useFlowStore } from './stores/flow-store';
import { useRunStore } from '../run/run-store';
import { createNodeRegistry } from '../node-registry';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function def(type: string): NodeDefinition {
  return {
    type,
    kind: 'builtin',
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

const registry = createNodeRegistry();
registry.register(def('data.transform'));

async function mountBinding(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <CanvasRegistryContext.Provider value={registry}>
          <RunStatusBinding>
            <NodeCard id="a" data={{ nodeId: 'a', type: 'data.transform' }} />
          </RunStatusBinding>
        </CanvasRegistryContext.Provider>
      </ReactFlowProvider>,
    );
  });
  return { container, root };
}

let activeRoot: Root | null = null;

beforeEach(() => {
  useRunStore.getState().reset();
  useFlowStore.getState().loadFlow('f1', { id: 'f1', name: 'f1', nodes: [], edges: [] });
  useFlowStore.getState().setRunning(false);
});

afterEach(async () => {
  const root = activeRoot;
  activeRoot = null;
  if (root !== null) {
    await act(async () => {
      root.unmount();
    });
  }
});

describe('RunStatusBinding runStore 只读订阅接线', () => {
  it('五态驱动：runStore.nodeStatus 写入 → NodeCard data-status 与徽标刷新', async () => {
    const { container, root } = await mountBinding();
    activeRoot = root;
    const el = container.querySelector('.cn-node') as HTMLElement;
    expect(el.dataset.status).toBe('idle'); // 未入 statuses=idle（demo L1761/L1075）
    await act(async () => {
      const s = useRunStore.getState();
      s.runOpened('f1', 'r1');
      s.nodeStatus({ runId: 'r1', nodeId: 'a', status: 'running' }, 'f1');
    });
    expect(el.dataset.status).toBe('running');
    expect(el.querySelector('.cn-node__badge')?.textContent).toBe('⋯');
    await act(async () => {
      useRunStore.getState().nodeStatus({ runId: 'r1', nodeId: 'a', status: 'done' }, 'f1');
    });
    expect(el.dataset.status).toBe('done');
    expect(el.querySelector('.cn-node__badge')?.textContent).toBe('✓');
  });

  it('idle：statuses 缺席节点无状态 class＋无徽标', async () => {
    const { container, root } = await mountBinding();
    activeRoot = root;
    const el = container.querySelector('.cn-node') as HTMLElement;
    expect(el.dataset.status).toBe('idle');
    expect(el.className).not.toMatch(/cn-node--(running|waiting|done|error|skipped)/);
    expect(el.querySelector('.cn-node__badge')).toBeNull();
  });

  it('running 联动：runOpened → flowStore.running=true；runClosed → false（运行中禁拖/禁 undo 数据源）', async () => {
    const { root } = await mountBinding();
    activeRoot = root;
    await act(async () => {
      useRunStore.getState().runOpened('f1', 'r1');
    });
    expect(useFlowStore.getState().running).toBe(true);
    await act(async () => {
      useRunStore.getState().runClosed('f1', 'r1');
    });
    expect(useFlowStore.getState().running).toBe(false);
  });

  it('切流程取对应镜像：activeFlowId 变更后按新 flow 的 statuses 驱动', async () => {
    const { container, root } = await mountBinding();
    activeRoot = root;
    await act(async () => {
      const s = useRunStore.getState();
      s.runOpened('f2', 'r2');
      s.nodeStatus({ runId: 'r2', nodeId: 'a', status: 'error' }, 'f2');
    });
    await act(async () => {
      useFlowStore.getState().loadFlow('f2', { id: 'f2', name: 'f2', nodes: [], edges: [] });
    });
    const el = container.querySelector('.cn-node') as HTMLElement;
    expect(el.dataset.status).toBe('error'); // f2 的镜像生效
    expect(el.querySelector('.cn-node__badge')?.textContent).toBe('✗');
  });
});
