// FlowMaterializer —— 「一键生成」确认后编排（T5-04；TDD-C-07 §3 FlowMaterializer 行＋§1 六环节
// 6 段；01 A-10.3；02 §9.1「确认后入库上画布」）。demo L2284-2310 genFlowFromPlan 语义正式化。
//   编排序（卡冻结）：脏闸前置（dirty 拒绝提示不覆盖——01 A-10.3/demo L2285）→ edges 解析
//   （PlanCard 四元组 [i,'exit',j,'in']→端口元组边形；缺省线性串联 [i,'out',i+1,'in']——
//   demo L2298 同位，resolvePlanEdges 单一来源）→ flows.create 取流程 id → dropNodes 整批落图
//   （坐标=注入 layout——dagre 归 C-01 域〔T3-07 LayoutEngine 同构签名，经应用壳编排注入，
//   P-3 无 import 边〕；缺省=线性占位 x=40+i*250〔demo L2286 实现示例形〕）→ landEdges 落边
//   → markDirty（进入编辑态）→ ✨步骤（src='new'）顺路 library.upsert（「开发即沉淀」——
//   scriptMeta 取 C-05 get 注册定义 N4 exec）→ flows.save label='流程工坊生成'（02 §7.1
//   flow_versions.label 枚举）。
// P-3 注入面：canvas=T3-08 CanvasSink 导出面（dropNodes/markDirty/guardDirty——卡冻结签名；
//   patchNode 归 ConfirmGate 差异卡消费）；storage=C-06 storageClient.invoke（flows.create/
//   flows.save/library.upsert）；getDefinition=C-05 get。
// ⚠ 会签留痕（landEdges 注入位）：T3-08 CanvasSink 冻结面无整图落边 op，而 §6.5 验收要求
//   edges 显式分支路由「落图」——本卡增设 landEdges(edges: FlowEdge[]) 注入位（端口元组形＝
//   C-01 toXyEdges 消费形），装配（T5-11 模块收口）绑 flowStore.setEdges 合并写；是否并入
//   CanvasSink 导出面（addEdges）随 C-01 会签，接口先定（P-3 替换点同款）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { FlowEdge, FlowNode, LibraryEntry } from '@constella/shared/ipc';
import type { CanvasSink } from '../canvas/sink/canvas-sink';
import type { StorageClient } from '../storage';
import type { PlanCard } from './flow-planner';
import { resolvePlanEdges } from './plan-validator';

/** 02 §7.1 flow_versions.label 枚举值——「一键生成」专用版本标记（C-06 flows.save 行） */
export const WORKSHOP_FLOW_LABEL = '流程工坊生成';

/** 失败码（结果对象非异常——UI 可直接 toast；DIRTY=脏闸拒绝〔01 A-10.3〕/PLAN-EMPTY=空计划防御） */
export type MaterializeFailureCode = 'DIRTY' | 'PLAN-EMPTY';

export interface MaterializeResult {
  ok: boolean;
  /** ok=false 时的失败定位码 */
  code?: MaterializeFailureCode;
  /** 人读提示（列卡/toast 直显） */
  message?: string;
  /** 新流程 id（flows.create） */
  flowId?: string;
  /** 「流程工坊生成」版本 id（flows.save） */
  versionId?: string;
  /** 落图节点 id（dropNodes 返回，序对齐 steps） */
  nodeIds?: string[];
  /** ✨ 顺路入库的步骤类型清单（来源统计行/日志用） */
  newStepTypes?: string[];
}

/** dagre 布局注入位（C-01 T3-07 LayoutEngine.layout 同构签名——经应用壳编排注入，P-3 无 import 边） */
export type PlanLayoutFn = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
) => { id: string; position: { x: number; y: number } }[];

/** ✨ scriptMeta 取值面（C-05 get 注入位收窄投影） */
export type DefinitionLookup = (type: string) => Pick<NodeDefinition, 'exec'> | undefined;

export interface FlowMaterializerDeps {
  /** CanvasSink 注入位＝T3-08 导出面（本组件消费 dropNodes/markDirty/guardDirty） */
  canvas: Pick<CanvasSink, 'dropNodes' | 'markDirty' | 'guardDirty'>;
  /** C-06 storageClient 注入位（flows.create/flows.save/library.upsert——确认后唯一写入通道） */
  storage: Pick<StorageClient, 'invoke'>;
  /** dagre 布局注入位（归 C-01；缺省=线性占位坐标） */
  layout?: PlanLayoutFn;
  /** 落边注入位（见模块头 ⚠ 会签留痕；未注入=仅落盘不落边——T5-11 接线补） */
  landEdges?: (edges: FlowEdge[]) => void;
  /** C-05 get 注入位（✨ scriptMeta 取注册定义 N4 exec；缺省=DAO 同款兜底） */
  getDefinition?: DefinitionLookup;
}

