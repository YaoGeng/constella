// IntentRouter —— 节点工坊意图识别（T5-02；TDD-C-07 §3 IntentRouter 行＋§1 六环节 1 段；02 §9.2 权威）。
//   五意图分类（02 §9.2 表逐行）：optimize=优化选中节点〔差异卡〕/explain=解释节点·概念〔流式
//   文本〕/zip=zip 问答〔ZipPipeline 说明〕/develop=开发节点〔NodeDevAgent 草稿卡〕/flow=整条
//   流程〔→转交流程工坊——switchRail＋需求预填＋自动出计划，01 A-10.2〕。
//   「优化」空选中先反问（保留 demo L2395-2396 行为——启发式命中即反问、零 LLM 调用；LLM 判为
//   优化而空选中同样反问）。
//   兜底链（02 §9.2 末行）＝LLM 分类失败/离线→关键词启发式（guessType 同款路径——demo
//   aiRespond L2393-2449 关键词梯）：LlmGatewayError 且 code≠LLM-ABORT 均触发（CONFIG/HTTP/
//   TIMEOUT/PROTOCOL/JSON/SECRET——终止面与编程错误面不吞、原样上抛）。
//   LLM 面＝chatJson＋canonicalKeys 白名单（T5-01 网关；N6 三端键名差异由适配层抹平）。
import { LlmGatewayError, type LlmChatRequest, type LlmGateway } from './llm-gateway';

/** 五意图枚举（02 §9.2 表逐行——权威；枚举名即判定语义，不扩第六意图） */
export type IntentKind = 'optimize' | 'explain' | 'zip' | 'develop' | 'flow';

/** 判定路径：LLM 结构化输出 / 关键词启发式兜底 */
export type IntentSource = 'llm' | 'heuristic';

/** 意图分类（kind＋置信度＋判定路径） */
export interface IntentClassification {
  kind: IntentKind;
  /** 0~1（LLM=模型置信度收敛；启发式命中=0.5、默认=0.3） */
  confidence: number;
  source: IntentSource;
}

/** route() 结果（C-07 §3 组件级接口 `route(msg,ctx): Intent`）：五意图命中 / 「优化」空选中反问 */
export type Intent =
  | ({ type: 'classified' } & IntentClassification)
  | { type: 'reask'; kind: 'optimize'; question: string };

export interface RouteContext {
  /** 画布选中节点 id（「优化」意图空选中→反问——02 §9.2；注入位，不 import C-01/canvas） */
  selectedNodeId?: string;
}

export interface IntentRouterDeps {
  llm: LlmGateway;
  /** 请求携带模型（V1.0 settings 单配置无 model 键——经 profileProvider 或此处入口，T5-01 同口径） */
  model?: string;
}

export interface IntentRouter {
  route(msg: string, ctx?: RouteContext): Promise<Intent>;
}

const INTENT_KINDS: readonly IntentKind[] = ['optimize', 'explain', 'zip', 'develop', 'flow'];

const INTENT_SYSTEM_PROMPT = [
  '你是星丛节点工坊的意图分类器。把用户消息分类为以下五种意图之一：',
  '- optimize：优化/改进/重构选中的节点（追加 N6 policy 重试/超时等）',
  '- explain：解释节点/概念/用法（含「人工确认」类问题）',
  '- zip：zip 资产包导入/导出/打包/分享相关问答',
  '- develop：开发单个新节点（口语定型 → 草稿卡）',
  '- flow：整条流程/工作流/自动化需求（转交流程工坊）',
  '仅输出 JSON：{"intent":"optimize|explain|zip|develop|flow","confidence":0到1的数值}',
].join('\n');

/** 反问文案（demo L2396 语义保留） */
const REASK_NO_SELECTION = '先在画布上点选一个节点，我再帮你优化它。';

/** 启发式关键词梯（demo aiRespond L2393-2449 关键词序保留：优化→人工确认/解释→zip→整条流程→
 *  开发；guessType 同款路径——02 §9.2 兜底链「demo 关键词启发式」） */
