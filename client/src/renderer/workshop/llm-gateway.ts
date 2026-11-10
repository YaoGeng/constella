// LlmGateway —— OpenAI 兼容 chat/completions 客户端（T5-01；TDD-C-07 §3 LlmGateway 行＋§1 LLM
// 通道段；02 §9.1/§12.3/§15.2 N6）。
//   SSE 真流式：fetch＋ReadableStream 解析 data: 行，首块到达即回调 onChunk（不等流结束——
//   替换 demo 22ms 打字机，01 A-10.4/B-8）；[DONE] 收尾；行缓冲容忍半行/粘包分片。
//   chatJson 结构化后处理收敛（N6 对策）：json 代码围栏剥除/前后缀散文剥离/首个平衡 JSON 提取
//   /canonicalKeys 键名折叠——三模型差异由本适配层抹平，模型名为用户配置项、不断言能力
//   （02 §15.2 N6 行）；请求尽力带 response_format json_object，不支持端由后处理兜底。
//   超时重试：分片活性看门狗（timeoutMs 内无任何分片即断流）＋零交付安全重试——首块已交付
//   后不再重试（避免对话流重复渲染）；调用方 signal 终止不重试。
//   脱敏（02 §12.3）：apiKey 只以引用键（apiKeyRef）经 secret:* 通道解引用，明文仅入传输请求
//   Authorization 头这一个内存位置——不入对话流/store/日志/错误消息（sk- grep 零命中）；错误
//   面统一剥离 sk- 串为 ***（不留掩码前缀，§6.7 grep 断言面友好）。
//   profileProvider 注入（§8 替换点②，与 C-18 会签对齐）：V1.1=应用装配点注入
//   resolve('workshop')（C-18 §1 接线点①）；V1.0=缺省回退 settings 'ai' 单配置直读
//   （X-01 SettingsSchema——与 main 侧 production-assembly L179-183 同源同形，settings 无
//   model 键——model 由调用方请求携带）。接口先定（P-3），调用面零改即可换 V1.1。
//   传输 seam（§8 替换点③）：真传输=createFetchSseTransport（fetch+ReadableStream）；测试注入
//   fake SSE transport——两者产出同形「原始文本分片流」，共用本网关内同一 SSE 解析层。
//   renderer fetch 收窄（§6.9 grep 面）：本组件与 C-09 MarketApiClient 为仅有的两个 HTTP 出口。
import type { SecretGetReq, SecretGetRes } from '@constella/shared/ipc';
import type { AiSettings } from '@constella/shared/settings';
import type { StorageClient } from '../storage';

// ————————————————————————————————————————————
// 常量与错误面
// ————————————————————————————————————————————

/** 分片看门狗缺省（N6 惯例 60s——02 §9.3 MA-1 ai-judge「超时 60s」同源） */
export const LLM_DEFAULT_TIMEOUT_MS = 60_000;
/** 缺省重试次数（仅零交付时执行） */
export const LLM_DEFAULT_RETRIES = 1;
/** OpenAI 兼容固定路径（D-4：chat/completions 标准面） */
const CHAT_COMPLETIONS_PATH = '/chat/completions';

export type LlmErrorCode =
  | 'LLM-CONFIG' // 无可用配置（provider 与 settings 均缺 baseUrl/模型）——调用方兜底链入口（02 §9.2）
  | 'LLM-SECRET' // apiKeyRef 经 secret:get 未命中（in-band {value:null}）
  | 'LLM-HTTP' // 端点不可达 / HTTP 非 2xx
  | 'LLM-TIMEOUT' // 分片看门狗超时（断流）
  | 'LLM-ABORT' // 调用方 signal 终止（工坊停止按钮面）
  | 'LLM-PROTOCOL' // SSE 协议面异常（data 行 error 对象/传输读失败）
  | 'LLM-JSON'; // chatJson 输出无法收敛为 JSON

/** sk- 形密钥串剥离为 ***（不留掩码前缀 sk-——§6.7 「sk- grep 0 命中」断言面；展示位掩码
 *  sk-*** 归 settings UI 域，本组件错误/日志面不出现任何 sk- 子串） */
