// C-10 §6.3 集成冒烟（T6-16 A2 复跑项；锚=docs/03「### TDD-C-10」§6.3＋TDD-C-03 §4/§6.1c/§6.1h）。
//   §6.3 原文：「双流程并行→两行心跳独立；行内终止→行转 aborted 且终止响应 <200ms（01 §12；
//   扩散本体断言归 C-03 §6.1h）」——「应用壳联跑」在测试面的落位=assembly 合流层（C-03 run 域与
//   C-10 runs$ 在此合法同 import；run/ 内反向 import taskcenter 违 P-3 依赖向）。
// 深度裁定（T6-16 卡文）：RunEngine/run 域集成——真件=createRunEngine（RunGate/TopoPlanner/RunLoop/
//   AbortCoordinator/StatusBus/RunLedger 全链）＋createRunsSource（HeartbeatTicker/RunRowProjector/
//   runs$ 快照面）＋useRunStore 真身镜像；假件=storage mock bridge＋执行面 Transport（脚本挂起等
//   kill——run-engine.abort.spec 同款）。无 Electron/React 宿主定时（抗抖动）。
// 断言面（§6.3 两条，行级=C-10 域）：
//   ① 双流程并行：两行 elapsedMs 各自按 t0 独立推进互不串扰（错峰启动 2s 判别）＋currentNodes
//      取各自 flow 槽位镜像（statuses 不串台）＋心跳拍只刷未结束行；
//   ② 行内终止：abortRun（TaskCenterDeps.abortRun 同链）→ 任务行转 aborted——终止响应 <200ms
//      （01 §12 设计值；fake timers 虚拟时钟判定＝只计引擎排程步进〔50ms 步进自觉退出等〕，宿主
//      排程抖动被排除；步进预算 8×25ms＝200ms 上限内翻转）；对端指标语义归属：runStore
//      activeRunOfFlow 解除（C-03 §4 runs 镜像）＋runs.finish(aborted)（行转 aborted 记录源）。
// 扩散本体（killScript×活跃数/destroyRun 恰一次/断点放行）不重复断言——归 C-03 §6.1h 套件。
// 记录侧驱动口径：行转 aborted 依赖 runs 记录刷新（runs-source「收尾刷新=refresh 注入位」）——
//   T6-19 ②起产品装配已接线（app-runtime listRuns=runs.list 快照＋活跃集变化重读→onRunsChanged
//   →AppShell 连接器 source.refresh，装配级断言见 app-shell.spec.tsx「▶运行/■终止」两例）；本冒烟
//   的 refresh() 测试侧驱动保留为引擎/数据面最小化形态（不挂 React 宿主——抗抖动设计不变）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowDoc, FlowEdge, FlowNode, ScriptEvent, StorageInvokeReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createStorageClient, type StorageBridge } from '../storage';
import { createRunEngine, useRunStore, type RunRegistryLike, type RunTransport } from '../run';
import { createRunsSource, type RunsSource } from '../taskcenter';

// ————————————————————————————————————————————
// fixture（run-engine.spec/abort.spec 同款形态）
// ———————————————————————————————————————————

const T0 = 1_700_000_000_000;

function def(type: string, ins: string[], over: Partial<NodeDefinition> = {}): NodeDefinition {
  const custom = type.startsWith('custom.');
  return {
    type,
    kind: custom ? 'custom' : 'builtin',
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins, outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: custom ? { lang: 'ts', file: `scripts/${type}.ts`, entry: 'run' } : null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...over,
  };
}

function fakeRegistry(): RunRegistryLike {
  const defs = [def('trigger.manual', []), def('custom.x', ['in'])];
  return { get: (t) => defs.find((d) => d.type === t), isBroken: () => false };
}

function node(id: string, type: string, over: Partial<FlowNode> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params: {}, ...over };
}

function edge(from: string, to: string): FlowEdge {
  return { id: `${from}(out)--${to}`, from: [from, 'out'], to: [to, 'in'] };
}

/** t1→s（custom.x 挂起脚本）单链：run 在途、活动节点恒 1（两流程同形不同节点名） */
function flowDoc(id: string, scriptNodeId: string): FlowDoc {
  return {
    id,
    name: `流程${id}`,
    nodes: [node('t1', 'trigger.manual'), node(scriptNodeId, 'custom.x', { name: `采集脚本${id}` })],
    edges: [edge('t1', scriptNodeId)],
  };
}

