// FlowMaterializer 一键生成套件（T5-04；TDD-C-07 §6.5；01 A-10.3；02 §9.1「确认后入库上画布」）。
// 断言面（demo L2284-2310 genFlowFromPlan 语义正式化）：
//   confirmPlan→materialize：edges 显式分支路由（PlanCard 四元组 [i,'exit',j,'in']→端口元组
//   边形；缺省线性串联）→dropNodes 落图（dagre 布局经注入——归 C-01）＋markDirty→✨步骤
//   （src='new'）顺路 library.upsert→flows.save label='流程工坊生成'；guardDirty 拒绝路径
//   （dirty 时提示不覆盖——01 A-10.3）。
// 注入件全 stub（P-3）：CanvasSink=T3-08 导出面（dropNodes/markDirty/guardDirty）；C-06
// storageClient（flows.create/flows.save/library.upsert）；落边注入位（T3-08 面无整图落边
// op——本卡增设 landEdges，会签留痕见模块头）；layout=C-01 LayoutEngine 同构。
import { describe, expect, it } from 'vitest';
import type { FlowEdge, StorageInvokeRes, StorageOp } from '@constella/shared/ipc';
import type { StorageInvokeArgs } from '../storage';
import type { CanvasSink } from '../canvas/sink/canvas-sink';
import {
  createFlowMaterializer,
  type DefinitionLookup,
  type FlowMaterializer,
  type PlanLayoutFn,
} from './flow-materializer';
import type { PlanCard, PlanStep } from './flow-planner';

// ————————————————————————————————————————————
// stub（注入面 recorder）
// ————————————————————————————————————————————

interface CanvasLog {
  dropped: { type: string; name?: string; params: Record<string, unknown>; x: number; y: number }[][];
  patched: { nodeId: string; patch: unknown }[];
  events: string[];
  dirtyAllowed: boolean;
}

function stubCanvas(log: CanvasLog): Pick<CanvasSink, 'dropNodes' | 'markDirty' | 'guardDirty' | 'patchNode'> {
  return {
    dropNodes: (specs) => {
      log.events.push('dropNodes');
      log.dropped.push(
        specs.map((s) => ({
          type: s.type,
          ...(s.name !== undefined ? { name: s.name } : {}),
          params: s.params ?? {},
          x: s.x,
          y: s.y,
        })),
      );
      return specs.map((_, i) => `node-${log.dropped.length - 1}-${i}`); // 批内序号稳定可断言
    },
    markDirty: () => log.events.push('markDirty'),
    guardDirty: (action) => {
      log.events.push(`guardDirty:${action}`);
      return log.dirtyAllowed;
    },
    patchNode: (nodeId, patch) => {
      log.events.push('patchNode');
      log.patched.push({ nodeId, patch });
    },
  };
}

interface StorageLog {
  events: string[];
  calls: { op: string; args?: unknown }[];
}

function stubStorage(log: StorageLog): { invoke: <T extends StorageOp>(op: T, args: StorageInvokeArgs<T>) => Promise<StorageInvokeRes<T>> } {
  return {
    invoke: async <T extends StorageOp>(op: T, args: StorageInvokeArgs<T>) => {
      log.events.push(`storage:${op}`);
      log.calls.push({ op, args: args as unknown });
      if (op === 'flows.create') return { id: `flow-gen-0` } as StorageInvokeRes<T>;
      if (op === 'flows.save') return { versionId: `ver-0` } as StorageInvokeRes<T>;
      return undefined as StorageInvokeRes<T>;
    },
  };
}

const step = (type: string, over: Partial<PlanStep> = {}): PlanStep => ({
  src: 'lib',
  type,
  name: type,
  params: {},
  ...over,
});

const plan = (steps: PlanStep[], edges?: [number, string, number, string][]): PlanCard => ({
  id: 'plan-mat',
  flowName: '爆款采集',
  steps,
  ...(edges !== undefined ? { edges } : {}),
});

// ————————————————————————————————————————————
// §6.5 一键生成
// ————————————————————————————————————————————

