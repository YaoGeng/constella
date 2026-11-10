// IntentRouter 组件套件（T5-02；TDD-C-07 §3 IntentRouter 行＋§1 六环节 1 段；02 §9.2 表逐行权威）。
// 断言面（§6.1 意图路由）：
//   五意图各一例命中正确分支（优化选中/解释/zip 问答/开发节点/整条流程——02 §9.2 表逐行）；
//   「优化」无选中→反问（保留 demo L2395-2396 行为——启发式命中即先反问、零 LLM 调用；
//   LLM 判为优化而空选中同样反问）；LLM 失败/离线→关键词启发式兜底（guessType 同款路径，
//   02 §9.2 末行——code∈LLM-CONFIG/LLM-HTTP/LLM-TIMEOUT/LLM-PROTOCOL/LLM-JSON 均触发；
//   LLM-ABORT/非网关错误不吞）；整条流程→转交流程工坊（switchRail＋需求预填＋自动出计划，
//   01 A-10.2）。
// LLM 面＝§8③ 注入 fake SSE transport 走真 LlmGateway 解析层（T5-01 同款）；兜底码矩阵与
// 终止面用 fake 网关对象直注（网关内部行为归 T5-01 套件）。
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createLlmGateway,
  LlmGatewayError,
  type LlmErrorCode,
  type LlmGateway,
  type LlmTransport,
  type LlmTransportRequest,
} from './llm-gateway';
import { createIntentRouter, guessIntent, type IntentRouterDeps } from './intent-router';
import { handoffToFlowWorkshop, useWorkshopStore, type RailTab } from './workshop-store';
import type { FlowPlanner, PlanCard } from './flow-planner';

// ————————————————————————————————————————————
// fixture（T5-01 同款 fake SSE transport——真网关解析层）
// ————————————————————————————————————————————

const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (text: string): string => sse({ choices: [{ delta: { content: text } }] });
const DONE = 'data: [DONE]\n\n';

/** 真 LlmGateway＋fake SSE transport（apiKeyRef='' 免鉴权端点——零 secret 依赖） */
function realGateway(chunks: string[], sends: LlmTransportRequest[]): LlmGateway {
  const transport: LlmTransport = {
    send: async (req) => {
      sends.push(req);
      return {
        chunks: async function* () {
          for (const c of chunks) yield c;
        },
      };
    },
  };
  return createLlmGateway({
    profileProvider: () => ({ baseUrl: 'https://llm.example.test/v1', apiKeyRef: '', model: 'glm-5' }),
    secrets: { get: async () => ({ value: null }) },
    transport,
  });
}

/** fake 网关（chatJson 定点失败/成功——路由器对网关的错误码判定面） */
function fakeGateway(chatJsonImpl: () => Promise<unknown>): LlmGateway {
  return {
    chatJson: async <T>() => (await chatJsonImpl()) as T,
    chatStream: async () => {
      throw new Error('unused in intent specs');
    },
  };
}

function router(llm: LlmGateway): ReturnType<typeof createIntentRouter> {
  return createIntentRouter({ llm } satisfies IntentRouterDeps);
}

// ————————————————————————————————————————————
// §6.1 五意图各一例（02 §9.2 表逐行；LLM 结构化输出路径）
// ————————————————————————————————————————————

