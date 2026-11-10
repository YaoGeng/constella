// LlmGateway 组件套件（T5-01；TDD-C-07 §3 LlmGateway 行＋§1 LLM 通道段；02 §9.1/§12.3/§15.2 N6）。
// 断言面（§6.6＋§6.7）：
//   §6.6 llm 通道——SSE fake 首块即 onChunk（A-10.4——不等流结束）；data: 行缓冲（半行/粘包
//   重组）；[DONE] 收尾拼全文；端点忽略 stream 返回整体 JSON 的兼容收口；data 行 error 对象
//   → LLM-PROTOCOL；chatJson 后处理收敛（N6：json 代码围栏/前后缀散文/键名大小写——模型名
//   不断言能力，差异全由适配层抹平）；注入 profileProvider（模拟 C-18 resolve('workshop')）
//   → baseUrl/model 取自 provider；未注入 → settings 'ai' 单配置（V1.0 回退——与 main 侧
//   production-assembly 同源同形）；超时重试（首块前安全重试/已交付不重试）；调用方终止；
//   secret:get 未命中 in-band {value:null} → LLM-SECRET；配置缺失 → LLM-CONFIG（调用方兜底
//   链入口，02 §9.2）；
//   §6.7 脱敏——apiKey 经 secret:* 解引用、明文仅入传输请求 Authorization 头：对话流
//   （onChunk/chatJson 结果）/留痕/错误消息 `sk-` grep 0 命中（02 §12.3）。
// 传输 seam＝§8③（LLM 传输替换点：真传输=fetch+ReadableStream；fake 注入即测试 seam——
// 真传输与 fake 共用网关内同一 SSE 解析层，本套件全走 fake，解析层行为即真传输行为）。
import { describe, expect, it, vi } from 'vitest';
import type { SecretGetReq, SecretGetRes, StorageInvokeReq } from '@constella/shared/ipc';
import type { SettingsSchema } from '@constella/shared/settings';
import { createStorageClient, type StorageBridge } from '../storage';
import {
  createLlmGateway,
  LlmGatewayError,
  redactLlmSecrets,
  type LlmChatRequest,
  type LlmSecretReader,
  type LlmProfileTrace,
  type LlmTransport,
  type LlmTransportRequest,
} from './llm-gateway';

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

/** 明文样本（§6.7 grep 对象——只允许出现在传输请求 Authorization 头这一个内存位置） */
const PLAINTEXT = 'sk-live-T5-01-PLAINTEXT-fixture-9f3a';

/** SSE 帧构造：data 行 / delta 内容块 / [DONE] */
const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (text: string): string => sse({ choices: [{ delta: { content: text } }] });
const ROLE_ONLY = sse({ choices: [{ delta: { role: 'assistant' } }] });
const DONE = 'data: [DONE]\n\n';

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 挂起直到 signal 中止（模拟被 abort 打断的挂起读——真 fetch 的 AbortError 行为面） */
function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error('This operation was aborted'));
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        reject(new Error('This operation was aborted'));
      },
      { once: true },
    );
  });
}

/** 挂起读（可被 abort 打断；gate 先行时迟到 abort 不产生 unhandled rejection） */
async function hold(signal: AbortSignal | undefined, gate?: Promise<void>): Promise<void> {
  const abortP = hangUntilAbort(signal);
  abortP.catch(() => {}); // 已处理分支：race 之外不再外溢
  await Promise.race([gate ?? new Promise<void>(() => {}), abortP]);
}

/** 可编程 fake SSE 传输（§8③ seam 测试件）：按脚本回放原始文本分片（可半行）；支持门闩挂起/断流/直接失败 */
interface FakeScript {
  /** 原始文本分片序列（行缓冲验证可任意切）；fail-only 脚本可省 */
  chunks?: string[];
  /** 在第 hangBefore 个分片产出前挂起（门闩 release 前流不结束——首块即渲染断言用） */
  hangBefore?: number;
  gate?: { promise: Promise<void> };
  /** 分片全部产出后仍不收口（断流——watchdog 用；挂起仅可被 abort 打断） */
  hangAfterAll?: boolean;
  /** send 即失败（传输层错误/HTTP 非 2xx 面） */
  fail?: Error;
}