const HEURISTIC_RULES: readonly { test: (q: string) => boolean; kind: IntentKind }[] = [
  { test: (q) => /优化|改进|重构|健壮/.test(q), kind: 'optimize' },
  // demo 人工确认独立分支（L2411）与解释分支（L2416）在本模型同归 explain——02 §9.2 无第六意图
  {
    test: (q) => /人工确认|交互节点|确认节点|human|解释|是什么|怎么用|说明|帮助|怎么玩|能做什么/.test(q),
    kind: 'explain',
  },
  { test: (q) => /导入|导出|zip|打包|分享/.test(q), kind: 'zip' },
  // 整条流程=名词（流程/工作流/自动化）+动词（做/搭/生成…）双条件（demo L2425 原样）
  { test: (q) => /流程|工作流|自动化/.test(q) && /做|搭|生成|创建|帮|来|搞/.test(q), kind: 'flow' },
  { test: (q) => /开发|创建|新建|生成|做一个|写一个|加一个|来一个|抓|监控|爬/.test(q), kind: 'develop' },
];

/** 关键词启发式（guessType 同款路径——兜底链；默认归纯对话面〔explain——demo L2449 通用回复语义〕） */
export function guessIntent(msg: string): IntentClassification {
  for (const rule of HEURISTIC_RULES) {
    if (rule.test(msg)) return { kind: rule.kind, confidence: 0.5, source: 'heuristic' };
  }
  return { kind: 'explain', confidence: 0.3, source: 'heuristic' };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** LLM 结构化输出收敛：intent 须为五枚举之一、confidence 收敛 0~1（非法＝分类失败→undefined） */
function toClassification(raw: unknown): IntentClassification | undefined {
  if (!isRecord(raw)) return undefined;
  const { intent, confidence } = raw;
  if (typeof intent !== 'string' || !(INTENT_KINDS as readonly string[]).includes(intent)) return undefined;
  const c = Number(confidence);
  return {
    kind: intent as IntentKind,
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
    source: 'llm',
  };
}

export function createIntentRouter(deps: IntentRouterDeps): IntentRouter {
  /** 「优化」空选中→反问（02 §9.2 末行——分类结果的统一守卫，LLM 与兜底路径共用） */
  const guardSelection = (c: IntentClassification, selected: string | undefined): Intent =>
    c.kind === 'optimize' && selected === undefined
      ? { type: 'reask', kind: 'optimize', question: REASK_NO_SELECTION }
      : { type: 'classified', ...c };

  return {
    route: async (msg, ctx) => {
      const selected = ctx?.selectedNodeId;
      // ① 先反问（锚定：启发式命中「优化」且空选中——零 LLM 调用，保留 demo 行为）
      if (selected === undefined && guessIntent(msg).kind === 'optimize') {
        return { type: 'reask', kind: 'optimize', question: REASK_NO_SELECTION };
      }
      // ② LLM 结构化分类（canonicalKeys 白名单必传——N6 键名收敛仅按白名单折叠，T5-01）
      let raw: unknown;
      try {
        const req: LlmChatRequest = {
          model: deps.model,
          messages: [
            { role: 'system', content: INTENT_SYSTEM_PROMPT },
            { role: 'user', content: msg },
          ],
        };
        raw = await deps.llm.chatJson<Record<string, unknown>>(req, {
          canonicalKeys: ['intent', 'confidence'],
        });
      } catch (err) {
        // 兜底链（02 §9.2 末行）：网关错误（含离线/未配置/输出不可收敛）→关键词启发式；
        // LLM-ABORT＝调用方终止面、非网关异常＝编程错误面——均原样上抛不吞
        if (err instanceof LlmGatewayError && err.code !== 'LLM-ABORT') {
          return guardSelection(guessIntent(msg), selected);
        }
        throw err;
      }
      const classified = toClassification(raw);
      if (classified === undefined) {
        return guardSelection(guessIntent(msg), selected); // 未知意图字面量＝分类失败→兜底
      }
      return guardSelection(classified, selected);
    },
  };
}
