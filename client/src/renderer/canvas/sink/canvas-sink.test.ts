// CanvasSink / FlowSwitcher 用例（T3-08；C-01 §1 M4 会签 #1 导出面——签名级验证）。
import { describe, expect, it, beforeEach } from 'vitest';
import { useFlowStore } from '../stores/flow-store';
import type { CanvasNodeData } from '../node-types';
import { createCanvasSink, createFlowSwitcher } from './canvas-sink';

const DOC = {
  id: 'f1',
  name: 't',
  nodes: [{ id: 'a', type: 'llm.chat', name: 'A', position: { x: 0, y: 0 }, params: {} }],
  edges: [],
};

beforeEach(() => {
  useFlowStore.getState().loadFlow('f1', DOC);
});

describe('CanvasSink（落图 seam）', () => {
  const sink = createCanvasSink({ viewportCenter: () => ({ x: 300, y: 200 }) });

  it('dropNodes 批量落点＝单历史项整批一次可撤销＋markDirty', () => {
    expect(useFlowStore.getState().dirty).toBe(false);
    const ids = sink.dropNodes([
      { type: 'llm.chat', x: 100, y: 100 },
      { type: 'trigger.manual', x: 140, y: 140 },
      { type: 'llm.chat', x: 180, y: 180, params: { k: 1 } },
    ]);
    expect(ids).toHaveLength(3);
    expect(useFlowStore.getState().nodes).toHaveLength(4);
    expect(useFlowStore.getState().dirty).toBe(true);
    const before = useFlowStore.temporal.getState().pastStates.length;
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes).toHaveLength(1); // 整批回退
    expect(useFlowStore.temporal.getState().pastStates.length).toBe(before - 1); // 恰一条
  });

  it('dropNodes 透传 name/noScript（序列化语义字段——T5-07 评审裁定 B 转交：serialize 后 noScript 不丢，运行闸预警有效）', () => {
    const ids = sink.dropNodes([
      { type: 'xhs.search', name: '小红书搜索', noScript: true, x: 10, y: 20, params: { query: '咖啡' } },
      { type: 'llm.chat', x: 46, y: 60 }, // 未带 name/noScript——缺省不落（现状形不变）
    ]);
    const dropped = useFlowStore.getState().nodes.find((n) => n.id === ids[0]);
    expect((dropped?.data as CanvasNodeData).name).toBe('小红书搜索');
    expect((dropped?.data as CanvasNodeData).noScript).toBe(true);
    const plain = useFlowStore.getState().nodes.find((n) => n.id === ids[1]);
    expect((plain?.data as CanvasNodeData).name).toBeUndefined();
    expect((plain?.data as CanvasNodeData).noScript).toBeUndefined();
    // serialize（FlowDoc）后仍在——noScript 运行闸（02 §8.4）不击穿
    const doc = useFlowStore.getState().serialize();
    const ser = doc.nodes.find((n) => n.id === ids[0]);
    expect(ser?.name).toBe('小红书搜索');
    expect(ser?.noScript).toBe(true);
  });

  it('dropAtViewportCenter：视口中心落点（deps.viewportCenter 注入）', () => {
    const id = sink.dropAtViewportCenter({ type: 'trigger.manual' });
    const node = useFlowStore.getState().nodes.find((n) => n.id === id);
    expect(node?.position).toEqual({ x: 300, y: 200 });
    expect((node?.data as { type: string }).type).toBe('trigger.manual');
  });

  it('patchNode：params 合并（浅合并保旧键）＋policy 注入', () => {
    useFlowStore.getState().patchNode('a', { params: { model: 'x' } });
    useFlowStore.getState().patchNode('a', { params: { topP: 0.5 } });
    const data = useFlowStore.getState().nodes[0]?.data as { params: Record<string, unknown> };
    expect(data.params).toEqual({ model: 'x', topP: 0.5 });
    useFlowStore.getState().patchNode('a', { policy: { timeoutMs: 5000 } });
    const data2 = useFlowStore.getState().nodes[0]?.data as { policy?: Record<string, unknown> };
    expect(data2.policy).toEqual({ timeoutMs: 5000 });
  });

  it('markDirty/guardDirty 透传 flowStore 管线', () => {
    expect(sink.guardDirty('install')).toBe(true); // clean 放行
    sink.markDirty();
    expect(sink.guardDirty('install')).toBe(false); // dirty 拒绝（confirmHandler 未注入）
  });
});

describe('FlowSwitcher（流程切换 seam）', () => {
  it('createAndSwitch：新 flowId＋loadFlow 切换（落盘 mock 语义，P5 C-09 接线）', async () => {
    const switcher = createFlowSwitcher();
    const id = await switcher.createAndSwitch('新流程', { name: '新流程', nodes: [], edges: [] });
    expect(id).toBeTruthy();
    expect(useFlowStore.getState().activeFlowId).toBe(id);
    expect(useFlowStore.getState().name).toBe('新流程');
    expect(useFlowStore.getState().dirty).toBe(false);
  });

  it('switchFlow：脏闸拒绝=false；clean 成功切换=true', () => {
    const switcher = createFlowSwitcher();
    useFlowStore.getState().markDirty();
    expect(switcher.switchFlow('f2')).toBe(false);
    expect(useFlowStore.getState().activeFlowId).toBe('f1');
    useFlowStore.getState().markSaved('v');
    expect(switcher.switchFlow('f2', { doc: { name: '二', nodes: [], edges: [] } })).toBe(true);
    expect(useFlowStore.getState().activeFlowId).toBe('f2');
    expect(useFlowStore.getState().name).toBe('二');
  });
});
