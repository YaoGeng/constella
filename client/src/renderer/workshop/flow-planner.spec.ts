// FlowPlanner 组件套件（T5-02；TDD-C-07 §3 FlowPlanner 行＋§1 六环节 2 段；02 §9.1 权威）。
// 断言面（§6.2 三来源降级＋计划卡模型）：
//   逐步骤按类型查 📚lib→🏬plaza（在线；离线只查 📚）→✨new；auto=先查库、有即 📚；
//   lib 同型 📚（参数预填＝库模板∩草稿覆盖）；plaza 离线仅查 lib（注入位抛 kind=network/timeout
//   同构枚举即判离线，本轮 plan 不再查广场）；全无 ✨new；未注入 plazaQuery=同离线缺省；
//   广场非传输错误＝单步未命中、不判离线；计划卡模型＝id/flowName/steps〔src 三标记＋note＋
//   参数预填〕/edges 透传（「📚＋存量增强」由 note 承载——X-12 不扩枚举）；LLM 草稿经
//   chatJson 收敛＋顶层 canonicalKeys；草稿结构不可用→PLAN-DRAFT；LLM 失败上抛（02 §9.2
//   兜底链限意图面——规划无锚定兜底）。
// LLM 面：降级用例注 fake 网关（草稿定点回放——网关内部归 T5-01）；请求面/键折叠走真网关＋
// fake SSE transport。
import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '@constella/shared/ipc';
import {
  createLlmGateway,
  LlmGatewayError,
  type LlmGateway,
  type LlmTransport,
  type LlmTransportRequest,
} from './llm-gateway';
import {
  createFlowPlanner,
  FlowPlannerError,
  type FlowPlanner,
  type FlowPlannerDeps,
  type PlanDraft,
  type PlazaQuery,
} from './flow-planner';

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

/** fake 网关：chatJson 定点回放草稿（规划降级用例——LLM 行为面无关） */
function gatewayReturning(draft: unknown): LlmGateway {
  return {
    chatJson: async <T>() => draft as T,
    chatStream: async () => {
      throw new Error('unused in planner specs');
    },
  };
}

function gatewayFailing(code: string, message: string): LlmGateway {
  return {
    chatJson: async <T>() => {
      throw new LlmGatewayError(code as never, message) as unknown as T;
    },
    chatStream: async () => {
      throw new Error('unused in planner specs');
    },
  };
}

const libEntry = (over: Partial<LibraryEntry>): LibraryEntry => ({
  id: `lib-${over.type ?? 'x'}`,
  name: '库内节点',
  type: 'ai.llm',
  params: {},
  scriptMeta: { lang: 'ts', file: 'scripts/ai-llm.ts' },
  updatedAt: 0,
  ...over,
});

const draftOf = (over: Partial<PlanDraft>): PlanDraft => ({
  flowName: '我的流程',
  steps: [{ src: 'auto', type: 'ai.llm', name: 'AI 处理', params: {}, note: undefined }],
  ...over,
});

/** 传输失败（TransportFailureKind 同构——kind 字段鸭子型判定，无 market/ import 边） */
class FakeTransportError extends Error {
  constructor(readonly kind: 'network' | 'timeout') {
    super(`plaza transport failure: ${kind}`);
  }
}

// ————————————————————————————————————————————
// §6.2 三来源降级（02 §9.1：📚lib→🏬plaza〔在线〕→✨new；离线只查 📚）
// ————————————————————————————————————————————

