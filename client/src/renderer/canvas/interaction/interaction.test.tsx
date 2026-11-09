// @vitest-environment jsdom
// InteractionMachine 用例（T3-04；C-01 §3 两组件行）——onConnect 三查接线/拖动历史合并
// （一次拖动恰一条历史项）/运行态与编辑闸。hook 经 probe 组件取值（ReactFlowProvider 内）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, beforeEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { NodeRegistry } from '../../node-registry';
import { useInteractionMachine } from './use-interaction-machine';
import { CanvasRegistryContext } from '../registry-context';
import { CanvasToastContext } from '../toast';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore, toXyNodes, toXyEdges } from '../stores/flow-store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function def(type: string, ins: string[], outs: { id: string; label: string }[] = [{ id: 'out', label: '输出' }]): NodeDefinition {
  return {
    type,
    kind: 'builtin',
    meta: { name: type === 'trigger.manual' ? '手动' : type, icon: '⚡', category: '触发' },
    ports: { ins, outs },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

const DEFS = [def('llm.chat', ['in']), def('trigger.manual', [])];

function fakeRegistry(defs: NodeDefinition[]): NodeRegistry {
  const map = new Map(defs.map((d) => [d.type, d]));
  return {
    get: (t: string) => map.get(t),
    has: (t: string) => map.has(t),
    isBroken: () => false,
    isBuiltin: () => true,
    register: () => {},
    list: () => defs,
    listByCategory: () => ({}),
    derivePerms: () => [],
    estimateMs: () => 420,
    loadAll: async () => ({}) as never,
    onChange: () => () => {},
  } as unknown as NodeRegistry;
}

let machine: ReturnType<typeof useInteractionMachine> | null = null;
let toasts: string[] = [];

function Probe() {
  machine = useInteractionMachine();
  return null;
}

async function mountHarness() {
  toasts = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <CanvasToastContext.Provider value={(t: string) => toasts.push(t)}>
          <CanvasRegistryContext.Provider value={fakeRegistry(DEFS)}>
            <Probe />
          </CanvasRegistryContext.Provider>
        </CanvasToastContext.Provider>
      </ReactFlowProvider>,
    );
  });
  return root;
}

const DOC = {
  id: 'e2e',
  name: 't',
  nodes: [
    { id: 'a', type: 'llm.chat', name: 'A', position: { x: 0, y: 0 }, params: {} },
    { id: 'b', type: 'llm.chat', name: 'B', position: { x: 200, y: 0 }, params: {} },
    { id: 't', type: 'trigger.manual', name: 'T', position: { x: 400, y: 0 }, params: {} },
  ],
  edges: [],
};

beforeEach(async () => {
  useCanvasStore.setState({ editMode: true });
  useFlowStore.getState().loadFlow('f1', { ...DOC, edges: [] });
  machine = null;
});

describe('onConnect 三查接线（A-3.4）', () => {
  it('合法 → 建边（单历史项）＋dirty', async () => {
    const root = await mountHarness();
    try {
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' } as never);
      });
      expect(useFlowStore.getState().edges).toHaveLength(1);
      expect(useFlowStore.getState().edges[0]).toMatchObject({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' });
      expect(useFlowStore.getState().dirty).toBe(true);
      expect(toasts).toHaveLength(0);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('自连/触发节点/重复边 → 不建边＋toast 文案逐字', async () => {
    const root = await mountHarness();
    try {
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 'a', sourceHandle: 'out', targetHandle: 'in' } as never);
      });
      expect(toasts.at(-1)).toBe('不能连接自己');
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 't', sourceHandle: 'out', targetHandle: 'in' } as never);
      });
      expect(toasts.at(-1)).toBe('「手动」是触发节点，没有输入口');
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' } as never);
      });
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' } as never);
      });
      expect(toasts.at(-1)).toBe('这条连线已存在');
      expect(useFlowStore.getState().edges).toHaveLength(1); // 仅首条合法边
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('handle 缺省回退 out/in 端口（loose 模式 targetHandle=null 路径）', async () => {
    const root = await mountHarness();
    try {
      await act(async () => {
        machine!.onConnect({ source: 'a', target: 'b' } as never);
      });
      expect(useFlowStore.getState().edges[0]).toMatchObject({ sourceHandle: 'out', targetHandle: 'in' });
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('拖动历史合并（demo L1491 首次移动压栈语义）', () => {
  it('一次拖动（多次中间帧）恰产生一条历史项，undo 回拖前', async () => {
    const root = await mountHarness();
    try {
      const before = useFlowStore.temporal.getState().pastStates.length;
      act(() => {
        machine!.onNodeDragStart(null as never, {} as never, [] as never);
      });
      useFlowStore.temporal.getState().pause(); // dragStart 内已 pause——此处幂等保护
      // 模拟拖动中间帧（position 变更多次）
      const nodes = useFlowStore.getState().nodes;
      for (const dx of [10, 25, 40]) {
        useFlowStore.getState().setNodes(nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: dx, y: 0 } } : n)));
      }
      const midStack = useFlowStore.temporal.getState().pastStates.length;
      await act(async () => {
        machine!.onNodeDragStop(null as never, {} as never, [] as never);
      });
      // 终态保留（最后一次中间帧位置）且恰一条新历史项
      expect(useFlowStore.getState().nodes.find((n) => n.id === 'a')?.position.x).toBe(40);
      expect(midStack).toBe(before);
      expect(useFlowStore.temporal.getState().pastStates.length).toBe(before + 1);
      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes.find((n) => n.id === 'a')?.position.x).toBe(0);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('运行态与编辑闸（A-5.1）', () => {
  it('running 或非 editMode → nodesDraggable=false', async () => {
    const root = await mountHarness();
    try {
      expect(machine!.nodesDraggable).toBe(true);
      act(() => {
        useFlowStore.getState().setRunning(true);
      });
      expect(machine!.nodesDraggable).toBe(false);
      act(() => {
        useFlowStore.getState().setRunning(false);
        useCanvasStore.setState({ editMode: false });
      });
      expect(machine!.nodesDraggable).toBe(false);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('受控形往返（loadFlow → xyflow nodes）', () => {
  it('toXyNodes/toXyEdges roundtrip（InteractionMachine 消费面）', () => {
    const nodes = toXyNodes(DOC);
    expect(nodes).toHaveLength(3);
    expect(toXyEdges(DOC)).toHaveLength(0);
    expect(nodes[0]).toMatchObject({ id: 'a', type: 'constella-node' });
  });
});