export interface FlowMaterializer {
  /** §3 组件级接口：确认后编排（confirmPlan 的写入半段） */
  materialize(plan: PlanCard): Promise<MaterializeResult>;
}

/** 缺省线性占位坐标（demo L2286 col/row 实现示例形——正式布局=注入 C-01 dagre） */
function fallbackPositions(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: 40 + i * 250, y: 200 }));
}

const newEdgeId = (): string => `e-${crypto.randomUUID()}`;

export function createFlowMaterializer(deps: FlowMaterializerDeps): FlowMaterializer {
  return {
    materialize: async (plan) => {
      // ⓪ 空计划防御（FlowPlanner 侧 PLAN-DRAFT 已拦——此处确认前兜底）
      if (plan.steps.length === 0) {
        return { ok: false, code: 'PLAN-EMPTY', message: '计划内无步骤——请重新规划' };
      }

      // ① 脏闸前置（01 A-10.3：dirty 时拒绝提示，不覆盖未保存改动——demo L2285）
      if (!deps.canvas.guardDirty('workshop:materialize')) {
        return { ok: false, code: 'DIRTY', message: '有未保存改动 — 先保存或取消再生成' };
      }

      // ② edges 解析：显式分支路由优先、缺省线性串联（resolvePlanEdges 单一来源）
      const planEdges = resolvePlanEdges(plan);

      // ③ 新流程 id（C-06 flows.create——flows.save 必带 id；确认后通道，先于画布变更失败即返）
      const { id: flowId } = await deps.storage.invoke('flows.create', { name: plan.flowName });

      // ④ 布局坐标：注入 layout（C-01 dagre）按拓扑分层；缺省线性占位
      const synthNodes = plan.steps.map((_, i) => ({ id: `s${i}` }));
      const synthEdges = planEdges.map(([fi, , ti]) => ({ source: `s${fi}`, target: `s${ti}` }));
      const positioned =
        deps.layout !== undefined
          ? new Map(deps.layout(synthNodes, synthEdges).map((p) => [p.id, p.position]))
          : new Map(fallbackPositions(plan.steps.length).map((_, i) => [`s${i}`, _] as const));
      const positions = plan.steps.map((_, i) => positioned.get(`s${i}`) ?? { x: 0, y: 0 });

      // ⑤ 落图：dropNodes 整批（单历史项；name 透传=画布节点名与落盘 FlowNode 同源）＋
      //    landEdges 落边（⚠ 会签留痕位）＋markDirty
      const nodeIds = deps.canvas.dropNodes(
        plan.steps.map((s, i) => ({
          type: s.type,
          name: s.name,
          params: s.params ?? {},
          ...(positions[i] ?? { x: 0, y: 0 }),
        })),
      );
      const edges: FlowEdge[] = planEdges.map(([fi, exitId, ti, portId]) => ({
        id: newEdgeId(),
        from: [nodeIds[fi]!, exitId] as const,
        to: [nodeIds[ti]!, portId] as const,
      }));
      deps.landEdges?.(edges);
      deps.canvas.markDirty();

      // ⑥ ✨步骤顺路入库（「开发即沉淀」——demo L2466 语义；同名同型 upsert 保留既有行 id）
      const newSteps = plan.steps.filter((s) => s.src === 'new');
      for (const s of newSteps) {
        const exec = deps.getDefinition?.(s.type)?.exec;
        const entry: LibraryEntry = {
          id: `lib-${s.type}`,
          name: s.name,
          type: s.type,
          params: s.params ?? {},
          scriptMeta: exec !== undefined && exec !== null ? { lang: exec.lang, file: exec.file } : { lang: 'ts', file: '' },
          updatedAt: Date.now(),
        };
        await deps.storage.invoke('library.upsert', { entry });
      }

      // ⑦ 立即落盘打「流程工坊生成」版本（02 §7.1 label 枚举；nodes/edges=落图同一份口径）
      const nodes: FlowNode[] = plan.steps.map((s, i) => ({
        id: nodeIds[i]!,
        type: s.type,
        name: s.name,
        position: positions[i]!,
        params: s.params ?? {},
      }));
      const { versionId } = await deps.storage.invoke('flows.save', {
        id: flowId,
        name: plan.flowName,
        nodes,
        edges,
        label: WORKSHOP_FLOW_LABEL,
      });

      return {
        ok: true,
        flowId,
        versionId,
        nodeIds,
        newStepTypes: newSteps.map((s) => s.type),
      };
    },
  };
}
