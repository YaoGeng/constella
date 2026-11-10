// 装配模块用例（T5-11 / batch-3 硬接线清单——landEdges 真绑定〔T5-04：现「一键生成」画布无边〕
// ＋createAndSwitch 真接线〔T5-10 ⚠⑥：库 id 消费〕）。
//
// 断言面：
//   - landEdges：真 FlowMaterializer＋真 flowStore/canvasSink＋绑定注入——materialize 后画布
//     **有边**（toXyEdges 端口元组映射＋合并写；既有边保留）；
//   - createAndSwitch：FlowInstaller flows.create 的**库 id**被消费（switch 返回 id=create id——
//     非自生成；flowStore.activeFlowId=库 id；dirty=true 进入标准保存链）；
//   - noScript 回标（T5-10 🟡1→硬接线 3）：Installer flow 链 summary.noScript→新流程实例标记。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowDoc, StorageInvokeReq, StorageInvokeRes, StorageOp } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createCanvasSink } from '../canvas/sink/canvas-sink';
import { useFlowStore } from '../canvas/stores/flow-store';
import type { StorageInvokeArgs } from '../storage';
import type { PlanCard } from '../workshop/flow-planner';
import { createFlowMaterializer } from '../workshop/flow-materializer';
import { createFlowInstaller } from '../market/flow-installer';
import { wireRealFlowSwitcher } from './flow-switcher';
import { createLandEdgesBinder } from './land-edges';

