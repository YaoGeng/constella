// flowStore 用例（T3-05；C-01 §6.1b/c 验收清单逐项——S-1 ④ 三件套是本卡重点回归面）。
import { describe, expect, it, beforeEach } from 'vitest';
import type { Node } from '@xyflow/react';
import type { FlowDoc } from '@constella/shared/ipc';
import {
  DEFAULT_IN_PORT,
  DEFAULT_OUT_PORT,
  HISTORY_LIMIT,
  toXyEdges,
  toXyNodes,
  useFlowStore,
} from './flow-store';

function resetStore(): void {
  useFlowStore.setState({
    activeFlowId: null,
    name: '未命名流程',
    nodes: [],
    edges: [],
    dirty: false,
    running: false,
    baseline: JSON.stringify({ nodes: [], edges: [] }),
    confirmHandler: null,
  });
  useFlowStore.temporal.getState().clear();
}

function docFactory(overrides?: Partial<FlowDoc>): FlowDoc {
  return {
    id: 'f1',
    name: '流程一',
    nodes: [
      { id: 'n1', type: 'llm.chat', name: '对话', position: { x: 0, y: 0 }, params: { model: 'gpt' } },
      { id: 'n2', type: 'trigger.manual', name: '手动', position: { x: 200, y: 40 }, params: {} },
      { id: 'n3', type: 'legacy.strong', name: '无脚本', position: { x: 400, y: 80 }, params: {}, noScript: true },
    ],
    edges: [
      { id: 'e1', from: ['n2', 'out'] as const, to: ['n1', 'in'] as const },
      { id: 'e2', from: ['n1', 'ok'] as const, to: ['n3', 'in'] as const },
    ],
    ...overrides,
  };
}

/** 离散变更（每次追加一个节点——真实内容变化，产生一条历史项）。 */
function appendNode(i: number): void {
  const { nodes } = useFlowStore.getState();
  useFlowStore.getState().setNodes([
    ...nodes,
    {
      id: `x${i}`,
      type: 'constella-node',
      position: { x: i * 10, y: 0 },
      data: { nodeId: `x${i}`, type: 'llm.chat', name: `节点${i}`, params: {} },
    },
  ]);
}

const pastStates = () => useFlowStore.temporal.getState().pastStates;
const futureStates = () => useFlowStore.temporal.getState().futureStates;

beforeEach(resetStore);

describe('历史栈 limit=60（A-5.3）', () => {
  it('61 次离散变更后栈深恰 60', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    expect(pastStates().length).toBe(0);
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) appendNode(i);
    expect(pastStates().length).toBe(HISTORY_LIMIT);
    expect(useFlowStore.getState().nodes.length).toBe(3 + HISTORY_LIMIT + 1);
  });
});

describe('undo/redo 语义（02 §3.3）', () => {
  it('undo 回退一步、redo 重做；undo 后新变更 redo 清空', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    appendNode(1);
    appendNode(2);
    expect(useFlowStore.getState().nodes.length).toBe(5);
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes.length).toBe(4);
    useFlowStore.getState().redo();
    expect(useFlowStore.getState().nodes.length).toBe(5);
    // undo 后再新变更 → future 清空（demo L1659-1689 redo 清空语义）
    useFlowStore.getState().undo();
    appendNode(9);
    expect(futureStates().length).toBe(0);
    useFlowStore.getState().redo(); // 无操作
    expect(useFlowStore.getState().nodes.filter((n) => n.id === 'x9')).toHaveLength(1);
    expect(useFlowStore.getState().nodes.filter((n) => n.id === 'x2')).toHaveLength(0);
  });

  it('历史按 flowId 归属：切流程后 undo 无操作', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    appendNode(1);
    expect(pastStates().length).toBeGreaterThan(0);
    useFlowStore.getState().loadFlow('f2', docFactory({ id: 'f2', name: '流程二' }));
    expect(pastStates().length).toBe(0);
    useFlowStore.getState().undo(); // 无操作
    expect(useFlowStore.getState().name).toBe('流程二');
    expect(useFlowStore.getState().nodes.length).toBe(3);
  });

  it('运行中禁 undo/redo（runStore 注入位默认态，区头 a 项）', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    appendNode(1);
    useFlowStore.getState().setRunning(true);
    const before = pastStates().length;
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes.length).toBe(4); // 未回退
    expect(pastStates().length).toBe(before);
    useFlowStore.getState().setRunning(false);
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes.length).toBe(3); // 解禁后可回退
  });
});

