// ConfirmGate 确认闸套件（T5-04；TDD-C-07 §6.4；01 A-10.2 冻结：一切生成产物停卡片等确认、
// 确认前零写入）。断言面：
//   计划/草稿/差异三卡停确认；确认前 C-05 register（结构性零调用——门无该面）/C-06 save/
//   library.upsert/CanvasSink 落图**零调用**（A-10.2 冻结断言）；「重新规划」不残留旧卡
//   （新计划卡顶替＝旧卡 discard＋confirm 拒 CARD-STALE）；确认后唯一写入触发＝注入编排
//   （计划→FlowMaterializer；差异→patchNode N6 字段化 params/policy——非自由文本）。
// 注入件全 stub（P-3）：materialize=FlowMaterializer（真组件＋recorder 注入）；canvasSink=
//   T3-08 面 patchNode；adoptDraft=T5-03 注入位（本卡 stub）。
import { describe, expect, it } from 'vitest';
import type { StorageInvokeRes, StorageOp } from '@constella/shared/ipc';
import type { StorageInvokeArgs } from '../storage';
import type { CanvasSink } from '../canvas/sink/canvas-sink';
import { createConfirmGate, ConfirmGateError, type ConfirmGate, type DiffCard } from './confirm-gate';
import { createFlowMaterializer } from './flow-materializer';
import type { PlanCard, PlanStep } from './flow-planner';

// ————————————————————————————————————————————
// stub ＋ 装配（真 FlowMaterializer＋recorder 注入——A-10.2 断言经真编排链）
// ————————————————————————————————————————————

const step = (type: string, over: Partial<PlanStep> = {}): PlanStep => ({
  src: 'lib',
  type,
  name: type,
  params: {},
  ...over,
});

const plan = (id: string, steps: PlanStep[] = [step('trigger.manual')]): PlanCard => ({
  id,
  flowName: '确认闸流程',
  steps,
});

interface Harness {
  gate: ConfirmGate;
  events: string[];
  storageCalls: { op: string; args?: unknown }[];
  canvasEvents: string[];
  /** 落图批次记录（引用型——断言取 length） */
  dropped: { types: string[] }[];
}

/** A-10.2 断言装配：gate.materialize＝真 FlowMaterializer（sink/storage 全 recorder） */
function assembleHarness(opts?: { dirtyAllowed?: boolean }): Harness {
  const events: string[] = [];
  const storageCalls: { op: string; args?: unknown }[] = [];
  const dropped: { types: string[] }[] = [];
  const canvas: Pick<CanvasSink, 'dropNodes' | 'markDirty' | 'guardDirty' | 'patchNode'> = {
    dropNodes: (specs) => {
      const batch = dropped.length;
      dropped.push({ types: specs.map((s) => s.type) });
      return specs.map((_, i) => `node-${batch}-${i}`);
    },
    markDirty: () => events.push('markDirty'),
    guardDirty: () => opts?.dirtyAllowed !== false,
    patchNode: (nodeId, patch) => events.push(`patchNode:${nodeId}`, JSON.stringify(patch)),
  };
  const storage = {
    invoke: async <T extends StorageOp>(op: T, args: StorageInvokeArgs<T>) => {
      events.push(`storage:${op}`);
      storageCalls.push({ op, args: args as unknown });
      if (op === 'flows.create') return { id: 'flow-g-0' } as StorageInvokeRes<T>;
      if (op === 'flows.save') return { versionId: 'ver-g-0' } as StorageInvokeRes<T>;
      return undefined as StorageInvokeRes<T>;
    },
  };
  const materializer = createFlowMaterializer({
    canvas,
    storage,
    landEdges: () => events.push('landEdges'),
  });
  const gate = createConfirmGate({ canvasSink: canvas, materialize: (p) => materializer.materialize(p) });
  return { gate, events, storageCalls, canvasEvents: events, dropped };
}

const diffCard = (over: Partial<DiffCard> = {}): DiffCard => ({
  id: 'diff-1',
  nodeId: 'node-9',
  title: '追加：失败重试 ×3 · 超时 10s',
  changes: [
    { field: 'policy.retries', target: 'policy', from: 0, to: 3 },
    { field: 'policy.timeoutMs', target: 'policy', from: 30000, to: 10000 },
  ],
  apply: { policy: { retries: 3, timeoutMs: 10000 } },
  ...over,
});