describe('planner-三来源降级（TDD-C-07 §6.2——02 §9.1）', () => {
  it('planner-lib 同型 📚：库有同类型 → src=lib＋参数预填（库模板打底、草稿参数覆盖）＋库名兜底', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ src: 'auto', type: 'ai.llm', params: { prompt: '总结' } }] })),
      libLister: async () => [libEntry({ type: 'ai.llm', name: 'AI 处理', params: { model: 'glm-5' } })],
      plazaQuery: async () => {
        throw new Error('不应查广场——lib 已命中');
      },
    });
    const card = await planner.plan('做一个总结流程');
    expect(card.steps[0]).toEqual({
      src: 'lib',
      type: 'ai.llm',
      name: 'AI 处理', // 草稿未给 name → 库条目名兜底
      params: { model: 'glm-5', prompt: '总结' }, // 模板打底＋草稿覆盖
    });
  });

  it('planner-草稿 src 缺省=auto：先查库、有即 📚（02 §9.1 auto 语义正式化）', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ type: 'ai.llm' }] })), // 无 src
      libLister: async () => [libEntry({ type: 'ai.llm' })],
    });
    const card = await planner.plan('需求');
    expect(card.steps[0]!.src).toBe('lib');
  });

  it('planner-库无·广场有（在线）→ 🏬＋参数预填自广场命中', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ src: 'auto', type: 'xhs.search' }] })),
      libLister: async () => [],
      plazaQuery: async () => [{ type: 'xhs.search', name: '小红书搜索', params: { noteLimit: 50 } }],
    });
    const card = await planner.plan('监控小红书');
    expect(card.steps[0]).toEqual({
      src: 'plaza',
      type: 'xhs.search',
      name: '小红书搜索',
      params: { noteLimit: 50 },
    });
  });

  it('planner-全无 → ✨new（在线、lib 与广场均未命中；草稿参数直入计划卡）', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ src: 'auto', type: 'xhs.dm.send', params: { minIntervalSec: 60 } }] })),
      libLister: async () => [],
      plazaQuery: async () => [], // 在线但无此型
    });
    const card = await planner.plan('私信触达');
    expect(card.steps[0]).toEqual({
      src: 'new',
      type: 'xhs.dm.send',
      name: 'xhs.dm.send', // 无库/广场名兜底——type 即名（NodeDevAgent 随后定名）
      params: { minIntervalSec: 60 },
    });
  });

  it.each([['network'], ['timeout']] as const)(
    'planner-plaza 离线仅查 lib：注入位抛 kind=%s → 首查后本轮不再查广场、缺库步骤落 ✨new',
    async (kind) => {
      const queries: string[] = [];
      const plazaQuery: PlazaQuery = async (type) => {
        queries.push(type);
        throw new FakeTransportError(kind); // T5-09 TransportFailureKind 同构（鸭子型 kind 字段）
      };
      const planner = createFlowPlanner({
        llm: gatewayReturning(
          draftOf({ steps: [{ src: 'auto', type: 'a.x' }, { src: 'auto', type: 'b.y' }, { src: 'auto', type: 'a.x' }] }),
        ),
        libLister: async () => [],
        plazaQuery,
      });
      const card = await planner.plan('需求');
      expect(queries).toEqual(['a.x']); // 首次传输失败即判离线——后续步骤零广场调用
      expect(card.steps.map((s) => s.src)).toEqual(['new', 'new', 'new']); // 离线只查 lib → 全落现场开发
    },
  );

  it('planner-广场非传输错误＝该步未命中、不判离线（后续步骤仍查广场）', async () => {
    const queries: string[] = [];
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ src: 'auto', type: 'a.x' }, { src: 'auto', type: 'b.y' }] })),
      libLister: async () => [],
      plazaQuery: async (type) => {
        queries.push(type);
        if (type === 'a.x') throw new Error('HTTP 500'); // server 面错误——非传输失败
        return [{ type: 'b.y', name: 'B' }];
      },
    });
    const card = await planner.plan('需求');
    expect(queries).toEqual(['a.x', 'b.y']); // 未判离线——第二步继续查
    expect(card.steps.map((s) => s.src)).toEqual(['new', 'plaza']);
  });

  it('planner-未注入 plazaQuery（V1.0 装配缺省）→ 同离线仅查 lib、零广场调用', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning(draftOf({ steps: [{ src: 'auto', type: 'a.x' }, { src: 'auto', type: 'b.y' }] })),
      libLister: async () => [libEntry({ type: 'b.y' })],
      // plazaQuery 缺省——不注入
    });
    const card = await planner.plan('需求');
    expect(card.steps.map((s) => s.src)).toEqual(['new', 'lib']);
  });
});

// ————————————————————————————————————————————
// §6.2 计划卡模型（03 §4：id/flowName/steps〔三标记＋note＋参数预填〕/edges）
// ————————————————————————————————————————————