describe('保存周期（A-5.2）', () => {
  it('markSaved（=SaveOrchestrator onSaved）清栈+基线重置 dirty', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    appendNode(1);
    appendNode(2);
    expect(useFlowStore.getState().dirty).toBe(true);
    useFlowStore.getState().markSaved('v9');
    expect(pastStates().length).toBe(0);
    expect(futureStates().length).toBe(0);
    expect(useFlowStore.getState().dirty).toBe(false);
    useFlowStore.getState().undo(); // 清栈后 undo 无操作
    expect(useFlowStore.getState().nodes.length).toBe(5);
  });

  it('restore 快照 roundtrip 呈 dirty（C-06 versions.restore 消费面）', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    expect(useFlowStore.getState().dirty).toBe(false);
    const other = docFactory({ name: '快照版', nodes: [{ id: 'n9', type: 'a.b', name: '九', position: { x: 1, y: 2 }, params: { k: 1 } }], edges: [] });
    useFlowStore.getState().applySnapshot(other);
    expect(useFlowStore.getState().dirty).toBe(true);
    expect(useFlowStore.getState().serialize()).toEqual(other);
  });
});

describe('S-1 ④ partialize/equality 回归（重点）', () => {
  it('任一历史快照深比较不含 measured/selected/dragging 键', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    appendNode(1);
    appendNode(2);
    for (const snap of pastStates()) {
      for (const n of snap.nodes ?? []) {
        expect(n).not.toHaveProperty('measured');
        expect(n).not.toHaveProperty('selected');
        expect(n).not.toHaveProperty('dragging');
        expect(n).not.toHaveProperty('resizing');
      }
    }
  });

  it('纯拖动尺寸测量不产生仅测量差异的历史项', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    const before = pastStates().length;
    const nodes = useFlowStore.getState().nodes;
    // 仅运行时字段变化（position/data 不动）——equality 判等，不压栈
    const measured: Node[] = nodes.map((n) => ({ ...n, measured: { width: 192, height: 80 } }));
    useFlowStore.getState().setNodes([...measured]);
    expect(pastStates().length).toBe(before);
    // 再叠加 selected 亦然
    useFlowStore.getState().setNodes(measured.map((n) => ({ ...n, selected: true })));
    expect(pastStates().length).toBe(before);
    // 真实位移（position 变化）才产生历史项
    useFlowStore.getState().setNodes(measured.map((n, i) => ({ ...n, position: { x: i + 1, y: 0 } })));
    expect(pastStates().length).toBe(before + 1);
  });
});

describe('脏标记管线（A-5.1）', () => {
  it('markDirty/guardDirty：clean 放行、dirty 默认拒绝、confirmHandler 注入可放行', () => {
    useFlowStore.getState().loadFlow('f1', docFactory());
    expect(useFlowStore.getState().guardDirty('switch')).toBe(true);
    useFlowStore.getState().markDirty();
    expect(useFlowStore.getState().dirty).toBe(true);
    expect(useFlowStore.getState().guardDirty('switch')).toBe(false);
    useFlowStore.getState().setConfirmHandler(() => true); // 应用壳对话框注入位
    expect(useFlowStore.getState().guardDirty('switch')).toBe(true);
  });

  it('serialize roundtrip：FlowDoc ↔ 受控形语义字段完整（params/noScript/端口元组）', () => {
    const doc = docFactory();
    useFlowStore.getState().loadFlow('f1', doc);
    expect(useFlowStore.getState().serialize()).toEqual(doc);
    // 默认端口回退：无 handle 边序列化为 out/in（B-13 回退契约）
    useFlowStore.getState().setEdges([
      { id: 'e9', type: 'constella-edge', source: 'n1', target: 'n2' },
    ]);
    expect(useFlowStore.getState().serialize().edges).toEqual([
      {
        id: 'e9',
        from: ['n1', DEFAULT_OUT_PORT],
        to: ['n2', DEFAULT_IN_PORT],
      },
    ]);
  });

  it('toXyNodes/toXyEdges 映射：注册面单键 + data 语义字段', () => {
    const doc = docFactory();
    const nodes = toXyNodes(doc);
    expect(nodes.every((n) => n.type === 'constella-node')).toBe(true);
    expect(nodes[2]?.data).toMatchObject({ nodeId: 'n3', type: 'legacy.strong', noScript: true });
    const edges = toXyEdges(doc);
    expect(edges[1]).toMatchObject({ source: 'n1', sourceHandle: 'ok', target: 'n3', targetHandle: 'in' });
  });
});