describe('plan-materializer 一键生成（TDD-C-07 §6.5——01 A-10.3；demo L2284-2310）', () => {
  it('plan-materializer-edges 显式分支路由：PlanCard 四元组→端口元组边形＋dropNodes 落图＋✨顺路入库＋flows.save', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: true };
    const storageLog: StorageLog = { events: [], calls: [] };
    const landed: FlowEdge[][] = [];
    const m: FlowMaterializer = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage(storageLog),
      landEdges: (edges) => {
        canvasLog.events.push('landEdges');
        landed.push(edges);
      },
    });
    const result = await m.materialize(
      plan(
        [
          step('trigger.manual'),
          step('ai.judge', { params: { rule: 'r' } }),
          step('data.vault'),
          step('xhs.search', { src: 'new', params: { keywords: '爆款' } }),
        ],
        [
          [0, 'out', 1, 'in'],
          [1, 'hit', 3, 'in'],
          [1, 'miss', 2, 'in'],
        ],
      ),
    );
    expect(result.ok).toBe(true);

    // 落图：四节点整批 dropNodes（分支拓扑仍单历史项）＋markDirty；name 透传（与落盘同源）
    expect(canvasLog.dropped).toHaveLength(1);
    expect(canvasLog.dropped[0]!.map((s) => s.type)).toEqual(['trigger.manual', 'ai.judge', 'data.vault', 'xhs.search']);
    expect(canvasLog.dropped[0]![3]).toMatchObject({ name: 'xhs.search', params: { keywords: '爆款' } });
    expect(canvasLog.events).toContain('markDirty');

    // edges 分支路由：四元组 [1,'hit',3,'in'] → [nodeId(1),'hit']→[nodeId(3),'in'] 端口元组
    const landedEdges = landed[0]!;
    expect(landedEdges.map((e) => [e.from, e.to])).toEqual([
      [['node-0-0', 'out'], ['node-0-1', 'in']],
      [['node-0-1', 'hit'], ['node-0-3', 'in']],
      [['node-0-1', 'miss'], ['node-0-2', 'in']],
    ]);

    // ✨ 顺路入库：恰 src='new' 一步 library.upsert（类型/参数对齐）
    const upserts = storageLog.calls.filter((c) => c.op === 'library.upsert');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.args).toMatchObject({
      entry: { type: 'xhs.search', name: 'xhs.search', params: { keywords: '爆款' } },
    });

    // flows.create → flows.save label='流程工坊生成'（02 §7.1 label 枚举）
    expect(storageLog.events.filter((e) => e.startsWith('storage:'))).toEqual([
      'storage:flows.create',
      'storage:library.upsert',
      'storage:flows.save',
    ]);
    const save = storageLog.calls.find((c) => c.op === 'flows.save')!.args as {
      id: string;
      name: string;
      label: string;
      edges: FlowEdge[];
    };
    expect(save.id).toBe('flow-gen-0');
    expect(save.name).toBe('爆款采集');
    expect(save.label).toBe('流程工坊生成');
    expect(save.edges).toEqual(landedEdges); // 落图与落盘同一份边（口径单一来源）

    expect(result).toMatchObject({ flowId: 'flow-gen-0', versionId: 'ver-0', newStepTypes: ['xhs.search'] });
  });

  it('plan-materializer-缺省线性串联：edges 缺省 → [i,"out",i+1,"in"]（demo L2298 同位）', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: true };
    const storageLog: StorageLog = { events: [], calls: [] };
    const landed: FlowEdge[][] = [];
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage(storageLog),
      landEdges: (edges) => landed.push(edges),
    });
    await m.materialize(plan([step('trigger.manual'), step('http.notify'), step('data.vault')]));
    expect(landed[0]!.map((e) => [e.from, e.to])).toEqual([
      [['node-0-0', 'out'], ['node-0-1', 'in']],
      [['node-0-1', 'out'], ['node-0-2', 'in']],
    ]);
  });

  it('plan-materializer-dirty 拒绝：guardDirty=false → 零落图零入库零落盘（不覆盖，01 A-10.3）', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: false };
    const storageLog: StorageLog = { events: [], calls: [] };
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage(storageLog),
      landEdges: () => {
        throw new Error('dirty 拒绝路径不应落边');
      },
    });
    const result = await m.materialize(plan([step('trigger.manual')]));
    expect(result).toMatchObject({ ok: false, code: 'DIRTY' });
    expect(result.message).toContain('保存'); // 提示语（demo L2285「先保存或取消再生成」）
    expect(canvasLog.dropped).toHaveLength(0);
    expect(canvasLog.events).toEqual([`guardDirty:workshop:materialize`]); // 仅脏闸询问
    expect(storageLog.calls).toHaveLength(0);
  });

  it('plan-materializer-编排全序：脏闸→flows.create→dropNodes→landEdges→markDirty→✨upsert→flows.save', async () => {
    const events: string[] = []; // 单一全序记录（canvas/storage/landEdges 三 stub 共写）
    const canvasLog: CanvasLog = { dropped: [], patched: [], events, dirtyAllowed: true };
    const storageLog: StorageLog = { events, calls: [] };
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage(storageLog),
      landEdges: () => events.push('landEdges'),
    });
    await m.materialize(plan([step('trigger.manual'), step('xhs.search', { src: 'new' })]));
    expect(events).toEqual([
      'guardDirty:workshop:materialize',
      'storage:flows.create',
      'dropNodes',
      'landEdges',
      'markDirty',
      'storage:library.upsert',
      'storage:flows.save',
    ]);
  });

  it('plan-materializer-布局注入：layout（C-01 dagre 同构）输入拓扑、坐标回填 dropNodes', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: true };
    const layoutInputs: { nodes: { id: string }[]; edges: { source: string; target: string }[] }[] = [];
    const layout: PlanLayoutFn = (nodes, edges) => {
      layoutInputs.push({ nodes: [...nodes], edges: [...edges] });
      return nodes.map((n, i) => ({ id: n.id, position: { x: i * 300, y: 42 } }));
    };
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage({ events: [], calls: [] }),
      layout,
      landEdges: () => undefined,
    });
    await m.materialize(plan([step('a.x'), step('b.y'), step('c.z')], [[0, 'out', 2, 'in']]));
    // 布局输入=步骤拓扑（合成 id 稳定）＋边投影（分支路由参与分层）
    expect(layoutInputs[0]!.nodes.map((n) => n.id)).toEqual(['s0', 's1', 's2']);
    expect(layoutInputs[0]!.edges).toEqual([{ source: 's0', target: 's2' }]);
    // 布局坐标（序对齐）回填 dropNodes
    expect(canvasLog.dropped[0]!.map((s) => s.x)).toEqual([0, 300, 600]);
    expect(canvasLog.dropped[0]!.every((s) => s.y === 42)).toBe(true);
  });

  it('plan-materializer-布局未注入（V1.0 装配缺省）→ 线性占位坐标（demo col 形兜底）', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: true };
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage({ events: [], calls: [] }),
      landEdges: () => undefined,
    });
    await m.materialize(plan([step('a.x'), step('b.y')]));
    expect(canvasLog.dropped[0]!.map((s) => s.x)).toEqual([40, 290]); // x=40+i*250（demo L2286 形）
    expect(canvasLog.dropped[0]!.every((s) => s.y === 200)).toBe(true);
  });

  it('plan-materializer-✨scriptMeta 取自注册定义（C-05 get 注入位）；未注入/未注册=DAO 同款兜底', async () => {
    const storageLogs: StorageLog[] = [];
    const mk = async (getDefinition?: DefinitionLookup) => {
      const log: StorageLog = { events: [], calls: [] };
      storageLogs.push(log);
      const m = createFlowMaterializer({
        canvas: stubCanvas({ dropped: [], patched: [], events: [], dirtyAllowed: true }),
        storage: stubStorage(log),
        landEdges: () => undefined,
        ...(getDefinition !== undefined ? { getDefinition } : {}),
      });
      await m.materialize(plan([step('xhs.search', { src: 'new' })]));
    };
    await mk((type) =>
      type === 'xhs.search'
        ? { exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' } }
        : { exec: null },
    );
    await mk(); // 未注入
    const entries = storageLogs.map(
      (log) => (log.calls.find((c) => c.op === 'library.upsert')!.args as { entry: { scriptMeta: unknown } }).entry.scriptMeta,
    );
    expect(entries[0]).toEqual({ lang: 'python', file: 'scripts/xhs_search.py' }); // 注册定义 N4 exec
    expect(entries[1]).toEqual({ lang: 'ts', file: '' }); // 兜底=LibraryDao rowToEntry 同款
  });

  it('plan-materializer-空计划拒绝（ok:false PLAN-EMPTY，零调用）', async () => {
    const canvasLog: CanvasLog = { dropped: [], patched: [], events: [], dirtyAllowed: true };
    const storageLog: StorageLog = { events: [], calls: [] };
    const m = createFlowMaterializer({
      canvas: stubCanvas(canvasLog),
      storage: stubStorage(storageLog),
      landEdges: () => undefined,
    });
    const result = await m.materialize(plan([]));
    expect(result).toMatchObject({ ok: false, code: 'PLAN-EMPTY' });
    expect(canvasLog.events).toEqual([]);
    expect(storageLog.calls).toHaveLength(0);
  });
});
