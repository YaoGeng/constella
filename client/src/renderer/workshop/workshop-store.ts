// workshopStore —— 右栏双工坊会话态（T5-02；02 §3.3 workshopStore 行：对话流、计划卡草稿挂点、
// rail 状态字〔待命/思考中/规划中/并行 N 任务——01 A-10.1〕）。
//   内存 store 不持久化：无 persist 中间件、无 zundo temporal、不入历史栈——重启不还原
// （与 runStore 同为运行期态，02 §3.3 temporal 列=否）。
//   转交流程工坊（01 A-10.2：切 tab、带过去需求、自动出计划——demo L2425-2429 语义）＝
//   handoffToFlowWorkshop：switchRail（rail.tab 数据源＋注入回调——面板显隐归上层 UI，
//   回调注入不 import C-01）＋需求预填（flowRequest）＋自动出计划（planner.plan——计划卡
//   挂对话流停确认，确认前零写入）。dirty 闸（01 A-10.2「dirty 时先提示保存」）读画布域
//   状态，归上层编排（P-3 边界——本模块不 import C-01/canvas）。
import { create } from 'zustand';
import type { DiffCard } from './confirm-gate';
import type { FlowPlanner, PlanCard } from './flow-planner';

/** rail 状态字四态（01 A-10.1：待命/思考中/规划中/并行 N 任务；demo L2456/L2317/L1628） */
export type RailActivity = 'idle' | 'thinking' | 'planning' | 'parallel';

/** 右栏双工坊 tab（A-10.1 互斥显隐数据源；demo L2329 railTab） */
export type RailTab = 'node' | 'flow';

export interface RailState {
  tab: RailTab;
  activity: RailActivity;
  /** activity='parallel' 时的 N（「并行 N 任务」） */
  parallelCount: number;
}

/** 对话流卡片挂点（确认闸产物停卡片——A-10.2；草稿卡形随 T5-03 NodeDevAgent 定；
 *  差异卡形=T5-04 ConfirmGate DiffCard——「应用」经 CanvasSink.patchNode N6 字段化） */
export type WorkshopCard =
  | { kind: 'plan'; plan: PlanCard }
  | { kind: 'draft'; draft: unknown }
  | { kind: 'diff'; diff: DiffCard };

export interface WorkshopMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  card?: WorkshopCard;
}

export interface WorkshopStoreState {
  rail: RailState;
  messages: readonly WorkshopMessage[];
  /** 流程工坊需求预填（转交流程工坊带入需求语句——01 A-10.2） */
  flowRequest: string;
  pushMessage(role: 'user' | 'assistant', text: string, card?: WorkshopCard): WorkshopMessage;
  setRailActivity(activity: RailActivity, parallelCount?: number): void;
  switchRail(tab: RailTab): void;
  setFlowRequest(req: string): void;
  /** 测试隔离（内存态全清） */
  reset(): void;
}

let msgSeq = 0;

export const useWorkshopStore = create<WorkshopStoreState>((set, get) => ({
  rail: { tab: 'node', activity: 'idle', parallelCount: 0 },
  messages: [],
  flowRequest: '',

  pushMessage: (role, text, card) => {
    const msg: WorkshopMessage = {
      id: `wmsg-${Date.now().toString(36)}-${++msgSeq}`,
      role,
      text,
      ...(card !== undefined ? { card } : {}),
    };
    set({ messages: [...get().messages, msg] });
    return msg;
  },

  setRailActivity: (activity, parallelCount) => {
    set({
      rail: {
        ...get().rail,
        activity,
        // parallel 态带 N；其余态清零（未传则保留现值仅在 parallel 态有意义）
        parallelCount: parallelCount ?? (activity === 'parallel' ? get().rail.parallelCount : 0),
      },
    });
  },

  switchRail: (tab) => {
    set({ rail: { ...get().rail, tab } });
  },

  setFlowRequest: (req) => {
    set({ flowRequest: req });
  },

  reset: () => {
    set({ rail: { tab: 'node', activity: 'idle', parallelCount: 0 }, messages: [], flowRequest: '' });
  },
}));

/** 转交话术（demo L2427 文案语义保留——职责分工：节点工坊管单节点，流程工坊管整条编排） */
export const FLOW_HANDOFF_MESSAGE =
  '整条流程的编排归「流程工坊」管 — 我把你的需求带过去，它来配节点（库/广场/现场开发）、出计划卡。';

export interface FlowHandoffDeps {
  planner: FlowPlanner;
  /** switchRail 注入回调（rail 面板互斥显隐归上层 UI——回调注入不 import C-01） */
  switchRail?: (tab: RailTab) => void;
}

/** 转交流程工坊（01 A-10.2）：switchRail＋需求预填＋自动出计划（demo L2425-2429 语义） */
export async function handoffToFlowWorkshop(request: string, deps: FlowHandoffDeps): Promise<PlanCard> {
  const s = useWorkshopStore.getState();
  s.pushMessage('assistant', FLOW_HANDOFF_MESSAGE);
  s.switchRail('flow'); // rail.tab 数据源（A-10.1 互斥显隐）
  deps.switchRail?.('flow'); // 注入回调（P-3——不 import C-01）
  s.setFlowRequest(request); // 需求预填
  s.setRailActivity('planning'); // 「规划中…」（demo L2317）
  try {
    const plan = await deps.planner.plan(request); // 自动出计划（原句带入）
    const after = useWorkshopStore.getState();
    after.pushMessage('assistant', '计划已出——请确认后一键生成', { kind: 'plan', plan }); // 计划卡挂对话流（停确认——确认前零写入）
    after.setRailActivity('idle');
    return plan;
  } catch (err) {
    useWorkshopStore.getState().setRailActivity('idle'); // 不留挂起态（预填保留供重试）
    throw err;
  }
}
