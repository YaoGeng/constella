// ConfirmGate —— 确认闸卡片状态机（T5-04；TDD-C-07 §3 ConfirmGate 行＋§1 六环节 5 段；
// 01 A-10.2 冻结：一切「生成」类产物停卡片等确认、确认前零写入、绝不直接改画布）。
//   三卡停确认：计划卡（重新规划/一键生成）、草稿卡（T5-03「加入画布」）、差异卡（「应用」）。
//   状态机：stage→pending；confirm→confirmed（唯一写入触发＝注入编排）；discard/superseded→
//   discarded（confirm 拒 CARD-STALE）。「重新规划不残留旧卡」＝新计划卡 stage 时顶替一切
//   pending 计划卡（旧卡 supersededBy 留痕、待确认队列只留新卡——demo 重新规划语义）。
//   零写入结构性保证：门自身无 C-05/C-06 依赖面（register 结构性零调用）；所有写入只在
//   confirm 触发的注入编排内（计划=FlowMaterializer；差异=CanvasSink.patchNode N6 字段化
//   params/policy〔结构体字段级——非自由文本，PRD-CUSTOM-N6〕；草稿=T5-03 adoptDraft 注入）。
//   编排失败（materialize ok:false）卡保持 pending 可重试；异常上抛不吞、卡不消费。
// P-3 注入面：canvasSink=T3-08 CanvasSink 导出面（本组件消费 patchNode）；materialize/
// adoptDraft＝组件级注入（引擎装配绑定——confirmPlan/adoptDraft 的写入半段）。
import type { RunPolicy } from '@constella/shared/dsl';
import type { CanvasSink } from '../canvas/sink/canvas-sink';
import type { MaterializeResult } from './flow-materializer';
import type { PlanCard } from './flow-planner';

/** 差异卡字段化变更行（展示用——每行=一个 N6 policy/params 字段；「追加：失败重试 ×3」demo L2395-2407 形） */
export interface DiffFieldChange {
  /** 字段定位（如 'policy.retries'） */
  field: string;
  /** 目标域：params＝实例参数 / policy＝N6 运行策略 */
  target: 'params' | 'policy';
  /** 原值（展示「从→到」） */
  from?: unknown;
  /** 新值（字段级） */
  to: unknown;
}

/**
 * 差异卡（「优化选中」意图产物——02 §9.2 表首行）。apply＝patchNode 载荷：params 域字段
 * 并入（flowStore.patchNode 原生合并）；policy＝应用后完整 N6 值（patchNode 为整写——
 * 卡生产时合并现值；非自由文本＝字段化结构体，不含脚本/文本负载）。
 */
export interface DiffCard {
  id: string;
  /** 目标节点（选中节点） */
  nodeId: string;
  /** 卡头文案（如「追加：失败重试 ×3 · 超时 10s」） */
  title: string;
  /** 字段化变更行（逐行列卡） */
  changes: readonly DiffFieldChange[];
  /** 「应用」载荷（patchNode 面——N6 字段化 params/policy） */
  apply: { params?: Record<string, unknown>; policy?: RunPolicy };
}

export type ConfirmCardKind = 'plan' | 'draft' | 'diff';

/** 停确认卡（§3 stage(card) 入参——三卡联合） */
export type ConfirmCard =
  | { kind: 'plan'; plan: PlanCard }
  | { kind: 'draft'; draft: unknown; id?: string }
  | { kind: 'diff'; diff: DiffCard };

export type ConfirmStatus = 'pending' | 'confirmed' | 'discarded';

/** 门内卡记录（状态机实体——UI 消费 pending()/get()） */
export interface StagedCard {
  id: string;
  kind: ConfirmCardKind;
  status: ConfirmStatus;
  plan?: PlanCard;
  draft?: unknown;
  diff?: DiffCard;
  /** 重新规划顶替留痕（被哪张新卡顶替） */
  supersededBy?: string;
}

export type ConfirmGateErrorCode =
  | 'CARD-UNKNOWN' // confirm/discard 未知 id
  | 'CARD-STALE' // 已确认/已放弃/被顶替卡再操作
  | 'PLAN-NO-MATERIALIZER' // 计划卡确认未装配 materialize
  | 'DRAFT-NO-ADOPT' // 草稿卡确认未装配 adoptDraft（T5-03 接线前）
  | 'DIFF-NO-SINK'; // 差异卡应用未装配 canvasSink

export class ConfirmGateError extends Error {
  readonly code: ConfirmGateErrorCode;
  constructor(code: ConfirmGateErrorCode, message: string) {
    super(message);
    this.name = 'ConfirmGateError';
    this.code = code;
  }
}