function fakeSseTransport() {
  const sends: LlmTransportRequest[] = [];
  const scripts: FakeScript[] = [];
  const transport: LlmTransport = {
    send: async (req) => {
      sends.push(req);
      const script = scripts.shift();
      if (script === undefined) {
        // 响亮报错（非静默空流）——意外多出的 send（如不该发生的重试）在断言面可见
        throw new Error('fake transport: 未编排脚本（unexpected send）');
      }
      if (script.fail) throw script.fail;
      const { chunks = [], hangBefore, gate, hangAfterAll } = script;
      const signal = req.signal;
      return {
        chunks: async function* () {
          for (let i = 0; i < chunks.length; i++) {
            if (i === hangBefore && gate) await hold(signal, gate.promise);
            yield chunks[i]!;
          }
          if (hangAfterAll) await hold(signal);
        },
      };
    },
  };
  return { transport, sends, send: (s: FakeScript) => void scripts.push(s) };
}

/** secret:get 注入件（T4-15 真通道面的测试 seam——未命中 in-band {value:null}） */
function fakeSecrets(vault: Record<string, string> = {}) {
  const gets: SecretGetReq[] = [];
  const secrets: LlmSecretReader = {
    get: async (req) => {
      gets.push(req);
      const value = vault[req.key];
      return { value: value === undefined ? null : value } satisfies SecretGetRes;
    },
  };
  return { secrets, gets };
}

/** settings 读面（真 StorageClient＋mock bridge——V1.0 回退路径与 production-assembly 同形取 'ai'） */
function fakeSettingsStorage(settings: Partial<SettingsSchema>) {
  const ops: StorageInvokeReq[] = [];
  const bridge: StorageBridge = {
    invoke: async (req) => {
      ops.push(req);
      if (req.op === 'settings.getAll') return settings;
      throw new Error(`unexpected op: ${req.op}`);
    },
  };
  return { storage: createStorageClient(bridge), ops };
}

function baseReq(over: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return { messages: [{ role: 'user', content: '解释一下星座' }], ...over };
}

/** 网关装配捷径：profileProvider 注入态（模拟 C-18 resolve('workshop')）；缺省 vault 含已解引用键 */
function gatewayWithProvider(
  transport: LlmTransport,
  vault: Record<string, string> = { 'secret.ai.apiKey': PLAINTEXT },
  traces?: LlmProfileTrace[],
) {
  const { secrets } = fakeSecrets(vault);
  return createLlmGateway({
    profileProvider: () => ({
      baseUrl: 'https://llm.example.test/v1/',
      apiKeyRef: 'secret.ai.apiKey',
      model: 'glm-5',
    }),
    secrets,
    transport,
    ...(traces ? { onTrace: (t: LlmProfileTrace) => traces.push(t) } : {}),
  });
}

// ————————————————————————————————————————————
// §6.6 llm 通道
// ———————————————————————————————————————————

