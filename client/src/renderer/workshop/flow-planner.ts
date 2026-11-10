// FlowPlanner —— 流程工坊规划（T5-02；TDD-C-07 §3 FlowPlanner 行＋§1 六环节 2 段；02 §9.1 权威）。
//   规划=B-6 真实 LLM（demo FLOW_TEMPLATES/WORKSHOP_PLANS 模板拼接废弃——02 §9.1）：一句话 →
//   chatJson 草稿（{flowName,steps,edges}＋顶层 canonicalKeys）→ 三来源降级 → 计划卡。
//   三来源降级（02 §9.1）：逐步骤按类型查 📚lib（library_entries——注入 libLister）→ 🏬plaza
//   （在线时——注入查询位 plazaQuery，P-3 无 C-09 import 边、T5-11 接线复跑）→ 都无 ✨new 现场
//   开发；auto=先查库、有即 📚（demo L2260-2264 src 语义正式化——降级梯对逐步骤统一生效）。
//   离线判定输入＝TransportFailureKind 同构枚举（T5-09 market-error.ts 形——注入位抛错带
//   kind∈{network,timeout} 字段即判，鸭子型、不 import market/）；离线只查 📚，本轮 plan 内
//   生效（会话级离线态归 T5-11 OfflineDegradation）。plazaQuery 未注入=同离线缺省（仅查 📚）。
//   计划卡模型（C-07 §4 PlanCard 形；demo L2269-2281/L2298 同构）：步骤来源三标记 📚/🏬/✨＋
//   note＋参数预填；「📚＋存量增强」第四态由 note 承载（X-12——不扩三标记枚举）；参数预填=
//   库/广场模板打底、草稿参数覆盖。
//   LLM 失败上抛（02 §9.2 兜底链限意图面——规划无锚定兜底，调用方走「重新规划」）；草稿结构
//   不可用→PLAN-DRAFT 响亮报错。
import type { LibraryEntry } from '@constella/shared/ipc';
import type { LlmChatRequest, LlmGateway } from './llm-gateway';

/** 步骤来源三标记（03 §4 PlanCard 形——📚lib/🏬plaza/✨new 冻结枚举不扩展，X-12） */
export type PlanStepSource = 'lib' | 'plaza' | 'new';

/** 计划卡步骤（03 §4：{src,type,name,params,note}——note 承载第四态「📚＋存量增强」说明） */
export interface PlanStep {
  src: PlanStepSource;
  type: string;
  name: string;
  params: Record<string, unknown>;
  note?: string;
}

/** 计划卡（03 §4 PlanCard 形；demo L2269-2281/L2298 同构） */
export interface PlanCard {
  id: string;
  flowName: string;
  steps: PlanStep[];
  /** [i,exitId,j,portId] 显式分支路由——缺省线性串联归落图（T5-04 FlowMaterializer，demo L2298） */
  edges?: [number, string, number, string][];
}

/** T5-09 TransportFailureKind 同构枚举（market-error.ts 形——P-3 不 import market/） */
export type PlazaTransportFailureKind = 'network' | 'timeout';

/** 🏬 广场命中最小消费面（T5-11 接线时映射 MarketListItem） */
export interface PlazaNodeHit {
  type: string;
  name?: string;
  params?: Record<string, unknown>;
}

/** 🏬 注入查询位（P-3——无 C-09 import 边；缺省=不可用〔同离线，仅查 📚〕；T5-11 接线复跑） */
export type PlazaQuery = (type: string) => Promise<readonly PlazaNodeHit[]>;

/** 📚 查询位（C-06 library.list 的注入包装——装配点绑 storageClient；缺省=恒未命中） */
export type LibLister = () => Promise<readonly LibraryEntry[]>;

/** LLM 草稿步骤 src（demo src 语义：lib/plaza/new/auto——auto=先查库、有即 📚，缺省 auto） */
export type DraftStepSource = 'lib' | 'plaza' | 'new' | 'auto';

export interface PlanDraftStep {
  src?: DraftStepSource;
  type: string;
  name?: string;
  params?: Record<string, unknown>;
  note?: string;
}

export interface PlanDraft {
  flowName: string;
  steps: PlanDraftStep[];
  edges?: [number, string, number, string][];
}

export type FlowPlannerErrorCode = 'PLAN-DRAFT';