function defOf(type: string): NodeDefinition {
  return {
    kind: 'custom',
    type,
    meta: { name: type, icon: '✨', category: '自定义' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

function resetFlowStore(): void {
  useFlowStore.getState().loadFlow(null, { name: '未命名流程', nodes: [], edges: [] });
}

beforeEach(() => {
  resetFlowStore();
});

describe('硬接线 1——landEdges 真绑定（T5-04：「一键生成」画布有边）', () => {
  const plan: PlanCard = {
    id: 'plan-1',
    flowName: '生成流程',
    steps: [
      { type: 'a.start', name: '开始', params: {}, src: 'new' },
      { type: 'b.mid', name: '中间', params: {}, src: 'lib' },
      { type: 'c.end', name: '结束', params: {}, src: 'lib' },
    ],
    // 显式分支路由：0→1、0→2（缺省线性不同形——分支边映射断言）
    edges: [
      [0, 'out', 1, 'in'],
      [0, 'exit', 2, 'in'],
    ],
  };

  it('materialize 后 flowStore 有边（toXyEdges 端口元组映射；source/target=dropNodes 实例 id）', async () => {
    const definitions = new Map([['a.start', defOf('a.start')], ['b.mid', defOf('b.mid')], ['c.end', defOf('c.end')]]);
    const storageCalls: StorageInvokeReq[] = [];
    const materializer = createFlowMaterializer({
      canvas: createCanvasSink({ viewportCenter: () => ({ x: 0, y: 0 }) }),
      storage: {
        invoke: async <T extends StorageOp>(op: T, args: StorageInvokeArgs<T>): Promise<StorageInvokeRes<T>> => {
          storageCalls.push({ op, args: args as Record<string, unknown> } as StorageInvokeReq);
          if (op === 'flows.create') return { id: 'flow-lib-1' } as StorageInvokeRes<T>;
          if (op === 'flows.save') return { versionId: 'v1' } as StorageInvokeRes<T>;
          return undefined as StorageInvokeRes<T>;
        },
      },
      landEdges: createLandEdgesBinder(), // ← 真绑定（T5-04 注入位）
      getDefinition: (t) => definitions.get(t),
    });

    const res = await materializer.materialize(plan);
    expect(res.ok).toBe(true);

    const { nodes, edges } = useFlowStore.getState();
    expect(nodes).toHaveLength(3); // dropNodes 整批（既有行为）
    expect(edges).toHaveLength(2); // ← 硬接线断言：画布有边（此前 landEdges 缺省=无边）
    const ids = nodes.map((n) => n.id);
    expect(edges[0]).toMatchObject({ source: ids[0], sourceHandle: 'out', target: ids[1], targetHandle: 'in' });
    expect(edges[1]).toMatchObject({ source: ids[0], sourceHandle: 'exit', target: ids[2], targetHandle: 'in' });
    // 落盘口径同源：flows.save 的 edges=落图同一份（T5-04 §1 ⑦ 原语义——landEdges 不改变落盘）
    const save = storageCalls.find((c) => c.op === 'flows.save');
    expect((save?.args as { edges: unknown[] }).edges).toHaveLength(2);
  });

  it('合并写：既有边保留（重复 materialize 到同一画布不覆盖旧边）', async () => {
    // 预置一条既有边（模拟用户已有连线）
    useFlowStore.getState().loadFlow('flow-x', {
      name: '已有',
      nodes: [
        { id: 'k1', type: 'a.start', name: '旧一', position: { x: 0, y: 0 }, params: {} },
        { id: 'k2', type: 'b.mid', name: '旧二', position: { x: 1, y: 0 }, params: {} },
      ],
      edges: [{ id: 'ke1', from: ['k1', 'out'], to: ['k2', 'in'] }],
    });
    const definitions = new Map([['a.start', defOf('a.start')], ['b.mid', defOf('b.mid')]]);
    const materializer = createFlowMaterializer({
      canvas: createCanvasSink({ viewportCenter: () => ({ x: 0, y: 0 }) }),
      storage: {
        invoke: async <T extends StorageOp>(op: T): Promise<StorageInvokeRes<T>> =>
          (op === 'flows.create' ? { id: 'flow-lib-2' } : { versionId: 'v' }) as StorageInvokeRes<T>,
      },
      landEdges: createLandEdgesBinder(),
      getDefinition: (t) => definitions.get(t),
    });
    const smallPlan: PlanCard = {
      id: 'plan-2',
      flowName: '追加',
      steps: [
        { type: 'a.start', name: '新一', params: {}, src: 'lib' },
        { type: 'b.mid', name: '新二', params: {}, src: 'lib' },
      ],
    };
    const res = await materializer.materialize(smallPlan);
    expect(res.ok).toBe(true);
    const edges = useFlowStore.getState().edges;
    expect(edges).toHaveLength(2); // 既有 1＋新落 1（合并写）
    expect(edges.some((e) => e.id === 'ke1')).toBe(true); // 旧边保留
  });
});

describe('硬接线 2——createAndSwitch 真接线（T5-10 ⚠⑥：库 id 消费）', () => {
  it('FlowInstaller 链：flows.create 库 id=switch 返回 id=flowStore.activeFlowId；dirty=标准保存链', async () => {
    const createdIds: string[] = [];
    const storage = {
      invoke: async (req: StorageInvokeReq): Promise<unknown> => {
        if (req.op === 'flows.create') {
          const id = `flow-lib-${createdIds.length + 1}`;
          createdIds.push(id);
          return { id };
        }
        return undefined;
      },
    };
    const wiring = wireRealFlowSwitcher(storage);
    const flowInstaller = createFlowInstaller({
      canvasSink: createCanvasSink({ viewportCenter: () => ({ x: 0, y: 0 }) }),
      flowSwitcher: wiring.switcher,
      storageInvoke: wiring.installStorage.invoke, // ← 捕获桥（flows.create 经此过）
      viewportCenter: () => ({ x: 0, y: 0 }),
    });

    const res = await flowInstaller.installFlow(
      [
        ['a.start', '开始', {}],
        ['b.mid', '中间', {}],
      ],
      '安装的流程',
    );
    expect(createdIds).toHaveLength(1); // 恰一次 flows.create（switch 不重复建库行）
    expect(res.flowId).toBe('flow-lib-1'); // InstallResult.flowId=库 id（C-06 真通道）
    const store = useFlowStore.getState();
    expect(store.activeFlowId).toBe('flow-lib-1'); // ← 切换到真流程（非 T3-08 mock 自生成 id）
    expect(store.nodes).toHaveLength(2);
    expect(store.edges).toHaveLength(1); // 线性链回放
    expect(store.dirty).toBe(true); // 安装内容未打版本——标准保存链持久化（⚠ 卡内冻结）
  });

  it('doc 语义字段透传（name/params/noScript——installFlow opts 回标）', async () => {
    const wiring = wireRealFlowSwitcher({
      invoke: async (req: StorageInvokeReq) => (req.op === 'flows.create' ? { id: 'fl-9' } : undefined),
    });
    const flowInstaller = createFlowInstaller({
      canvasSink: createCanvasSink({ viewportCenter: () => ({ x: 0, y: 0 }) }),
      flowSwitcher: wiring.switcher,
      storageInvoke: wiring.installStorage.invoke,
      viewportCenter: () => ({ x: 0, y: 0 }),
    });
    await flowInstaller.installFlow(
      [
        ['a.strong', '强节点', { k: 1 }],
        ['b.weak', '弱节点', {}],
      ],
      '回标流程',
      { noScriptNames: ['弱节点'] }, // ← T5-10 🟡1：Installer 持 summary.noScript 回标实例
    );
    const { nodes } = useFlowStore.getState();
    expect(nodes.map((n) => (n.data as { noScript?: boolean }).noScript)).toEqual([undefined, true]); // 弱节点回标
    expect((nodes[0]!.data as { params: unknown }).params).toEqual({ k: 1 });
  });

  it('防御路径：无捕获（直接调 switcher）→补建库行后切换', async () => {
    const storage = {
      invoke: vi.fn(async (req: StorageInvokeReq): Promise<unknown> =>
        req.op === 'flows.create' ? { id: 'fl-defensive' } : undefined,
      ),
    };
    const wiring = wireRealFlowSwitcher(storage);
    const id = await wiring.switcher.createAndSwitch('孤立调用', {
      name: '孤立调用',
      nodes: [{ id: 'z', type: 'a.start', name: 'A', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
    } satisfies FlowDoc);
    expect(id).toBe('fl-defensive');
    expect(useFlowStore.getState().activeFlowId).toBe('fl-defensive');
  });
});