describe('intent-五意图分类（TDD-C-07 §6.1——02 §9.2 表逐行；fake SSE transport 经真网关）', () => {
  it('intent-optimize 优化选中节点：「优化…」+ 有选中 → classified optimize（LLM 置信度透传）', async () => {
    const sends: LlmTransportRequest[] = [];
    const r = router(realGateway([delta('{"intent":"optimize","confidence":0.92}'), DONE], sends));
    const out = await r.route('优化当前节点', { selectedNodeId: 'n1' });
    expect(out).toEqual({ type: 'classified', kind: 'optimize', confidence: 0.92, source: 'llm' });
    expect(sends.length).toBe(1);
  });

  it('intent-explain 解释节点/概念：「解释/是什么…」→ classified explain', async () => {
    const r = router(realGateway([delta('{"intent":"explain","confidence":0.87}'), DONE], []));
    await expect(r.route('解释一下条件分支是什么')).resolves.toEqual({
      type: 'classified',
      kind: 'explain',
      confidence: 0.87,
      source: 'llm',
    });
  });

  it('intent-zip zip 问答：LLM 返回大写键名（N6）仍命中——canonicalKeys 白名单生效', async () => {
    const r = router(realGateway([delta('{"Intent":"zip","Confidence":0.88}'), DONE], []));
    // 白名单（['intent','confidence']）未传则 Intent/Confidence 不折叠——路由器必传（任务卡锚）
    await expect(r.route('导入的 zip 资产包怎么用')).resolves.toEqual({
      type: 'classified',
      kind: 'zip',
      confidence: 0.88,
      source: 'llm',
    });
  });

  it('intent-develop 开发节点：「开发/做一个…节点」→ classified develop', async () => {
    const r = router(realGateway([delta('{"intent":"develop","confidence":0.95}'), DONE], []));
    await expect(r.route('开发一个抓取库存的节点')).resolves.toEqual({
      type: 'classified',
      kind: 'develop',
      confidence: 0.95,
      source: 'llm',
    });
  });

  it('intent-flow 整条流程：「流程/自动化…」→ classified flow（转交流程工坊入口）', async () => {
    const r = router(realGateway([delta('{"intent":"flow","confidence":0.9}'), DONE], []));
    await expect(r.route('帮我搭一个自动回复值守的流程')).resolves.toEqual({
      type: 'classified',
      kind: 'flow',
      confidence: 0.9,
      source: 'llm',
    });
  });

  it('intent-请求面：system prompt 载五意图枚举、user 载原句、model 走 profile', async () => {
    const sends: LlmTransportRequest[] = [];
    const r = router(realGateway([delta('{"intent":"explain","confidence":1}'), DONE], sends));
    await r.route('节点是什么');
    const body = JSON.parse(sends[0]!.body) as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('glm-5');
    expect(body.messages.some((m) => m.content.includes('优化'))).toBe(true); // 五意图枚举进 prompt
    expect(body.messages.some((m) => m.content === '节点是什么')).toBe(true); // 原句进 user
  });
});

// ————————————————————————————————————————————
// §6.1 「优化」空选中反问（02 §9.2 末行——保留 demo 行为）
// ————————————————————————————————————————————

describe('intent-「优化」空选中反问（02 §9.2——先反问，保留 demo L2395-2396 行为）', () => {
  it('intent-启发式命中优化且空选中 → 反问且零 LLM 调用（不调 LLM 先反问——锚定）', async () => {
    const sends: LlmTransportRequest[] = [];
    // fake transport 对未编排 send 会响亮报错——本例零脚本＝零调用断言面
    const transport: LlmTransport = {
      send: async (req) => {
        sends.push(req);
        throw new Error('unexpected send: 启发式预检应零 LLM 调用');
      },
    };
    const llm = createLlmGateway({
      profileProvider: () => ({ baseUrl: 'https://llm.example.test/v1', apiKeyRef: '', model: 'glm-5' }),
      secrets: { get: async () => ({ value: null }) },
      transport,
    });
    const out = await router(llm).route('优化一下这个节点');
    expect(out.type).toBe('reask');
    if (out.type === 'reask') {
      expect(out.kind).toBe('optimize');
      expect(out.question).toContain('点选'); // demo 反问文案语义
    }
    expect(sends).toEqual([]);
  });

  it('intent-LLM 判为 optimize 而空选中 → 反问（LLM 路径防御；有选中则不反问——见五意图例）', async () => {
    // 消息刻意避开优化关键词（启发式不命中）——走 LLM 判定为 optimize 后的防御反问
    const r = router(realGateway([delta('{"intent":"optimize","confidence":0.9}'), DONE], []));
    const out = await r.route('帮我把这个节点弄得更稳一点');
    expect(out.type).toBe('reask');
  });

  it('intent-启发式兜底判 optimize 且空选中 → 同样反问（兜底链与反问正交）', async () => {
    const llm = fakeGateway(async () => {
      throw new LlmGatewayError('LLM-HTTP', '端点不可达');
    });
    const out = await router(llm).route('改进一下健壮性');
    expect(out.type).toBe('reask');
  });
});

