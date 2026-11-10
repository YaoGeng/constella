// FlowInstaller 用例（T5-10 / TDD-C-09 §3 FlowInstaller 行＋§6.7 验收）。
//
// 覆盖：脏闸前置（dirty→拒绝提示，demo L3066）/FlowSteps 回放（steps→nodes＋显式 edges——
// BFS 线性链，demo genFlow L2177 同构）/WaterfallPlacer 坐标/flows.create＋落节点/createAndSwitch
// 切换＋「已安装到我的流程」toast（demo L3064-3069）。真件注入：createFlowSwitcher＋真 flowStore
// （store 节点/边数断言——验收点名）；storageInvoke=注入 fake（flows.create 面）。
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FlowStep } from '@constella/shared/manifest';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { useFlowStore } from '../canvas/stores/flow-store';
import { createFlowSwitcher } from '../canvas/sink/canvas-sink';
import { createWaterfallPlacer } from '../zip/waterfall-placer';
import { createFlowInstaller, FlowDirtyRefusedError } from './flow-installer';

const DOC = {
  id: 'f0',
  name: '初始流程',
  nodes: [{ id: 'a', type: 'llm.chat', name: 'A', position: { x: 0, y: 0 }, params: {} }],
  edges: [],
};

const STEPS: readonly FlowStep[] = [
  ['trigger.manual', '手动触发', {}],
  ['http.request', '抓取', { url: 'https://x' }],
  ['data.transform', '清洗', {}],
];

interface Harness {
  installFlow: ReturnType<typeof createFlowInstaller>['installFlow'];
  calls: { flowsCreate: Array<{ name: string }>; notify: Array<[string, string]> };
}

function makeHarness(): Harness {
  const calls: Harness['calls'] = { flowsCreate: [], notify: [] };
  const installer = createFlowInstaller({
    canvasSink: {
      // 脏闸走真 store（guardDirty——02 §3.3；dirty 且无 confirmHandler=拒绝）
      guardDirty: (action) => useFlowStore.getState().guardDirty(action),
    },
    flowSwitcher: createFlowSwitcher(), // 真切换 seam（T3-08——store 断言面）
    storageInvoke: async (req: StorageInvokeReq) => {
      if (req.op === 'flows.create') {
        calls.flowsCreate.push(req.args as { name: string });
        return { id: 'flow-lib-1' };
      }
      throw new Error(`unexpected op: ${String(req)}`);
    },
    viewportCenter: () => ({ x: 500, y: 400 }),
    notify: (level, msg) => calls.notify.push([level, msg]),
  });
  return { installFlow: installer.installFlow, calls };
}

beforeEach(() => {
  useFlowStore.getState().loadFlow('f0', DOC);
});

describe('FlowInstaller installFlow（§6.7：脏闸/回放/切换/toast）', () => {
  it('dirty → 拒绝提示（demo L3066）＋零 flows.create 零切换（FlowDirtyRefusedError）', async () => {
    const h = makeHarness();
    useFlowStore.getState().markDirty();
    await expect(h.installFlow(STEPS, '新流程')).rejects.toBeInstanceOf(FlowDirtyRefusedError);
    expect(h.calls.notify.some(([l, m]) => l === 'err' && m.includes('未保存改动'))).toBe(true);
    expect(h.calls.flowsCreate).toHaveLength(0);
    expect(useFlowStore.getState().activeFlowId).toBe('f0'); // 未切换
    expect(useFlowStore.getState().nodes).toHaveLength(1); // 画布未动
  });

  it('steps 回放→flows.create＋节点/边数正确（3 步=3 节点 2 边线性链）＋瀑布坐标＋createAndSwitch 切换＋toast', async () => {
    const h = makeHarness();
    const res = await h.installFlow(STEPS, '小红书自动化');
    // flows.create 恰一次（C-06 落库——真通道面）
    expect(h.calls.flowsCreate).toEqual([{ name: '小红书自动化' }]);
    // store 断言（真 createAndSwitch＋真 flowStore）：节点=steps 数、边=steps-1（显式 edges）
    const store = useFlowStore.getState();
    expect(store.activeFlowId).not.toBe('f0');
    expect(store.name).toBe('小红书自动化');
    expect(store.nodes).toHaveLength(3);
    expect(store.edges).toHaveLength(2);
    // 节点形：type/name/params 透传（steps 三元组→FlowNode）
    const names = store.nodes.map((n) => (n.data as { name?: string }).name);
    expect(names).toEqual(['手动触发', '抓取', '清洗']);
    const types = store.nodes.map((n) => (n.data as { type: string }).type);
    expect(types).toEqual(['trigger.manual', 'http.request', 'data.transform']);
    // 瀑布坐标（WaterfallPlacer——+36/+40 相邻差）
    const placer = createWaterfallPlacer({ viewportCenter: () => ({ x: 500, y: 400 }) });
    const expectPos = placer.positions(3);
    for (let i = 0; i < 3; i++) {
      expect(store.nodes[i]?.position).toEqual(expectPos[i]);
    }
    // 边端点（BFS 线性链：i→i+1，端口 out/in——demo genFlow L2185 同构）
    const nodeIds = store.nodes.map((n) => n.id);
    const serialized = store.serialize();
    expect(serialized.edges).toHaveLength(2);
    expect(serialized.edges[0]?.from[0]).toBe(nodeIds[0]);
    expect(serialized.edges[0]?.to[0]).toBe(nodeIds[1]);
    expect(serialized.edges[0]?.from[1]).toBe('out');
    expect(serialized.edges[0]?.to[1]).toBe('in');
    expect(serialized.edges[1]?.to[0]).toBe(nodeIds[2]);
    // 切换后 clean（loadFlow 重置基线）
    expect(useFlowStore.getState().dirty).toBe(false);
    // toast（demo L3064-3069）
    expect(h.calls.notify.some(([l, m]) => l === 'ok' && m.includes('已安装到我的流程'))).toBe(true);
    expect(res).toMatchObject({ flowId: 'flow-lib-1', nodeCount: 3, edgeCount: 2 });
  });

  it('单步流程→零边（n-1）；空步→零节点零边零 create 后拒', async () => {
    const h = makeHarness();
    const res = await h.installFlow([['trigger.manual', '单点', {}]], '单步');
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    expect(useFlowStore.getState().edges).toHaveLength(0);
    expect(res).toMatchObject({ nodeCount: 1, edgeCount: 0 });
    // 空 steps=空流程（zip:export 空流程拒绝同源语义）→ 拒绝不落库
    const h2 = makeHarness();
    await expect(h2.installFlow([], '空')).rejects.toBeInstanceOf(Error);
    expect(h2.calls.flowsCreate).toHaveLength(0);
  });
});

// vi 引用（后续注入面扩展用——保持 import 完整性）
void vi;
