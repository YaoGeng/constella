// @constella/sdk net —— ctx.net 绑定客户端（T5-12b；K-01 §2 冻结径②：net=独立
// NetProxyBridge 端点〔CONSTELLA_NET_WS，run/node 作用域〕直连，Node 24 全局 WebSocket，
// ts 侧零新增依赖）。
//
// 线形=T5-12a PM 缺省③共享契约（T0-07 统一帧形的同构复制——K-01 §2 红线：SDK 侧不
// import X-01 @constella/shared/ipc 域，shared/src/ipc/bridge.ts 为同源权威）：
//   请求（文本帧 JSON） {"id":number,"ns":"net","method":"fetch","params":{"url","headers"?}}
//   → 成功 {"id",ok:true,result:{status,statusText,headers,bodyB64}}
//   ｜失败 {"id",ok:false,error:{code,message}}
//   - id 连接内单调递增=客户端义务（T0-07；服务端逐帧应答不校验）；
//   - status===0＝网络层失败（宿主 net-proxy-bridge.ts 冻结语义）→ 抛 SdkNetError
//     {code:'NET-FAILED', message=statusText}；非 2xx=in-band 成功（status 真值原样返回）；
//   - 白名单拒 {code:'NET-DENIED'} → 抛 SdkNetError（code 可判别，message=宿主文案）。
// 错误码值复制（同源 shared/src/ipc/bridge.ts BRIDGE_ERROR_CODES——K-01 §2 红线不 import）：
//   请求超时='BRIDGE-TIMEOUT'；连接失败/应答前关闭='BRIDGE-CLOSED'。
//
// 连接策略：懒连接（首次 fetch 才握手）＋连接复用（同端点单连接跨 fetch 复用，id 关联
// 多路应答）；断连/关闭面=未决请求全部拒 BRIDGE-CLOSED＋连接丢弃（下次 fetch 重连）。
// 超时为逐请求计时（默认 30s）：超时只拒当次请求、不弃连接（id 关联使迟回应答安全丢弃）。
import type { NetCap, NetFetchResponse } from './caps.ts';

/** 缺省单请求超时（ms）——BRIDGE-TIMEOUT 语义（码值同源 shared BRIDGE_ERROR_CODES.BRIDGE_TIMEOUT） */
export const DEFAULT_NET_FETCH_TIMEOUT_MS = 30_000;

/** 错误码常量（值复制自 shared/src/ipc/bridge.ts BRIDGE_ERROR_CODES——K-01 §2 红线不 import X-01） */
const CODE_BRIDGE_TIMEOUT = 'BRIDGE-TIMEOUT';
const CODE_BRIDGE_CLOSED = 'BRIDGE-CLOSED';

/**
 * net 能力错误（帧 name=SdkNetError，code 判别）：
 * 'NET-FAILED'=网络层失败（宿主 status===0）；'NET-DENIED'=域名白名单拒（可判别）；
 * 'BRIDGE-TIMEOUT'/'BRIDGE-CLOSED'=传输层（超时/连接失败/应答前关闭）；
 * 其余=宿主错误帧原样透传（code/message）。ts/py 同构（py 对照物 constella_sdk/net.py）。
 */
export class SdkNetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SdkNetError';
    this.code = code;
  }
}

/** makeNetCap 选项 */
export interface NetCapOptions {
  /** 单请求超时 ms（缺省 30s）——超时抛 SdkNetError{code:'BRIDGE-TIMEOUT'} */
  fetchTimeoutMs?: number;
}

interface PendingCall {
  resolve: (res: NetFetchResponse) => void;
  reject: (err: SdkNetError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** ws 文本帧 JSON 应答帧（T0-07 统一形——客户端收面） */
type ReplyFrame = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { code: unknown; message: unknown } };

/** ctx.net 绑定客户端（bootstrap 按 CONSTELLA_NET_WS 在场装配；关闭面归宿主进程收尾） */
export class NetCapClient implements NetCap {
  private readonly endpoint: string;
  private readonly fetchTimeoutMs: number;
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private closed = false;

  constructor(endpoint: string, options: NetCapOptions = {}) {
    this.endpoint = endpoint;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_NET_FETCH_TIMEOUT_MS;
  }