// ————————————————————————————————————————————
// §6.1 兜底链：LLM 失败/离线 → 关键词启发式（guessType 同款路径，02 §9.2 末行）
// ————————————————————————————————————————————

describe('intent-兜底链（LLM 失败/离线→关键词启发式——02 §9.2 末行）', () => {
  it.each(['LLM-CONFIG', 'LLM-HTTP', 'LLM-TIMEOUT', 'LLM-PROTOCOL', 'LLM-JSON'] as const)(
    'intent-兜底触发：%s → 启发式命中（source=heuristic）',
    async (code) => {
      const llm = fakeGateway(async () => {
        throw new LlmGatewayError(code, 'fake failure');
      });
      const out = await router(llm).route('优化当前节点', { selectedNodeId: 'n1' });
      expect(out).toEqual({ type: 'classified', kind: 'optimize', confidence: 0.5, source: 'heuristic' });
    },
  );

  it('intent-真网关 LLM-JSON（散文输出无法收敛）→ 启发式兜底命中 develop', async () => {
    const r = router(realGateway([delta('抱歉，我不明白你的意思。'), DONE], []));
    const out = await r.route('开发一个私信发送节点');
    expect(out).toEqual({ type: 'classified', kind: 'develop', confidence: 0.5, source: 'heuristic' });
  });

  it('intent-真网关 LLM-CONFIG（未配置 AI——离线态）→ 启发式兜底命中 zip', async () => {
    // 无 profileProvider 且无 storage → prepare 即 LLM-CONFIG（T5-01 §6.6 同款面）
    const llm = createLlmGateway({ secrets: { get: async () => ({ value: null }) } });
    const out = await router(llm).route('怎么打包分享节点');
    expect(out.type).toBe('classified');
    if (out.type === 'classified') {
      expect(out.kind).toBe('zip');
      expect(out.source).toBe('heuristic');
    }
  });

  it('intent-LLM 返回未知意图字面量 → 视为分类失败走启发式', async () => {
    const r = router(realGateway([delta('{"intent":"chitchat","confidence":0.99}'), DONE], []));
    // 注：demo 关键词序解释先于 zip（保留）——消息避开「怎么用」等解释关键词
    const out = await r.route('zip 资产包能导入吗');
    expect(out).toEqual({ type: 'classified', kind: 'zip', confidence: 0.5, source: 'heuristic' });
  });

  it('intent-LLM-ABORT 不吞：调用方终止面向上抛（不落入兜底链）', async () => {
    const llm = fakeGateway(async () => {
      throw new LlmGatewayError('LLM-ABORT', '调用方已终止');
    });
    await expect(router(llm).route('解释一下')).rejects.toMatchObject({ code: 'LLM-ABORT' });
  });

  it('intent-非 LlmGatewayError 异常不吞（编程错误面）', async () => {
    const llm = fakeGateway(async () => {
      throw new Error('unexpected bug');
    });
    await expect(router(llm).route('解释一下')).rejects.toThrow('unexpected bug');
  });

  it('intent-置信度缺省/越界收敛为 0.5（LLM 路径防御）', async () => {
    const r = router(realGateway([delta('{"intent":"explain","confidence":"高"}'), DONE], []));
    const out = await r.route('节点是什么');
    expect(out).toEqual({ type: 'classified', kind: 'explain', confidence: 0.5, source: 'llm' });
  });
});

// ————————————————————————————————————————————
// 启发式关键词梯（guessType 同款路径——demo aiRespond L2393-2449 关键词序）
// ————————————————————————————————————————————