export interface ConfirmGateDeps {
  /** CanvasSink 注入位＝T3-08 导出面（差异卡「应用」落点——patchNode 消费） */
  canvasSink?: Pick<CanvasSink, 'patchNode'>;
  /** 计划卡「一键生成」注入位（引擎装配绑 FlowMaterializer.materialize——§3 复用处 confirmPlan） */
  materialize?: (plan: PlanCard) => Promise<MaterializeResult>;
  /** 草稿卡「加入画布」注入位（T5-03 adoptDraft 接线） */
  adoptDraft?: (draft: unknown) => Promise<unknown>;
}

/** confirm 产出（kind＋编排结果——UI/A-10.2 断言面） */
export interface ConfirmOutcome {
  kind: ConfirmCardKind;
  result?: unknown;
}

export interface ConfirmGate {
  /** §3 stage(card)：停卡片待确认（零写入——登记即返回） */
  stage(card: ConfirmCard): StagedCard;
  /** §3 confirm(id)：唯一写入触发点（非 pending→CARD-STALE/CARD-UNKNOWN） */
  confirm(id: string): Promise<ConfirmOutcome>;
  /** 放弃（「重新规划」显式弃卡路径） */
  discard(id: string): void;
  get(id: string): StagedCard | undefined;
  /** 待确认卡（重新规划不残留：新计划卡顶替后只余新卡） */
  pending(): readonly StagedCard[];
}

let cardSeq = 0;

export function createConfirmGate(deps: ConfirmGateDeps): ConfirmGate {
  const cards = new Map<string, StagedCard>();

  const requirePending = (id: string): StagedCard => {
    const card = cards.get(id);
    if (card === undefined) throw new ConfirmGateError('CARD-UNKNOWN', `卡片不存在：${id}`);
    if (card.status !== 'pending') {
      throw new ConfirmGateError('CARD-STALE', `卡片已${card.status === 'confirmed' ? '确认' : '放弃/顶替'}：${id}`);
    }
    return card;
  };

  return {
    stage: (card) => {
      // 「重新规划不残留旧卡」：新计划卡顶替一切 pending 计划卡（demo 重新规划语义）
      if (card.kind === 'plan') {
        for (const existing of cards.values()) {
          if (existing.kind === 'plan' && existing.status === 'pending') {
            existing.status = 'discarded';
            existing.supersededBy = card.plan.id;
          }
        }
      }
      const id =
        card.kind === 'plan' ? card.plan.id : card.kind === 'diff' ? card.diff.id : (card.id ?? `card-${++cardSeq}`);
      const staged: StagedCard = {
        id,
        kind: card.kind,
        status: 'pending',
        ...(card.kind === 'plan' ? { plan: card.plan } : card.kind === 'diff' ? { diff: card.diff } : { draft: card.draft }),
      };
      cards.set(id, staged);
      return staged;
    },

    confirm: async (id) => {
      const card = requirePending(id);
      if (card.kind === 'plan') {
        if (deps.materialize === undefined) {
          throw new ConfirmGateError('PLAN-NO-MATERIALIZER', '计划卡确认未装配一键生成编排（FlowMaterializer）');
        }
        const result = await deps.materialize(card.plan!);
        if (!(result as MaterializeResult)?.ok) {
          return { kind: 'plan', result }; // 脏闸/空计划等拒绝：卡不消费（保存后可重试）
        }
        card.status = 'confirmed';
        return { kind: 'plan', result };
      }
      if (card.kind === 'diff') {
        if (deps.canvasSink === undefined) {
          throw new ConfirmGateError('DIFF-NO-SINK', '差异卡应用未装配 CanvasSink（patchNode）');
        }
        // N6 字段化应用（T3-08 面 policy 形=Record<string,unknown> 宽松——N6 结构在 DiffCard
        // 类型层收窄，此处仅形状适配不改语义）
        deps.canvasSink.patchNode(card.diff!.nodeId, {
          ...(card.diff!.apply.params !== undefined ? { params: card.diff!.apply.params } : {}),
          ...(card.diff!.apply.policy !== undefined
            ? { policy: card.diff!.apply.policy as unknown as Record<string, unknown> }
            : {}),
        });
        card.status = 'confirmed';
        return { kind: 'diff' };
      }
      if (deps.adoptDraft === undefined) {
        throw new ConfirmGateError('DRAFT-NO-ADOPT', '草稿卡确认未装配加入画布动作（T5-03 adoptDraft）');
      }
      const result = await deps.adoptDraft(card.draft);
      card.status = 'confirmed';
      return { kind: 'draft', result };
    },

    discard: (id) => {
      requirePending(id).status = 'discarded';
    },

    get: (id) => cards.get(id),

    pending: () => [...cards.values()].filter((c) => c.status === 'pending'),
  };
}