export function redactLlmSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{2,}/g, '***');
}

export class LlmGatewayError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(redactLlmSecrets(message)); // 错误面统一脱敏（02 §12.3）
    this.name = 'LlmGatewayError';
    this.code = code;
  }
}

// ————————————————————————————————————————————
// 契约类型（接口先定——P-3；调用面零改即可换 V1.1 profileProvider 实现）
// ————————————————————————————————————————————

/** 解析出的模型 profile（C-18 ModelRouter 冻结形的最小消费面——id/multimodal 与工坊无关不取） */
export interface LlmProfile {
  /** OpenAI 兼容自配（D-4） */
  baseUrl: string;
  /** safeStorage 引用键——明文只经 secret:* 解引用（02 §12.3） */
  apiKeyRef: string;
  /** 候选模型（形如 glm-5 / deepseek-v4 / kimi-k2——不断言能力，02 §15.2 N6） */
  model: string;
}

/** §8 替换点②：V1.1=应用装配点注入 C-18 resolve('workshop')（C-18 §1 接线点①） */
export type LlmProfileProvider = () => LlmProfile;

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatRequest {
  messages: LlmChatMessage[];
  /** 覆盖 profile.model（V1.0 settings 单配置无 model 键——调用方请求须携带或注入 provider） */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 分片看门狗（timeoutMs 内无任何分片→断流超时）；缺省 60000 */
  timeoutMs?: number;
  /** 重试次数（仅零交付时执行——首块已交付后失败不重试）；缺省 1 */
  retries?: number;
  /** 调用方终止面（工坊停止按钮）；已中止→LLM-ABORT 且零传输调用 */
  signal?: AbortSignal;
}

export type LlmChunkListener = (text: string) => void;

/** §4 留痕口径：仅 model 名＋命中标记（LLM 请求/响应不落盘） */
export interface LlmProfileTrace {
  model: string;
  source: 'provider' | 'settings';
}

/** secret:get 最小读面（T4-15 真通道；测试注入 mock——卡内 mock 仅为测试 seam） */
export interface LlmSecretReader {
  get(req: SecretGetReq): Promise<SecretGetRes>;
}

/** chatJson 键名收敛白名单（N6「字段名大小写」差异面——只按调用方契约折叠，不全局改写） */
export interface LlmJsonOptions {
  canonicalKeys?: readonly string[];
}

export interface LlmGateway {
  /** §3 组件级接口：SSE 流式——首块到达即 onChunk，resolve 值=全文 */
  chatStream(req: LlmChatRequest, onChunk: LlmChunkListener): Promise<string>;
  /** §3 组件级接口：结构化输出——流式收集＋后处理收敛（N6）＋canonicalKeys 键名折叠 */
  chatJson<T>(req: LlmChatRequest, opts?: LlmJsonOptions): Promise<T>;
}

// ————————————————————————————————————————————
// 传输 seam（§8 替换点③）
// ————————————————————————————————————————————

export interface LlmTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** 网关侧 AbortController（看门狗/调用方终止共用——真 fetch 以此打断挂起读） */
  signal?: AbortSignal;
}

/** 原始文本分片流（可半行——行缓冲归网关解析层，真传输与 fake 共用同一解析） */
export interface LlmSseStream {
  chunks(): AsyncIterable<string>;
}

export interface LlmTransport {
  send(req: LlmTransportRequest): Promise<LlmSseStream>;
}

// ————————————————————————————————————————————
// chatJson 后处理收敛（N6——纯函数，模型无关）
// ————————————————————————————————————————————

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 收敛管线：整体代码围栏剥除 → 直接解析 → 首个平衡 JSON 提取（剥前后缀散文） */
function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/); // ```json … ``` / ``` … ```
  if (fence) t = fence[1]!.trim();
  try {
    return JSON.parse(t);
  } catch {
    // 落入平衡提取
  }
  const start = t.search(/[{[]/);
  if (start >= 0) {
    const open = t[start]!;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(t.slice(start, i + 1));
          } catch {
            break; // 首个平衡段不合法——不再向后猜测
          }
        }
      }
    }
  }
  throw new LlmGatewayError('LLM-JSON', '模型输出无法收敛为 JSON（已试围栏剥除/散文剥离/平衡提取）');
}