/** 草稿结构不可用（步骤缺 type/edges 非四元组等）——上计划卡供「重新规划」，不静默出坏卡 */
export class FlowPlannerError extends Error {
  readonly code: FlowPlannerErrorCode;
  constructor(message: string) {
    super(message);
    this.name = 'FlowPlannerError';
    this.code = 'PLAN-DRAFT';
  }
}

export interface FlowPlannerDeps {
  llm: LlmGateway;
  /** 请求携带模型（V1.0 settings 单配置无 model 键——经 profileProvider 或此处入口） */
  model?: string;
  /** 📚 查询位（C-06 library.list 注入包装） */
  libLister?: LibLister;
  /** 🏬 注入查询位（T5-11 接线复跑） */
  plazaQuery?: PlazaQuery;
  /** 规划选型目录（C-05 list 注入位——P-3；提示词附可用类型菜单，优先复用存量类型） */
  catalog?: () => readonly string[];
}

export interface FlowPlanner {
  /** C-07 §3 组件级接口：一句话→计划卡（LLM 草稿＋三来源降级＋参数预填） */
  plan(req: string): Promise<PlanCard>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const DRAFT_STEP_SOURCES: readonly DraftStepSource[] = ['lib', 'plaza', 'new', 'auto'];

/** 缺省流程名（demo L2254 同款） */
const DEFAULT_FLOW_NAME = '我的自动化流程';

const planSystemPrompt = (catalog?: () => readonly string[]): string => {
  const lines = [
    '你是星丛流程工坊的规划器。根据业务需求规划节点步骤序列（B-6；三来源：📚lib 本地库 / 🏬plaza 广场 / ✨new 现场开发）。',
    '步骤 src 一律用 "auto"（系统逐步骤按类型降级选源——先查库、有即 📚）；存量增强类步骤在 note 说明。',
  ];
  if (catalog !== undefined) {
    const types = catalog();
    if (types.length > 0) lines.push(`可用节点类型菜单（优先复用）：${types.join('、')}`);
  }
  lines.push(
    '仅输出 JSON：{"flowName":"流程名","steps":[{"src":"auto","type":"节点类型","name":"步骤名","params":{},"note":"说明"}],"edges":[[0,"out",1,"in"]]}（edges 可省——缺省线性串联）',
  );
  return lines.join('\n');
};

export function createFlowPlanner(deps: FlowPlannerDeps): FlowPlanner {
  const fold = (s: string): string => s.toLowerCase().replace(/[_-]/g, '');

  /** 步级键名防御折叠（网关 canonicalKeys 只作用顶层——步内 TYPE/Src 等差异在此抹平，N6） */
  const pick = (rec: Record<string, unknown>, key: string): unknown => {
    if (key in rec) return rec[key];
    const want = fold(key);
    for (const k of Object.keys(rec)) {
      if (fold(k) === want) return rec[k];
    }
    return undefined;
  };

  const toEdges = (raw: unknown): [number, string, number, string][] => {
    if (!Array.isArray(raw)) throw new FlowPlannerError('草稿 edges 非法（非数组）');
    const out: [number, string, number, string][] = [];
    for (const e of raw) {
      if (!Array.isArray(e) || e.length !== 4) {
        throw new FlowPlannerError('草稿 edges 非法（须四元组 [i,exitId,j,portId]）');
      }
      const [i, exitId, j, portId] = e as [unknown, unknown, unknown, unknown];
      if (typeof i !== 'number' || typeof exitId !== 'string' || typeof j !== 'number' || typeof portId !== 'string') {
        throw new FlowPlannerError('草稿 edges 非法（元素形 [number,string,number,string]）');
      }
      out.push([i, exitId, j, portId]);
    }
    return out;
  };

  const toDraftStep = (raw: unknown): PlanDraftStep => {
    if (!isRecord(raw)) throw new FlowPlannerError('草稿步骤非法（非对象）');
    const type = pick(raw, 'type');
    if (typeof type !== 'string' || type === '') throw new FlowPlannerError('草稿步骤缺 type');
    const src = pick(raw, 'src');
    const name = pick(raw, 'name');
    const params = pick(raw, 'params');
    const note = pick(raw, 'note');
    return {
      type,
      ...(typeof src === 'string' && (DRAFT_STEP_SOURCES as readonly string[]).includes(src)
        ? { src: src as DraftStepSource }
        : {}), // 缺省 auto（02 §9.1）
      ...(typeof name === 'string' && name !== '' ? { name } : {}),
      ...(isRecord(params) ? { params: params as Record<string, unknown> } : {}),
      ...(typeof note === 'string' && note !== '' ? { note } : {}),
    };
  };

  const toDraft = (raw: unknown): PlanDraft => {
    if (!isRecord(raw)) throw new FlowPlannerError('LLM 草稿非法（非对象）');
    const steps = pick(raw, 'steps');
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new FlowPlannerError('LLM 草稿缺步骤（steps 为空）');
    }
    const flowName = pick(raw, 'flowName');
    const edges = pick(raw, 'edges');
    return {
      flowName: typeof flowName === 'string' && flowName !== '' ? flowName : DEFAULT_FLOW_NAME,
      steps: steps.map(toDraftStep),
      ...(Array.isArray(edges) ? { edges: toEdges(edges) } : {}),
    };
  };