/** 执行面 fake：spawn 后挂起（无 behavior 不发帧——节点 running 到 kill 为止）＋kill→exit 1（abort.spec 同款） */
function makeExecTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: string[] = [];
  const kills: string[] = [];
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push(req.nodeRunId);
      return { ok: true, pid: 1 };
    },
    killScript: async (req) => {
      kills.push(req.nodeRunId);
      for (const fn of scriptSubs) fn({ nodeRunId: req.nodeRunId, kind: 'exit', code: 1, ms: 1 });
      return { ok: true };
    },
    cdpCreateSession: async () => ({ port: 9221, partition: 'persist:x·main' }),
    cdpNavigate: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => ({ ok: true }),
  };
  return { transport, spawns, kills };
}

/** runs 记录内存镜像（runs.create/finish 同点维护——runs$ listRuns 数据面） */
interface RunRec {
  runId: string;
  flowId: string;
  flowName: string;
  status: 'running' | 'waiting' | 'done' | 'error' | 'aborted';
  t0: number;
  t1: number | null;
  total: number;
}

function makeEnv(docMap: Record<string, FlowDoc>) {
  const fx = makeExecTransport();
  const calls: StorageInvokeReq[] = [];
  const handlers = new Map<string, (req: StorageInvokeReq) => unknown>();
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      const h = handlers.get(req.op);
      if (h === undefined) throw new Error(`mock bridge 未注册 op：${req.op}`);
      return h(req);
    },
  };
  const client = createStorageClient(bridge);
  const runRecs = new Map<string, RunRec>();
  let runSeq = 0;
  handlers.set('flows.get', (req) => {
    const { id } = (req as { op: 'flows.get'; args: { id: string } }).args;
    const doc = docMap[id];
    if (doc === undefined) throw new Error(`flow 不存在：${id}`);
    return doc;
  });
  handlers.set('runs.create', (req) => {
    const { flowId, name } = (req as { op: 'runs.create'; args: { flowId: string; name: string } }).args;
    const id = `r${++runSeq}`;
    runRecs.set(id, { runId: id, flowId, flowName: name, status: 'running', t0: Date.now(), t1: null, total: 0 });
    return { id };
  });
  handlers.set('runs.finish', (req) => {
    const a = (req as { op: 'runs.finish'; args: { runId: string; status: RunRec['status']; t1: number; total: number } }).args;
    const rec = runRecs.get(a.runId);
    if (rec !== undefined) {
      rec.status = a.status;
      rec.t1 = a.t1;
      rec.total = a.total;
    }
    return undefined;
  });
  for (const op of ['runs.nodeRunStart', 'runs.nodeRunFinish', 'logs.append']) handlers.set(op, () => undefined);

  const engine = createRunEngine({
    storage: client,
    registry: fakeRegistry(),
    guardDirty: () => false,
    transport: fx.transport,
  });

  /** runs$（真 createRunsSource——HeartbeatTicker 1s 默认拍＋runStore 真身镜像消费） */
  const nodeNameOf = (flowId: string, nodeId: string): string => docMap[flowId]?.nodes.find((n) => n.id === nodeId)?.name ?? '…';
  const source: RunsSource = createRunsSource({
    listRuns: () => [...runRecs.values()],
    runStore: useRunStore,
    portsOf: () => [],
    nodeName: nodeNameOf,
    now: () => Date.now(),
  });

  return { engine, source, runRecs, calls, spawns: fx.spawns, kills: fx.kills };
}

/** 微任务泵（fake timers 下冲 startRun/spawn/finish 异步链；每轮至少一 macrotask 边界） */
const pump = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  useRunStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ————————————————————————————————————————————
// §6.3 ① 双流程并行 → 两行心跳独立（elapsed/currentNodes 互不串扰）
// ————————————————————————————————————————————