  async fetch(url: string, init?: { headers?: Record<string, string> }): Promise<NetFetchResponse> {
    const ws = await this.ensureOpen();
    const params: Record<string, unknown> = { url };
    if (init?.headers !== undefined) params.headers = init.headers;
    return new Promise<NetFetchResponse>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SdkNetError(CODE_BRIDGE_TIMEOUT, `net 桥请求超时（>${this.fetchTimeoutMs}ms）: ${url}`));
      }, this.fetchTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      // id 连接内单调递增（T0-07 客户端义务）
      ws.send(JSON.stringify({ id, ns: 'net', method: 'fetch', params }));
    });
  }

  /** 显式关闭（测试/收尾面；进程退出面=宿主强杀，无需调用）。关闭后 fetch 拒 BRIDGE-CLOSED 不再重连 */
  close(): void {
    this.closed = true;
    this.failAllPending(new SdkNetError(CODE_BRIDGE_CLOSED, 'net 客户端已关闭'));
    this.ws?.close();
    this.ws = null;
  }

  // ————————————————————————————————————————————

  /** 懒连接＋复用：OPEN 态直用；未开/已断→单飞握手（并发 fetch 共享同一次连接建立） */
  private ensureOpen(): Promise<WebSocket> {
    if (this.closed) {
      return Promise.reject(new SdkNetError(CODE_BRIDGE_CLOSED, 'net 客户端已关闭'));
    }
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening !== null) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.endpoint);
      const settled = { done: false };
      const onOpen = (): void => {
        cleanup();
        this.attach(ws);
        this.ws = ws;
        resolve(ws);
      };
      const onFailure = (): void => {
        if (settled.done) return;
        settled.done = true;
        cleanup();
        try {
          ws.close();
        } catch {
          /* 连接失败面 close 可再抛——吞掉 */
        }
        reject(new SdkNetError(CODE_BRIDGE_CLOSED, `net 桥连接失败: ${this.endpoint}`));
      };
      const cleanup = (): void => {
        settled.done = true;
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onFailure);
        ws.removeEventListener('close', onFailure);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onFailure);
      ws.addEventListener('close', onFailure); // 连接拒绝/error 后必随 close（Node 全局 WebSocket）
    });
    const reset = (): void => {
      this.opening = null;
    };
    this.opening.then(reset, reset);
    return this.opening;
  }

  private attach(ws: WebSocket): void {
    ws.addEventListener('message', (ev: MessageEvent<unknown>) => {
      let reply: unknown;
      try {
        reply = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return; // 非 JSON 行=协议外噪声——忽略（不破连接）
      }
      if (typeof reply !== 'object' || reply === null) return;
      const rec = reply as { id?: unknown };
      if (typeof rec.id !== 'number') return;
      const pending = this.pending.get(rec.id);
      if (pending === undefined) return; // 迟回/未知 id（超时已弃）——安全丢弃
      clearTimeout(pending.timer);
      this.pending.delete(rec.id);
      const frame = reply as ReplyFrame;
      if (frame.ok === true) {
        const mapped = this.mapResult(frame.result);
        if (mapped === null) pending.reject(new SdkNetError(CODE_BRIDGE_CLOSED, 'net 桥回帧 result 形异常'));
        else if (mapped.status === 0) {
          // status===0＝网络层失败（宿主冻结语义）——statusText 即宿主网络失败描述
          pending.reject(new SdkNetError('NET-FAILED', mapped.statusText));
        } else pending.resolve(mapped);
      } else {
        const code = typeof frame.error?.code === 'string' ? frame.error.code : '';
        const message = typeof frame.error?.message === 'string' ? frame.error.message : 'net 桥错误帧';
        pending.reject(new SdkNetError(code, message)); // NET-DENIED 等宿主码原样透传（可判别）
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null;
      this.failAllPending(new SdkNetError(CODE_BRIDGE_CLOSED, 'net 桥连接已关闭'));
    });
    ws.addEventListener('error', () => {
      /* open 后 error 必随 close（Node 全局 WebSocket）——处置集中在 close 面 */
    });
  }

  /** ok result → NetFetchResponse；形异常返回 null（bodyB64 解码为 utf8 文本，非法序列替换字符） */
  private mapResult(result: unknown): NetFetchResponse | null {
    if (typeof result !== 'object' || result === null) return null;
    const r = result as Record<string, unknown>;
    if (typeof r.status !== 'number') return null;
    const headers: Record<string, string> = {};
    if (r.headers !== undefined && typeof r.headers === 'object' && r.headers !== null) {
      for (const [k, v] of Object.entries(r.headers)) if (typeof v === 'string') headers[k] = v;
    }
    const bodyB64 = typeof r.bodyB64 === 'string' ? r.bodyB64 : '';
    const body = bodyB64 === '' ? '' : Buffer.from(bodyB64, 'base64').toString('utf8');
    return { status: r.status, statusText: typeof r.statusText === 'string' ? r.statusText : '', headers, body };
  }

  private failAllPending(err: SdkNetError): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}

/** net 绑定 cap 工厂：bootstrap 按 CONSTELLA_NET_WS 在场调用（缺场=unboundCap 三态不变） */
export function makeNetCap(endpoint: string, options?: NetCapOptions): NetCapClient {
  return new NetCapClient(endpoint, options);
}