describe('TDD-C-07 §6.6/§6.7 llm 通道——LlmGateway（SSE 流式/chatJson 收敛/profileProvider/脱敏）', () => {
  it('llm SSE 真流式（A-10.4）：首块到达即回调 onChunk（流仍挂在门闩未结束），[DONE] 收尾拼全文', async () => {
    const { transport, sends, send } = fakeSseTransport();
    const gate = defer();
    // 第二块产出前挂门闩——若实现等流结束才回调，本断言面必然失败
    send({ chunks: [delta('星'), delta('座'), DONE], hangBefore: 1, gate });
    const gw = gatewayWithProvider(transport);

    const seen: string[] = [];
    const done = gw.chatStream(baseReq(), (t) => seen.push(t));

    await vi.waitFor(() => expect(seen).toEqual(['星'])); // 首块已渲染……
    expect(sends.length).toBe(1);
    expect(JSON.parse(sends[0]!.body)).toMatchObject({ model: 'glm-5', stream: true }); // ……而流未收尾

    gate.resolve();
    expect(await done).toBe('星座');
  });

  it('llm SSE 行缓冲：分片半行/粘包按 data: 行重组（真传输与 fake 共用同一解析层）', async () => {
    const { transport, send } = fakeSseTransport();
    send({
      chunks: [
        'data: {"choices":[{"delta":{"conte', // 半行（切在 content 值中间）
        `nt":"星座"}}]}\n\ndata: {"choices":[{"del`, // 半行收口＋新半行（切在 delta 键名中间）
        `ta":{"content":"运行"}}]}\n\n${DONE}`,
      ],
    });
    const gw = gatewayWithProvider(transport);
    expect(await gw.chatStream(baseReq({ model: 'kimi-k2' }), () => {})).toBe('星座运行');
  });

  it('llm SSE 兼容收尾：role-only 首块（空 delta）跳过；流自然结束无 [DONE] 亦收口', async () => {
    const { transport, send } = fakeSseTransport();
    send({ chunks: [ROLE_ONLY, delta('收口')] }); // 无 [DONE]
    const gw = gatewayWithProvider(transport);
    const seen: string[] = [];
    expect(await gw.chatStream(baseReq(), (t) => seen.push(t))).toBe('收口');
    expect(seen).toEqual(['收口']); // role-only 不产生空回调
  });

  it('llm SSE 兼容（N6 三端差异抹平）：端点忽略 stream 返回整体 JSON → 以 choices[0].message.content 收口', async () => {
    const { transport, send } = fakeSseTransport();
    send({ chunks: [JSON.stringify({ choices: [{ message: { content: '整体返回' } }] })] });
    const gw = gatewayWithProvider(transport);
    expect(await gw.chatStream(baseReq(), () => {})).toBe('整体返回');
  });

  it('llm SSE 协议面：data 行为 error 对象（限流/鉴权类）→ LLM-PROTOCOL（消息脱敏；retries=0 单次即报）', async () => {
    const { transport, send } = fakeSseTransport();
    send({ chunks: [sse({ error: { message: 'rate limited' } }), DONE] });
    const gw = gatewayWithProvider(transport);
    await expect(gw.chatStream(baseReq({ retries: 0 }), () => {})).rejects.toMatchObject({
      code: 'LLM-PROTOCOL',
    });
  });

  it('llm chatJson 收敛（N6）：json 代码围栏剥除；请求带 response_format json_object', async () => {
    const { transport, sends, send } = fakeSseTransport();
    const text = '```json\n{"intent":"explain","confidence":0.9}\n```';
    send({ chunks: [delta(text), DONE] });
    const gw = gatewayWithProvider(transport);

    const out = await gw.chatJson<{ intent: string; confidence: number }>(baseReq());
    expect(out).toEqual({ intent: 'explain', confidence: 0.9 });
    expect(JSON.parse(sends[0]!.body)).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('llm chatJson 收敛（N6）：前后缀散文剥离，取首个平衡 JSON 对象', async () => {
    const { transport, send } = fakeSseTransport();
    send({
      chunks: [
        delta('好的，结果如下：'),
        delta('{"intent":"optimize","confidence":0.82}'),
        delta('希望有帮助'),
        DONE,
      ],
    });
    const gw = gatewayWithProvider(transport);
    expect(await gw.chatJson(baseReq())).toEqual({ intent: 'optimize', confidence: 0.82 });
  });

  it('llm chatJson 收敛（N6）：canonicalKeys 键名大小写/分隔符折叠——不给白名单则不误伤原键', async () => {
    const { transport, send } = fakeSseTransport();
    send({ chunks: [delta('{"Intent":"optimize","CONFIDENCE":0.82,"model_tag":"x"}'), DONE] });
    const gw = gatewayWithProvider(transport);

    // 白名单命中：Intent→intent、CONFIDENCE→confidence（折叠=忽略大小写＋忽略 _ / -）
    const folded = await gw.chatJson<Record<string, unknown>>(baseReq(), {
      canonicalKeys: ['intent', 'confidence'],
    });
    expect(folded).toEqual({ intent: 'optimize', confidence: 0.82, model_tag: 'x' });

    // 无白名单：原键保留（适配层只按调用方契约折叠，不全局改写）
    send({ chunks: [delta('{"Intent":"optimize"}'), DONE] });
    expect(await gw.chatJson<Record<string, unknown>>(baseReq())).toEqual({ Intent: 'optimize' });
  });

  it('llm chatJson 失败：输出无法收敛为 JSON → LLM-JSON（调用方走兜底链）', async () => {
    const { transport, send } = fakeSseTransport();
    send({ chunks: [delta('抱歉，我不明白。'), DONE] });
    const gw = gatewayWithProvider(transport);
    await expect(gw.chatJson(baseReq({ retries: 0 }))).rejects.toMatchObject({ code: 'LLM-JSON' });
  });

  it("llm profileProvider 注入（V1.1=C-18 resolve('workshop') 模拟）：baseUrl/model 取自 provider，apiKey 经 secret:get 解引用仅入 Authorization 头，settings 零调用", async () => {
    const { transport, sends, send } = fakeSseTransport();
    send({ chunks: [delta('ok'), DONE] });
    const { secrets, gets } = fakeSecrets({ 'secret.ai.apiKey': PLAINTEXT });
    const storage = fakeSettingsStorage({
      ai: { baseUrl: 'https://settings.example.test/v1', apiKeyRef: 'secret.ai.apiKey' },
    });
    const traces: LlmProfileTrace[] = [];
    const gw = createLlmGateway({
      profileProvider: () => ({
        baseUrl: 'https://llm.example.test/v1',
        apiKeyRef: 'secret.ai.apiKey',
        model: 'glm-5',
      }),
      storage: storage.storage,
      secrets,
      transport,
      onTrace: (t) => traces.push(t),
    });

    await gw.chatStream(baseReq(), () => {});

    expect(sends[0]!.url).toBe('https://llm.example.test/v1/chat/completions'); // 尾斜杠收口＋固定路径
    expect(sends[0]!.headers['Authorization']).toBe(`Bearer ${PLAINTEXT}`); // 明文唯一内存位置
    expect(gets).toEqual([{ key: 'secret.ai.apiKey' }]);
    expect(storage.ops).toEqual([]); // provider 态不读 settings
    expect(traces).toEqual([{ model: 'glm-5', source: 'provider' }]); // §4 留痕=仅 model 名＋命中标记
  });

  it("llm 未注入 profileProvider（V1.0 回退）：settings 'ai' 单配置直读（production-assembly 同形），model 由请求携带", async () => {
    const { transport, sends, send } = fakeSseTransport();
    send({ chunks: [delta('ok'), DONE] });
    const { secrets } = fakeSecrets({ 'secret.ai.apiKey': PLAINTEXT });
    const storage = fakeSettingsStorage({
      ai: { baseUrl: 'https://settings.example.test/v1', apiKeyRef: 'secret.ai.apiKey' },
    });
    const traces: LlmProfileTrace[] = [];
    const gw = createLlmGateway({ storage: storage.storage, secrets, transport, onTrace: (t) => traces.push(t) });

    await gw.chatStream(baseReq({ model: 'deepseek-v4' }), () => {});

    expect(sends[0]!.url).toBe('https://settings.example.test/v1/chat/completions');
    expect(JSON.parse(sends[0]!.body)).toMatchObject({ model: 'deepseek-v4', stream: true }); // V1.0 settings 无 model 键——入口在调用方
    expect(storage.ops).toEqual([{ op: 'settings.getAll' }]);
    expect(traces).toEqual([{ model: 'deepseek-v4', source: 'settings' }]);
  });

  it('llm apiKeyRef 为空（本地兼容端点免鉴权）→ 请求不带 Authorization 头', async () => {
    const { transport, sends, send } = fakeSseTransport();
    send({ chunks: [delta('ok'), DONE] });
    const gw = createLlmGateway({
      profileProvider: () => ({ baseUrl: 'http://127.0.0.1:11434/v1', apiKeyRef: '', model: 'qwen-local' }),
      secrets: fakeSecrets().secrets,
      transport,
    });
    await gw.chatStream(baseReq(), () => {});
    expect(sends[0]!.headers['Authorization']).toBeUndefined();
  });

  it('llm 配置缺失：provider 与 settings 均无 baseUrl → LLM-CONFIG（零传输调用——调用方兜底链入口）', async () => {
    const { transport, sends } = fakeSseTransport();
    const storage = fakeSettingsStorage({}); // settings 无 'ai' 键
    const gw = createLlmGateway({ storage: storage.storage, secrets: fakeSecrets().secrets, transport });
    await expect(gw.chatStream(baseReq({ model: 'glm-5' }), () => {})).rejects.toMatchObject({
      code: 'LLM-CONFIG',
    });
    expect(sends).toEqual([]);
  });

  it('llm secret 解引用失败：secret:get 未命中 in-band {value:null} → LLM-SECRET（零传输调用）', async () => {
    const { transport, sends } = fakeSseTransport();
    const gw = gatewayWithProvider(transport, {}); // vault 空——未命中
    await expect(gw.chatStream(baseReq(), () => {})).rejects.toMatchObject({ code: 'LLM-SECRET' });
    expect(sends).toEqual([]);
  });

  it('llm 超时重试：首块前看门狗超时 → 安全重试，第二次成功（重试计数=1＋retries）', async () => {
    const { transport, sends, send } = fakeSseTransport();
    send({ chunks: [], hangAfterAll: true }); // 第一次：断流挂死（仅可被 abort 打断）
    send({ chunks: [delta('重'), delta('试'), DONE] }); // 第二次：正常回放
    const gw = gatewayWithProvider(transport);

    const out = await gw.chatStream(baseReq({ timeoutMs: 30, retries: 1 }), () => {});
    expect(out).toBe('重试');
    expect(sends.length).toBe(2);
  });

  it('llm 超时重试安全规则：首块已交付后超时不再重试（避免重复渲染），报 LLM-TIMEOUT', async () => {
    const { transport, sends, send } = fakeSseTransport();
    send({ chunks: [delta('你')], hangAfterAll: true }); // 交付首块后断流
    send({ chunks: [delta('不应出现'), DONE] }); // 不应触发的重试脚本
    const gw = gatewayWithProvider(transport);

    const seen: string[] = [];
    await expect(
      gw.chatStream(baseReq({ timeoutMs: 30, retries: 1 }), (t) => seen.push(t)),
    ).rejects.toMatchObject({ code: 'LLM-TIMEOUT' });
    expect(seen).toEqual(['你']); // 无重复交付
    expect(sends.length).toBe(1);
  });

  it('llm 调用方终止：signal 已中止 → LLM-ABORT 且零传输调用（工坊停止按钮面）', async () => {
    const { transport, sends } = fakeSseTransport();
    const gw = gatewayWithProvider(transport);
    const ac = new AbortController();
    ac.abort();
    await expect(gw.chatStream(baseReq({ signal: ac.signal }), () => {})).rejects.toMatchObject({
      code: 'LLM-ABORT',
    });
    expect(sends).toEqual([]);
  });

  // ————————————————————————————————————————
  // §6.7 脱敏（02 §12.3）
  // ————————————————————————————————————————

  it('llm 脱敏（§6.7）：apiKey 明文仅存在于传输请求 Authorization 头——对话流/chatJson 结果/留痕/错误消息 sk- grep 0 命中', async () => {
    const { transport, sends, send } = fakeSseTransport();
    const traces: LlmProfileTrace[] = [];
    const gw = gatewayWithProvider(transport, { 'secret.ai.apiKey': PLAINTEXT }, traces);

    // ① 正常流：onChunk 载荷与 chatJson 结果
    send({ chunks: [delta('答案'), DONE] });
    const chunksSeen: string[] = [];
    await gw.chatStream(baseReq(), (t) => chunksSeen.push(t));
    send({ chunks: [delta('{"intent":"explain","confidence":1}'), DONE] });
    const jsonOut = await gw.chatJson(baseReq());

    // ② 失败面：传输层错误消息回显明文（模拟端点 401 body 回显）→ 网关错误必须已脱敏
    send({ fail: new LlmGatewayError('LLM-HTTP', `upstream 401: invalid key ${PLAINTEXT}`) });
    let errMsg = '';
    await gw.chatStream(baseReq({ retries: 0 }), () => {}).catch((e: LlmGatewayError) => {
      errMsg = e.message;
    });
    expect(errMsg).not.toBe(''); // 确认错误面被捕获

    // 明文只在传输请求头（内存中转，不落任何 sink）
    expect(sends[0]!.headers['Authorization']).toBe(`Bearer ${PLAINTEXT}`);

    const sinks = JSON.stringify({ chunksSeen, jsonOut, traces, errMsg });
    expect(sinks).not.toContain(PLAINTEXT);
    expect(sinks.includes('sk-')).toBe(false); // §6.7 grep 断言：sk- 零命中（掩码形也不入对话流）
  });

  it('llm redactLlmSecrets：sk- 串剥离为 ***（不残留掩码前缀 sk-，§6.7 grep 面友好）', () => {
    expect(redactLlmSecrets(`Bearer ${PLAINTEXT} ok`)).toBe('Bearer *** ok');
    expect(redactLlmSecrets('无密钥文本')).toBe('无密钥文本');
  });
});