  /** 离线判定输入（TransportFailureKind 同构——注入位抛错带 kind 字段即判，鸭子型无 import 边） */
  const isPlazaTransportFailure = (e: unknown): e is { kind: PlazaTransportFailureKind } =>
    typeof e === 'object' &&
    e !== null &&
    'kind' in e &&
    ((e as { kind: unknown }).kind === 'network' || (e as { kind: unknown }).kind === 'timeout');

  return {
    plan: async (req) => {
      // ① LLM 草稿（B-6 真实规划；错误上抛——02 §9.2 兜底链限意图面，规划走「重新规划」）
      const chatReq: LlmChatRequest = {
        model: deps.model,
        messages: [
          { role: 'system', content: planSystemPrompt(deps.catalog) },
          { role: 'user', content: req },
        ],
      };
      const draft = toDraft(
        await deps.llm.chatJson<Record<string, unknown>>(chatReq, {
          canonicalKeys: ['flowName', 'steps', 'edges'],
        }),
      );

      // ② 三来源降级（02 §9.1：逐步骤按类型查 📚→🏬〔在线〕→✨；离线只查 📚）
      const lib = new Map<string, LibraryEntry>();
      if (deps.libLister !== undefined) {
        for (const entry of await deps.libLister()) lib.set(entry.type, entry);
      }
      let plazaOffline = false; // 传输失败即判——本轮 plan 内生效（会话级离线态归 T5-11）
      const steps: PlanStep[] = [];
      for (const s of draft.steps) {
        const libHit = lib.get(s.type);
        if (libHit !== undefined) {
          // 📚 同型命中：参数预填=库模板打底、草稿参数覆盖（「参数模板」语义——demo L2466-2468）
          steps.push({
            src: 'lib',
            type: s.type,
            name: s.name ?? libHit.name,
            params: { ...libHit.params, ...s.params },
            ...(s.note !== undefined ? { note: s.note } : {}),
          });
          continue;
        }
        if (!plazaOffline && deps.plazaQuery !== undefined) {
          try {
            const hits = await deps.plazaQuery(s.type);
            const hit = hits[0];
            if (hit !== undefined) {
              steps.push({
                src: 'plaza',
                type: s.type,
                name: s.name ?? hit.name ?? s.type,
                params: { ...(hit.params ?? {}), ...s.params },
                ...(s.note !== undefined ? { note: s.note } : {}),
              });
              continue;
            }
          } catch (err) {
            if (isPlazaTransportFailure(err)) {
              plazaOffline = true; // 离线判定（network/timeout 同构枚举）——后续步骤只查 📚
            }
            // 其余错误＝该步广场未命中（不判离线、不中断规划）
          }
        }
        // ✨new 现场开发（NodeDevAgent 承接——T5-03；草稿参数直入计划卡）
        steps.push({
          src: 'new',
          type: s.type,
          name: s.name ?? s.type,
          params: s.params ?? {},
          ...(s.note !== undefined ? { note: s.note } : {}),
        });
      }

      return {
        id: newPlanCardId(),
        flowName: draft.flowName,
        steps,
        ...(draft.edges !== undefined ? { edges: draft.edges } : {}),
      };
    },
  };
}

/** 计划卡 id（内存 store 不持久化——id 仅会话内唯一即可） */
function newPlanCardId(): string {
  return `plan-${crypto.randomUUID()}`;
}