describe('planner-计划卡模型（TDD-C-07 §4 PlanCard 形——demo L2269-2281/L2298 同构）', () => {
  it('planner-计划卡形：id/flowName/edges 透传；note 承载「📚＋存量增强」不扩三标记', async () => {
    const planner: FlowPlanner = createFlowPlanner({
      llm: gatewayReturning(
        draftOf({
          flowName: '价格监控',
          steps: [{ src: 'auto', type: 'ai.llm', note: '📚＋存量增强：N8 minor 升级承载新能力' }],
          edges: [[0, 'hit', 1, 'in'], [0, 'miss', 2, 'in']],
        }),
      ),
      libLister: async () => [libEntry({ type: 'ai.llm' })],
    });
    const card = await planner.plan('价格监控');
    expect(card.id).toEqual(expect.any(String));
    expect(card.flowName).toBe('价格监控');
    expect(card.steps[0]).toMatchObject({
      src: 'lib', // 三标记枚举——note 不参与来源判定（X-12）
      note: '📚＋存量增强：N8 minor 升级承载新能力',
    });
    expect(card.edges).toEqual([[0, 'hit', 1, 'in'], [0, 'miss', 2, 'in']]);
  });

  it('planner-flowName 缺省（demo L2254 同款缺省名）', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning({ steps: [{ type: 'delay' }] }), // 无 flowName
    });
    const card = await planner.plan('随便');
    expect(card.flowName).toBe('我的自动化流程');
  });

  it('planner-草稿 steps 为空 → PLAN-DRAFT（响亮报错供「重新规划」，不静默出空卡）', async () => {
    const planner = createFlowPlanner({ llm: gatewayReturning({ flowName: '空', steps: [] }) });
    await expect(planner.plan('需求')).rejects.toMatchObject({ code: 'PLAN-DRAFT' });
    expect(() => {
      throw new FlowPlannerError('x');
    }).toThrow(); // 类型面导出存在性
  });

  it('planner-步骤缺 type → PLAN-DRAFT', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning({ flowName: '坏草稿', steps: [{ name: '无类型' }] }),
    });
    await expect(planner.plan('需求')).rejects.toMatchObject({ code: 'PLAN-DRAFT' });
  });

  it('planner-edges 非法形（非四元组）→ PLAN-DRAFT（落图前拦截，不流给 T5-04）', async () => {
    const planner = createFlowPlanner({
      llm: gatewayReturning({ flowName: 'X', steps: [{ type: 'delay' }], edges: [[0, 'out']] }),
    });
    await expect(planner.plan('需求')).rejects.toMatchObject({ code: 'PLAN-DRAFT' });
  });
});

// ————————————————————————————————————————————
// LLM 草稿面（chatJson 收敛＋canonicalKeys；失败上抛——无锚定兜底）
// ————————————————————————————————————————————

describe('planner-LLM 草稿（B-6：真实 LLM 规划——02 §9.1「demo 模板拼接废弃」）', () => {
  const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
  const delta = (text: string): string => sse({ choices: [{ delta: { content: text } }] });
  const DONE = 'data: [DONE]\n\n';

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

  it('planner-请求面：user 载需求语句；catalog 注入时 system 附类型菜单（C-05 list 注入位）', async () => {
    const sends: LlmTransportRequest[] = [];
    const draftJson = JSON.stringify(draftOf({ steps: [{ type: 'ai.llm' }] }));
    const planner = createFlowPlanner({
      llm: realGateway([delta(`\`\`\`json\n${draftJson}\n\`\`\``), DONE], sends),
      catalog: () => ['ai.llm', 'http.request', 'human.review'],
    });
    await planner.plan('监控价格并通知我');
    const body = JSON.parse(sends[0]!.body) as { messages: { role: string; content: string }[] };
    expect(body.messages.some((m) => m.content === '监控价格并通知我')).toBe(true);
    expect(body.messages.some((m) => m.content.includes('http.request'))).toBe(true); // 菜单进 prompt
  });

  it('planner-顶层键名折叠（canonicalKeys）：FlowName/STEPS 大写仍收敛', async () => {
    const planner = createFlowPlanner({
      llm: realGateway(
        [delta('{"FlowName":"折叠名","STEPS":[{"TYPE":"ai.llm"}]}'), DONE],
        [],
      ),
      libLister: async () => [],
    });
    const card = await planner.plan('需求');
    expect(card.flowName).toBe('折叠名');
    expect(card.steps[0]).toMatchObject({ src: 'new', type: 'ai.llm' }); // 步内 TYPE 由步级防御折叠
  });

  it('planner-LLM 失败上抛（LLM-CONFIG——02 §9.2 兜底链限意图面，规划无锚定兜底）', async () => {
    const planner = createFlowPlanner({ llm: gatewayFailing('LLM-CONFIG', '未配置 AI') });
    await expect(planner.plan('需求')).rejects.toMatchObject({ code: 'LLM-CONFIG' });
  });
});