/** 键名折叠：忽略大小写＋忽略 _ / -（「Intent」→intent、「CONFIDENCE」→confidence）；白名单外原样保留 */
function canonicalizeKeys(value: unknown, canonical: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const fold = (s: string): string => s.toLowerCase().replace(/[_-]/g, '');
  const map = new Map(canonical.map((k) => [fold(k), k]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[map.get(fold(k)) ?? k] = v;
  }
  return out;
}

// ————————————————————————————————————————————
// 装配
// ————————————————————————————————————————————

export interface LlmGatewayDeps {
  /** §8 替换点②注入位：V1.1=C-18 resolve('workshop')；缺省=V1.0 settings 'ai' 单配置直读 */
  profileProvider?: LlmProfileProvider;
  /** V1.0 回退路径的 settings 读面（settings.getAll → 'ai'——production-assembly 同形） */
  storage?: StorageClient;
  /** secret:get 解引用（apiKeyRef→明文仅入 Authorization 头）；未命中 in-band {value:null} */
  secrets: LlmSecretReader;
  /** §8 替换点③注入位：缺省=createFetchSseTransport（真 fetch）；测试注入 fake SSE transport */
  transport?: LlmTransport;
  /** §4 留痕回调（仅 model 名＋命中标记——LLM 请求/响应不落盘） */
  onTrace?: (t: LlmProfileTrace) => void;
}

interface InternalChatRequest extends LlmChatRequest {
  /** chatJson 专用：尽力带 response_format json_object（不支持端由后处理兜底——不断言能力） */
  json?: boolean;
}

/** 单次尝试的流内状态（行缓冲＋收敛文本＋交付标记） */
interface AttemptState {
  text: string;
  sawDataLine: boolean;
  otherRaw: string;
}

export function createLlmGateway(deps: LlmGatewayDeps): LlmGateway {
  const transport: LlmTransport = deps.transport ?? createFetchSseTransport();

  /** profile 解析（§8②）：provider 注入态优先；缺省 V1.0 settings 'ai' 单配置直读 */
  const resolveProfile = async (): Promise<LlmProfile & { source: 'provider' | 'settings' }> => {
    if (deps.profileProvider) {
      return { ...deps.profileProvider(), source: 'provider' };
    }
    if (!deps.storage) {
      throw new LlmGatewayError('LLM-CONFIG', '未配置 AI（无 profileProvider 且未注入 settings 读面）');
    }
    const all = await deps.storage.invoke('settings.getAll', undefined);
    const ai: AiSettings | undefined = all.ai; // 与 main 侧 production-assembly 同源同形（无 model 键）
    if (ai === undefined || ai.baseUrl === '') {
      throw new LlmGatewayError('LLM-CONFIG', "未配置 AI（settings 缺 'ai' 单配置——设置页配置后重试）");
    }
    return { baseUrl: ai.baseUrl, apiKeyRef: ai.apiKeyRef, model: '', source: 'settings' };
  };

  /** apiKey 解引用：空引用=免鉴权端点（本地兼容面）；未命中→LLM-SECRET */
  const resolveApiKey = async (apiKeyRef: string): Promise<string> => {
    if (apiKeyRef === '') return '';
    const res = await deps.secrets.get({ key: apiKeyRef });
    if (res.value == null) {
      throw new LlmGatewayError('LLM-SECRET', `密钥引用未命中（${apiKeyRef}）——请重配 AI 密钥`);
    }
    return res.value;
  };

  /** 请求预备（每公开调用一次——attempts 复用同请求形；留痕同点） */
  const prepare = async (req: InternalChatRequest) => {
    if (req.signal?.aborted) {
      throw new LlmGatewayError('LLM-ABORT', '调用方已终止（零传输调用）');
    }
    const profile = await resolveProfile();
    const model = req.model !== undefined && req.model !== '' ? req.model : profile.model;
    if (model === '') {
      throw new LlmGatewayError('LLM-CONFIG', '未指定模型（V1.0 settings 单配置无 model 键——请求须携带）');
    }
    const apiKey = await resolveApiKey(profile.apiKeyRef);
    deps.onTrace?.({ model, source: profile.source });
    const body = JSON.stringify({
      model,
      messages: req.messages,
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.json === true ? { response_format: { type: 'json_object' } } : {}),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(apiKey !== '' ? { Authorization: `Bearer ${apiKey}` } : {}), // 明文唯一内存位置（§12.3）
    };
    return {
      url: `${profile.baseUrl.replace(/\/+$/, '')}${CHAT_COMPLETIONS_PATH}`,
      headers,
      body,
    };
  };

  /** 单次流式尝试：看门狗（分片活性）＋SSE 解析层（真传输与 fake 共用） */
  const streamOnce = async (
    req: InternalChatRequest,
    prepared: { url: string; headers: Record<string, string>; body: string },
    onChunk: LlmChunkListener,
  ): Promise<string> => {
    const timeoutMs = req.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const onCallerAbort = (): void => {
      controller.abort();
    };
    req.signal?.addEventListener('abort', onCallerAbort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };

    const state: AttemptState = { text: '', sawDataLine: false, otherRaw: '' };
    let lineBuf = '';

    /** data: 行处理：[DONE]/增量 delta/整体 message/error 对象——三端差异在此抹平 */
    const handleLine = (line: string): void => {
      if (line === '') return; // SSE 事件分隔空行
      if (!line.startsWith('data:')) {
        state.otherRaw += `${line}\n`; // 非 data 行（注释/event:/整体 JSON 体）——留作非 SSE 兜底
        return;
      }
      state.sawDataLine = true;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return; // 收尾标记——流自然结束即收口（缺失亦兼容）
      let evt: unknown;
      try {
        evt = JSON.parse(payload);
      } catch {
        return; // 坏行容忍（N6 收敛口径——不因单坏行弃整个流）
      }
      if (isRecord(evt) && isRecord(evt.error)) {
        const msg = typeof evt.error.message === 'string' ? evt.error.message : 'unknown';
        throw new LlmGatewayError('LLM-PROTOCOL', `LLM 端点错误：${msg}`);
      }
      const choice = isRecord(evt) && Array.isArray(evt.choices) ? evt.choices[0] : undefined;
      const deltaObj = isRecord(choice) ? choice.delta : undefined;
      const msgObj = isRecord(choice) ? choice.message : undefined;
      // 增量优先；端点忽略 stream 在 data 行给整体 message 时兜底（与已收敛文本相同则去重）
      const piece =
        isRecord(deltaObj) && typeof deltaObj.content === 'string'
          ? deltaObj.content
          : isRecord(msgObj) && typeof msgObj.content === 'string' && msgObj.content !== state.text
            ? msgObj.content
            : '';
      if (piece !== '') {
        state.text += piece;
        onChunk(piece); // 首块即渲染（A-10.4）
      }
    };

    try {
      arm(); // 连接段也受看门狗守护
      const stream = await transport.send({ ...prepared, signal: controller.signal });
      for await (const chunk of stream.chunks()) {
        arm(); // 分片活性续命
        lineBuf += chunk;
        for (;;) {
          const nl = lineBuf.indexOf('\n');
          if (nl < 0) break;
          const line = lineBuf.slice(0, nl).replace(/\r$/, '');
          lineBuf = lineBuf.slice(nl + 1);
          handleLine(line);
        }
      }
      if (lineBuf !== '') handleLine(lineBuf.replace(/\r$/, '')); // 尾行无换行
      // 非 SSE 兜底（N6）：端点忽略 stream 返回整体 JSON 体 → message.content 一次交付
      if (state.text === '' && !state.sawDataLine && state.otherRaw.trim() !== '') {
        try {
          const whole = JSON.parse(state.otherRaw);
          const choice = isRecord(whole) && Array.isArray(whole.choices) ? whole.choices[0] : undefined;
          const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
          if (typeof content === 'string' && content !== '') {
            state.text = content;
            onChunk(content);
          }
        } catch {
          // 非 JSON 体——按空产出走（chatJson 侧随后收敛失败报 LLM-JSON）
        }
      }
      return state.text;
    } catch (err) {
      if (req.signal?.aborted) throw new LlmGatewayError('LLM-ABORT', '调用方已终止');
      if (timedOut) throw new LlmGatewayError('LLM-TIMEOUT', `LLM 流式超时（${timeoutMs}ms 无分片）`);
      if (err instanceof LlmGatewayError) throw err; // 已脱敏类型面（含传输层 LLM-HTTP）
      throw new LlmGatewayError('LLM-PROTOCOL', `LLM 流读取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onCallerAbort);
    }
  };

  /** 流式编排：attempts=1＋retries；零交付安全重试（首块已交付后失败不重试——避免重复渲染） */
  const streamWithRetry = async (
    req: InternalChatRequest,
    onChunk: LlmChunkListener,
    retryOnPartial: boolean,
  ): Promise<string> => {
    const prepared = await prepare(req);
    const attempts = 1 + Math.max(0, req.retries ?? LLM_DEFAULT_RETRIES);
    let delivered = false;
    const guarded = (t: string): void => {
      delivered = true;
      onChunk(t);
    };
    let lastErr: unknown = new LlmGatewayError('LLM-PROTOCOL', 'unreachable');
    for (let i = 0; i < attempts; i++) {
      try {
        return await streamOnce(req, prepared, guarded);
      } catch (err) {
        if (err instanceof LlmGatewayError && err.code === 'LLM-ABORT') throw err; // 调用方终止不重试
        lastErr = err;
        if (i === attempts - 1) throw err;
        if (!retryOnPartial && delivered) throw err; // 已交付不重试（chatStream 安全规则）
      }
    }
    throw lastErr;
  };

  return {
    chatStream: (req, onChunk) => streamWithRetry(req, onChunk, false),

    async chatJson<T>(req: LlmChatRequest, opts?: LlmJsonOptions): Promise<T> {
      // chatJson 调用方不消费增量（T5-02 意图路由/规划取终值）——部分交付可安全重试
      const text = await streamWithRetry({ ...req, json: true }, () => {}, true);
      const value = extractJson(text);
      return canonicalizeKeys(value, opts?.canonicalKeys ?? []) as T;
    },
  };
}

// ————————————————————————————————————————————
// 真传输（§8③ 缺省实现——fetch＋ReadableStream；测试注入 fake 替换）
// ————————————————————————————————————————————

/** fetch 流式传输（renderer 两个 HTTP 出口之一——§6.9 grep 面：workshop/ 与 market/ 之外零 fetch） */
export function createFetchSseTransport(fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)): LlmTransport {
  return {
    send: async (req) => {
      let res: Response;
      try {
        res = await fetchFn(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body,
          signal: req.signal,
        });
      } catch (e) {
        // 网络面失败（含 abort——网关按 aborted/timedOut 标记先行归类，此处仅透传消息）
        throw new LlmGatewayError('LLM-HTTP', `LLM 端点不可达：${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300);
        } catch {
          // body 不可读则略
        }
        throw new LlmGatewayError('LLM-HTTP', `LLM 端点 HTTP ${res.status}${detail !== '' ? `：${detail}` : ''}`);
      }
      if (res.body === null) {
        const text = await res.text(); // 环境无流 body——整体一次性交付（解析层兼容）
        return { chunks: async function* () { yield text; } };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      return {
        chunks: async function* () {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const piece = decoder.decode(value, { stream: true });
              if (piece !== '') yield piece;
            }
            const tail = decoder.decode();
            if (tail !== '') yield tail;
          } finally {
            reader.releaseLock(); // 消费侧提前退出（abort/异常）时释放锁
          }
        },
      };
    },
  };
}