// ————————————————————————————————————————————
// §6.4 确认闸
// ————————————————————————————————————————————

describe('plan-confirm 确认闸（TDD-C-07 §6.4——01 A-10.2 冻结）', () => {
  it('plan-confirm-计划卡停确认＝零写入：stage 后 C-05 register（结构性零面）/C-06 save·upsert/落图零调用', () => {
    const h = assembleHarness();
    h.gate.stage({ kind: 'plan', plan: plan('plan-a') });
    // A-10.2 冻结断言：确认前 C-06 全 op 零调用＋CanvasSink 零落图（C-05 register：门与
    // materializer 均无该方法依赖面——结构性零调用，见模块头 imports 声明）
    expect(h.storageCalls).toHaveLength(0);
    expect(h.events).toEqual([]);
    expect(h.dropped).toHaveLength(0);
    expect(h.gate.pending().map((c) => c.id)).toEqual(['plan-a']);
  });

  it('plan-confirm-确认后唯一写入：confirm→FlowMaterializer 恰一次编排（flows.create/upsert/save）', async () => {
    const h = assembleHarness();
    h.gate.stage({ kind: 'plan', plan: plan('plan-a', [step('trigger.manual'), step('xhs.search', { src: 'new' })]) });
    const outcome = await h.gate.confirm('plan-a');
    expect(outcome.kind).toBe('plan');
    expect(outcome.result).toMatchObject({ ok: true, flowId: 'flow-g-0', versionId: 'ver-g-0' });
    expect(h.storageCalls.map((c) => c.op)).toEqual(['flows.create', 'library.upsert', 'flows.save']);
    expect(h.dropped).toHaveLength(1);
    expect(h.gate.get('plan-a')!.status).toBe('confirmed');
  });

  it('plan-confirm-重新规划不残留旧卡：新计划卡顶替＝旧卡 discarded＋confirm 拒 CARD-STALE；pending 只留新卡', async () => {
    const h = assembleHarness();
    h.gate.stage({ kind: 'plan', plan: plan('plan-old') });
    const staged = h.gate.stage({ kind: 'plan', plan: plan('plan-new') });
    expect(staged.id).toBe('plan-new');
    expect(h.gate.pending().map((c) => c.id)).toEqual(['plan-new']); // 旧卡不残留待确认队列
    const old = h.gate.get('plan-old')!;
    expect(old.status).toBe('discarded');
    expect(old.supersededBy).toBe('plan-new');
    await expect(h.gate.confirm('plan-old')).rejects.toMatchObject({ code: 'CARD-STALE' });
    expect(h.storageCalls).toHaveLength(0); // 旧卡确认被拒——零写入
    await h.gate.confirm('plan-new'); // 新卡正常确认（恰一次编排）
    expect(h.dropped).toHaveLength(1);
  });

  it('plan-confirm-差异卡停确认零写入；确认「应用」＝patchNode 改 N6 字段化 params/policy（非自由文本）', async () => {
    const h = assembleHarness();
    const diff = diffCard({
      changes: [
        { field: 'policy.retries', target: 'policy', from: 0, to: 3 },
        { field: 'params.minIntervalSec', target: 'params', from: 60, to: 120 },
      ],
      apply: { params: { minIntervalSec: 120 }, policy: { retries: 3, timeoutMs: 30000 } },
    });
    h.gate.stage({ kind: 'diff', diff });
    expect(h.storageCalls).toHaveLength(0); // 确认前零写入
    expect(h.events).toEqual([]);
    const outcome = await h.gate.confirm(diff.id);
    expect(outcome.kind).toBe('diff');
    // patchNode 面断言：字段化 patch（对象字段级——policy/params 结构体，非自由文本串）
    expect(h.events).toEqual(['patchNode:node-9', JSON.stringify({ params: { minIntervalSec: 120 }, policy: { retries: 3, timeoutMs: 30000 } })]);
    expect(h.storageCalls).toHaveLength(0); // 差异卡应用零 C-06 调用
    expect(h.gate.get(diff.id)!.status).toBe('confirmed');
  });

  it('plan-confirm-差异卡缺 canvasSink → DIFF-NO-SINK（卡保持 pending 可补装配后重试）', async () => {
    const gate = createConfirmGate({});
    gate.stage({ kind: 'diff', diff: diffCard() });
    await expect(gate.confirm('diff-1')).rejects.toMatchObject({ code: 'DIFF-NO-SINK' });
    expect(gate.get('diff-1')!.status).toBe('pending');
  });

  it('plan-confirm-草稿卡停确认（T5-03 adoptDraft 注入位）：确认前零写入、确认后恰调一次', async () => {
    const adopted: unknown[] = [];
    const gate = createConfirmGate({
      materialize: (p) => {
        throw new Error(`不应编排计划: ${p.id}`);
      },
      adoptDraft: async (draft) => {
        adopted.push(draft);
        return { nodeId: 'node-draft-0' };
      },
    });
    const staged = gate.stage({ kind: 'draft', draft: { preview: 'N1~N8 定义＋脚本' } });
    expect(staged.id).toEqual(expect.any(String));
    expect(adopted).toHaveLength(0);
    const outcome = await gate.confirm(staged.id);
    expect(outcome).toMatchObject({ kind: 'draft', result: { nodeId: 'node-draft-0' } });
    expect(adopted).toHaveLength(1);
  });

  it('plan-confirm-草稿卡缺 adoptDraft → DRAFT-NO-ADOPT；计划卡缺 materialize → PLAN-NO-MATERIALIZER', async () => {
    const gate = createConfirmGate({});
    const d = gate.stage({ kind: 'draft', draft: {} });
    await expect(gate.confirm(d.id)).rejects.toMatchObject({ code: 'DRAFT-NO-ADOPT' });
    gate.stage({ kind: 'plan', plan: plan('plan-x') });
    await expect(gate.confirm('plan-x')).rejects.toMatchObject({ code: 'PLAN-NO-MATERIALIZER' });
  });

  it('plan-confirm-状态机边界：未知 id=CARD-UNKNOWN；重复确认/放弃后确认=CARD-STALE；discard 零写入', async () => {
    const h = assembleHarness();
    await expect(h.gate.confirm('nope')).rejects.toMatchObject({ code: 'CARD-UNKNOWN' });
    h.gate.stage({ kind: 'plan', plan: plan('plan-a') });
    await h.gate.confirm('plan-a');
    await expect(h.gate.confirm('plan-a')).rejects.toMatchObject({ code: 'CARD-STALE' }); // 重复确认拒
    expect(h.dropped).toHaveLength(1); // 恰一次
    h.gate.stage({ kind: 'plan', plan: plan('plan-b') });
    h.gate.discard('plan-b');
    await expect(h.gate.confirm('plan-b')).rejects.toMatchObject({ code: 'CARD-STALE' }); // 放弃后确认拒
    expect(h.dropped).toHaveLength(1); // 放弃路径零写入
    expect(h.gate.pending()).toHaveLength(0);
  });

  it('plan-confirm-编排失败（materialize ok:false dirty）卡保持 pending 可重试；异常上抛不吞', async () => {
    const dirtyMat = createFlowMaterializer({
      canvas: { dropNodes: () => [], markDirty: () => undefined, guardDirty: () => false },
      storage: { invoke: async () => {
        throw new Error('不应触达 storage——dirty 已拒');
      } },
    });
    const gate = createConfirmGate({ materialize: (p) => dirtyMat.materialize(p) });
    gate.stage({ kind: 'plan', plan: plan('plan-dirty') });
    const outcome = await gate.confirm('plan-dirty');
    expect(outcome.result).toMatchObject({ ok: false, code: 'DIRTY' });
    expect(gate.get('plan-dirty')!.status).toBe('pending'); // 未消费——保存后可重试
    const boom = createConfirmGate({
      materialize: () => {
        throw new Error('storage down');
      },
    });
    boom.stage({ kind: 'plan', plan: plan('plan-boom') });
    await expect(boom.confirm('plan-boom')).rejects.toThrow('storage down'); // 异常上抛
    expect(boom.get('plan-boom')!.status).toBe('pending');
    expect(() => {
      throw new ConfirmGateError('CARD-UNKNOWN', 'x');
    }).toThrow(); // 类型面导出存在性
  });
});