describe('intent-启发式关键词梯（guessType 同款路径——demo L2393-2449 关键词序，02 §9.2 触发条件列）', () => {
  it('intent-优化：「优化/改进/重构/健壮」', () => {
    expect(guessIntent('改进一下这个节点的健壮性').kind).toBe('optimize');
  });

  it('intent-人工确认类问题归解释（demo 独立分支并入 explain——02 §9.2 无第六意图）', () => {
    expect(guessIntent('人工确认节点是怎么用的').kind).toBe('explain');
  });

  it('intent-解释：「解释/是什么/怎么用/说明/帮助」', () => {
    expect(guessIntent('条件分支是什么').kind).toBe('explain');
  });

  it('intent-zip 问答：「导入/导出/打包/分享/zip」', () => {
    expect(guessIntent('怎么导出节点包').kind).toBe('zip');
  });

  it('intent-整条流程：名词（流程/工作流/自动化）+动词（做/搭/生成…）双条件', () => {
    expect(guessIntent('帮我搭一个价格监控流程').kind).toBe('flow');
  });

  it('intent-仅名词无动词不判 flow（落入默认纯对话面）', () => {
    expect(guessIntent('什么是流程').kind).toBe('explain');
  });

  it('intent-开发节点：「开发/做一个/写一个/抓/监控…」', () => {
    expect(guessIntent('写一个抓取笔记的节点').kind).toBe('develop');
  });

  it('intent-默认兜底归纯对话（explain——demo L2449 通用回复语义）', () => {
    expect(guessIntent('你好').kind).toBe('explain');
  });
});

// ————————————————————————————————————————————
// §6.1 末项：整条流程 → 转交流程工坊（01 A-10.2：switchRail＋需求预填＋自动出计划）
// ————————————————————————————————————————————

describe('intent-flow 转交流程工坊（TDD-C-07 §6.1 末项——01 A-10.2）', () => {
  beforeEach(() => {
    useWorkshopStore.getState().reset();
  });

  const card: PlanCard = {
    id: 'plan-1',
    flowName: '自动回复值守',
    steps: [{ src: 'lib', type: 'trigger.manual', name: '手动触发', params: {} }],
  };

  it('intent-flow 转交：注入 switchRail 回调（flow）＋store 预填需求＋自动出计划（计划卡挂对话流）＋rail 规划中→待命', async () => {
    const switched: RailTab[] = [];
    const calls: string[] = [];
    const planner: FlowPlanner = {
      plan: async (req) => {
        calls.push(req);
        return card;
      },
    };

    const got = await handoffToFlowWorkshop('帮我搭一个自动回复值守的流程', {
      planner,
      switchRail: (tab) => switched.push(tab),
    });

    expect(got).toBe(card);
    expect(calls).toEqual(['帮我搭一个自动回复值守的流程']); // 自动出计划（原句带入）
    expect(switched).toEqual(['flow']); // 注入 switchRail 回调（回调注入不 import C-01）
    const s = useWorkshopStore.getState();
    expect(s.rail.tab).toBe('flow'); // rail 切 tab
    expect(s.flowRequest).toBe('帮我搭一个自动回复值守的流程'); // 需求预填
    expect(s.rail.activity).toBe('idle'); // 规划中→待命
    const planMsg = s.messages.find((m) => m.card?.kind === 'plan');
    expect(planMsg?.card).toEqual({ kind: 'plan', plan: card }); // 计划卡挂对话流（停确认）
  });

  it('intent-flow 转交规划失败：rail 状态字回待命、错误上抛（不留挂起态）', async () => {
    const planner: FlowPlanner = {
      plan: async () => {
        throw new Error('LLM-CONFIG: 未配置 AI');
      },
    };
    await expect(
      handoffToFlowWorkshop('搭一个流程', { planner, switchRail: () => {} }),
    ).rejects.toThrow('LLM-CONFIG');
    const s = useWorkshopStore.getState();
    expect(s.rail.activity).toBe('idle');
    expect(s.rail.tab).toBe('flow'); // 已切换不回卷（预填保留供重试）
    expect(s.messages.some((m) => m.card?.kind === 'plan')).toBe(false); // 零计划卡
  });
});