describe('C-10 §6.3 集成冒烟：双流程并行两行心跳独立', () => {
  it('错峰启动：两行 elapsedMs 各按 t0 独立推进、currentNodes 取各自槽位镜像、心跳只刷未结束行', async () => {
    const env = makeEnv({ f1: flowDoc('f1', 's1'), f2: flowDoc('f2', 's2') });

    const h1 = await env.engine.startRun('f1'); // t0=T0
    env.source.refresh(); // f1 行入表（活行驱动位——装配面语义见文件头注）
    await pump(); // 等 s1 spawn（微任务链）
    expect(env.spawns.filter((id) => id.startsWith('r1:'))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000); // f1 独跑 2s（错峰判别基点）
    const h2 = await env.engine.startRun('f2'); // t0=T0+2000
    env.source.refresh();
    await pump();
    expect(env.spawns.filter((id) => id.startsWith('r2:'))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3_000); // 两行并行心跳推进 3s
    const rows = env.source.snapshot();
    expect(rows.map((r) => r.runId)).toEqual(['r1', 'r2']);
    expect(rows[0]).toMatchObject({ flowId: 'f1', status: 'running', elapsedMs: 5_000 }); // (T0+5000)-T0
    expect(rows[1]).toMatchObject({ flowId: 'f2', status: 'running', elapsedMs: 3_000 }); // (T0+5000)-(T0+2000)
    expect(rows[0]?.currentNodes).toEqual(['采集脚本f1']); // 各自 flow 槽位 statuses 镜像——不串台
    expect(rows[1]?.currentNodes).toEqual(['采集脚本f2']);
    expect(env.source.unfinishedRunIds()).toEqual(['r1', 'r2']); // 两行均在心跳面
    void h1;
    void h2;
  });
});

// ————————————————————————————————————————————
// §6.3 ② 行内终止 → 行转 aborted 且终止响应 <200ms（01 §12；01 §12 对端=C-03）
// ————————————————————————————————————————————

describe('C-10 §6.3 集成冒烟：行内终止行转 aborted <200ms', () => {
  it('abortRun 后任务行 200ms 虚拟预算内转 aborted；他流程心跳不受扰、t1 行用时冻结', async () => {
    const env = makeEnv({ f1: flowDoc('f1', 's1'), f2: flowDoc('f2', 's2') });
    const h1 = await env.engine.startRun('f1');
    const h2 = await env.engine.startRun('f2');
    env.source.refresh();
    await pump();
    expect(env.spawns).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000); // 心跳在途（虚拟 T0+1000）

    const tAbort = Date.now();
    env.engine.abortRun(h1!.runId); // 行内终止注入位（TaskCenterDeps.abortRun 同链）

    // 终止响应 <200ms（01 §12 设计值）：虚拟时钟 25ms 步进轮询行翻转——宿主排程抖动被排除（抗抖动设计；
    // 扩散本体＝置位+killScript+drain 收尾，本体断言归 C-03 §6.1h）
    let flippedAt: number | null = null;
    for (let i = 0; i <= 7; i++) {
      await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 25);
      env.source.refresh(); // 收尾刷新注入位（装配面缺位登记见文件头注——测试侧等价驱动）
      const row = env.source.snapshot().find((r) => r.runId === h1!.runId);
      if (row?.status === 'aborted') {
        flippedAt = Date.now() - tAbort;
        break;
      }
    }
    expect(flippedAt).not.toBeNull();
    expect(flippedAt!).toBeLessThan(200); // 设计值 200ms（01 §12）；实测虚拟翻转在 0ms 拍（微任务链——预算裕度真实）

    // 行级终态：r1 转 aborted＋t1 冻结用时；对端指标（C-03 §4）：runs.finish(aborted)＋runStore 解除 f1 活跃
    const row1 = env.source.snapshot().find((r) => r.runId === h1!.runId);
    expect(row1).toMatchObject({ status: 'aborted' });
    const frozen = row1!.elapsedMs; // t1 行用时冻结基线（下段 +2000ms 后复核对拍）
    const finish = env.calls.find((c) => c.op === 'runs.finish') as { args: Record<string, unknown> } | undefined;
    expect(finish?.args).toMatchObject({ runId: h1!.runId, status: 'aborted' });
    expect(useRunStore.getState().activeRunOfFlow.f1).toBeUndefined();
    expect(useRunStore.getState().activeRunOfFlow.f2).toBe(h2!.runId);
    expect(env.kills.length).toBeGreaterThanOrEqual(1); // 终止扩散已触发（r1 活跃脚本强杀——冒烟级计数）

    // 他流程不受扰：r2 心跳照常推进（+2000ms）、r1 冻结行不被心跳拍复增
    await vi.advanceTimersByTimeAsync(2_000);
    env.source.refresh();
    const after = env.source.snapshot();
    expect(after.find((r) => r.runId === h2!.runId)).toMatchObject({ status: 'running', elapsedMs: 3_000 });
    expect(after.find((r) => r.runId === h1!.runId)?.elapsedMs).toBe(frozen);
    expect(env.source.unfinishedRunIds()).toEqual([h2!.runId]); // 心跳面只剩未结束行（§6.1b timer 语义）
    env.engine.dispose();
    env.source.dispose();
  });
});
