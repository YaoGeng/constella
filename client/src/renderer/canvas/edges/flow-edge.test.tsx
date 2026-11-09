// @vitest-environment jsdom
// FlowEdge 用例（T3-03；C-01 §3 FlowEdge 行＋01 A-3.3 判据）——双层结构/edgeAnim 开关/
// 入边流光 statuses 消费/编辑态点击删除 toast（文案逐字=demo L1417/L1421）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { FlowEdge, EDGE_DELETE_HINT, EDGE_DELETED } from './FlowEdge';
import { CanvasEdgeAnimContext, CanvasStatusContext, type NodeRunStatus } from '../registry-context';
import { CanvasToastProvider } from '../toast';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function edgePropsFactory(): EdgeProps {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 100,
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never,
  } as unknown as EdgeProps;
}

interface MountOpts {
  status?: NodeRunStatus;
  edgeAnim?: boolean;
}

async function mountEdge({ status = 'waiting', edgeAnim = true }: MountOpts = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <CanvasToastProvider>
          <CanvasEdgeAnimContext.Provider value={edgeAnim}>
            <CanvasStatusContext.Provider value={(nodeId: string) => (nodeId === 'n2' ? status : 'waiting')}>
              <svg>
                <FlowEdge {...edgePropsFactory()} />
              </svg>
            </CanvasStatusContext.Provider>
          </CanvasEdgeAnimContext.Provider>
        </CanvasToastProvider>
      </ReactFlowProvider>,
    );
  });
  return { container, root };
}

beforeEach(() => {
  useCanvasStore.setState({ editMode: true });
  useFlowStore.setState({ running: false, nodes: [], edges: [] });
  useFlowStore.temporal.getState().clear();
});

describe('FlowEdge 双层结构（demo L1405-1431）', () => {
  it('渲染 hit 层＋可见层两条 path', async () => {
    const { container, root } = await mountEdge();
    try {
      expect(container.querySelectorAll('.cn-edge--hit')).toHaveLength(1);
      expect(container.querySelectorAll('.cn-edge--vis')).toHaveLength(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('流光 edgeAnim 门控（demo L1769-1776）', () => {
  it('target running 且 edgeAnim 开 → flowing 动画类', async () => {
    const { container, root } = await mountEdge({ status: 'running' });
    try {
      expect(container.querySelector('.cn-edge--vis')?.getAttribute('class')).toContain('cn-edge--flowing');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('edgeAnim 关（P6 C-11 注入位默认值外路径）→ 不 flowing', async () => {
    const { container, root } = await mountEdge({ status: 'running', edgeAnim: false });
    try {
      expect(container.querySelector('.cn-edge--vis')?.getAttribute('class')).not.toContain('cn-edge--flowing');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('target 非 running → 无 flowing；skipped → 跳过态虚线', async () => {
    const done = await mountEdge({ status: 'done' });
    expect(done.container.querySelector('.cn-edge--vis')?.getAttribute('class')).not.toContain('cn-edge--flowing');
    await act(async () => {
      done.root.unmount();
    });
    const skip = await mountEdge({ status: 'skipped' });
    expect(skip.container.querySelector('.cn-edge--vis')?.getAttribute('class')).toContain('cn-edge--skipped');
    await act(async () => {
      skip.root.unmount();
    });
  });
});

describe('编辑态点击删除＋toast（A-3.3；demo L1417/L1421 文案逐字）', () => {
  it('编辑态点击 hit 层 → 边删除＋toast「连线已删除」＋产生历史项', async () => {
    useFlowStore.setState({
      edges: [{ id: 'e1', type: 'constella-edge', source: 'n1', target: 'n2' }],
    });
    const { container, root } = await mountEdge();
    try {
      const before = useFlowStore.temporal.getState().pastStates.length;
      await act(async () => {
        container.querySelector('.cn-edge--hit')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      });
      expect(useFlowStore.getState().edges).toHaveLength(0);
      // 删除动作本身恰产生一条新历史项（测试内 setState 的既有栈深不计入）
      expect(useFlowStore.temporal.getState().pastStates.length).toBe(before + 1);
      expect(container.textContent).toContain(EDGE_DELETED);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('运行中点击 → 不删除＋toast「编辑模式下点击连线可删除」', async () => {
    useFlowStore.setState({
      running: true,
      edges: [{ id: 'e1', type: 'constella-edge', source: 'n1', target: 'n2' }],
    });
    const { container, root } = await mountEdge();
    try {
      await act(async () => {
        container.querySelector('.cn-edge--hit')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      });
      expect(useFlowStore.getState().edges).toHaveLength(1);
      expect(container.textContent).toContain(EDGE_DELETE_HINT);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('非编辑模式点击 → 同样拒绝删除＋提示', async () => {
    useCanvasStore.setState({ editMode: false });
    useFlowStore.setState({
      edges: [{ id: 'e1', type: 'constella-edge', source: 'n1', target: 'n2' }],
    });
    const { container, root } = await mountEdge();
    try {
      await act(async () => {
        container.querySelector('.cn-edge--hit')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      });
      expect(useFlowStore.getState().edges).toHaveLength(1);
      expect(container.textContent).toContain(EDGE_DELETE_HINT);
    } finally {
      await act(async () => {
        root.unmount();
      });
      useCanvasStore.setState({ editMode: true });
    }
  });
});
