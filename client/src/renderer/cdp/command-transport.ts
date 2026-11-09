// CommandTransport —— C-04 内置 cdp.* 命令传输 ws client 实装（T4-05；✅ M4 PM 裁决 3 冻结
// 方案 A：复用 CdpBridge ws 桥直发 `ws://127.0.0.1:<lanePort>`，与沙箱脚本 ctx.browser 同桥同安全面）。
// 帧协议＝T0-07 会签冻结形（X-01 ./ipc bridge.ts）：
//   请求文本帧 {"id",ns:'cdp',"method","params"} → {"id",ok:true,result}｜{"id",ok:false,error:{code,message}}；
//   id 连接内单调递增、无服务端推送帧（V1.0）；桥侧白名单外 method=BRIDGE-BAD-FRAME。
// renderer 侧=Chromium 原生 WebSocket client（C-M1 §3 CdpBridge ④ 的 `ws` 包是 main 侧服务端依赖，
// renderer 不引入）；WebSocketLike/工厂注入＝替换点（03 §8①），C-03 ExecDispatcher 消费。
import {
  BRIDGE_CDP_METHODS,
  BRIDGE_ERROR_CODES,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
} from '@constella/shared/ipc';

/** cdp 桥 method 面（T0-07 白名单 9 项——本卡三操作所用 Runtime.evaluate/Input.dispatchMouseEvent/DOM 系均在其内） */
export type BridgeCdpMethod = (typeof BRIDGE_CDP_METHODS)[number];

/**
 * 命令传输注入位（03 §3 CdpOps 行「CommandTransport 注入」；C-03 ExecDispatcher 的 fake 先行）。
 * send=发一帧等一响应（无服务端推送帧，V1.0 无事件订阅面）。
 */
export interface CommandTransport {
  send(method: BridgeCdpMethod, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** 帧失败（错误帧/连接断/超时）——code ∈ BRIDGE_ERROR_CODES（T0-07 帧错误码集） */
export class BridgeCommandError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeCommandError';
  }
}

/** transport 所需 WebSocket 面（原生 WebSocket 的结构子集——注入 fake 的契约形） */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: { data?: string }) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** lane 桥端点形（03 §1 冻结结论：`ws://127.0.0.1:<lanePort>`——仅监听 loopback，02 §12.3） */
export function laneBridgeUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

/** 单帧响应超时缺省（自拟规格：CDP 命令常规毫秒级、导航后就绪轮询逐帧独立计时，10s 兜底） */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

interface PendingFrame {
  resolve(value: unknown): void;
  reject(err: BridgeCommandError): void;
  timer: ReturnType<typeof setTimeout>;
}

/** ws client 实装（惰性连接：首 send 建连，open 后发帧）；socket/sendTimeoutMs 注入位=测试 fake。
 * 连接关闭（服务端断连或 close()）后本实例终结——id「连接内」单调，重连=调用方新建实例（V1.0）。 */
export function createCommandTransport(
  url: string,
  opts?: { socket?: WebSocketFactory; sendTimeoutMs?: number },
): CommandTransport {
  const factory = opts?.socket ?? ((u: string) => new WebSocket(u));
  const timeoutMs = opts?.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const pending = new Map<number, PendingFrame>();
  let socket: WebSocketLike | null = null;
  let connecting: Promise<WebSocketLike> | null = null;
  let nextId = 1;
  let closed = false;

  const failAll = (code: BridgeErrorCode, message: string): void => {
    for (const frame of pending.values()) {
      clearTimeout(frame.timer);
      frame.reject(new BridgeCommandError(code, message));
    }
    pending.clear();
  };

  /** 响应帧形守卫（T0-07 冻结形：{id,ok,result}｜{id,ok:false,error:{code,message}}；畸形帧=忽略）。
   *  ok:false 帧须带 error 对象（缺形→按畸形忽略——回调内 TypeError 防守，T4-05 评审移交②） */
  const isResponseFrame = (v: unknown): v is BridgeResponse =>
    typeof v === 'object' &&
    v !== null &&
    'id' in v &&
    typeof v.id === 'number' &&
    'ok' in v &&
    typeof v.ok === 'boolean' &&
    (((v as { ok: boolean }).ok as boolean) ||
      (typeof (v as { error?: unknown }).error === 'object' && (v as { error?: unknown }).error !== null));

  const onMessage = (ev: { data?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data ?? '');
    } catch (e) {
      if (e instanceof SyntaxError) return; // 桥保证帧形（T0-07）；异常帧忽略，超时兜底
      throw e;
    }
    if (!isResponseFrame(parsed)) return; // 畸形帧同理——超时兜底
    const waiter = pending.get(parsed.id);
    if (waiter === undefined) return; // 无匹配 id（V1.0 无推送帧约定）——超时兜底
    pending.delete(parsed.id);
    clearTimeout(waiter.timer);
    if (parsed.ok) waiter.resolve(parsed.result);
    else waiter.reject(new BridgeCommandError(parsed.error.code, parsed.error.message));
  };

  const ensureSocket = (): Promise<WebSocketLike> => {
    if (closed) {
      return Promise.reject(new BridgeCommandError(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, 'transport 已关闭'));
    }
    if (socket !== null) return Promise.resolve(socket);
    if (connecting === null) {
      connecting = (async (): Promise<WebSocketLike> => {
        const s = factory(url);
        await new Promise<void>((resolve, reject) => {
          const onClose = (): void => {
            closed = true;
            socket = null;
            connecting = null;
            reject(new BridgeCommandError(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, `lane 桥连接已关闭：${url}`));
            failAll(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, `lane 桥连接已关闭：${url}`);
          };
          s.addEventListener('open', () => resolve());
          s.addEventListener('error', () =>
            reject(new BridgeCommandError(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, `lane 桥连接失败：${url}`)),
          );
          s.addEventListener('close', onClose);
          s.addEventListener('message', onMessage);
        });
        socket = s; // open 已确认——后续 send 直连、close() 可及
        if (closed) {
          // close()-during-connecting 竞态（T4-05 评审移交①）：建连中 close 后迟到的 open
          // 不得复活已关 transport——登记引用并即关 socket（不泄漏），send 拒 BRIDGE-CLOSED
          try {
            s.close();
          } catch {
            /* best-effort：socket 侧关不作为（对端断连自然收口） */
          }
          socket = null;
          throw new BridgeCommandError(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, `lane 桥连接已关闭：${url}`);
        }
        return s;
      })();
      void connecting.catch(() => {
        connecting = null; // 建连失败可重试（未 close 前）
      });
    }
    return connecting;
  };

  return {
    async send(method, params) {
      const s = await ensureSocket();
      const id = nextId;
      nextId += 1;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeCommandError(BRIDGE_ERROR_CODES.BRIDGE_TIMEOUT, `命令响应超时（${timeoutMs}ms）：${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        s.send(JSON.stringify({ id, ns: 'cdp', method, params } satisfies BridgeRequest));
      });
    },
    close() {
      if (closed) return; // 幂等
      closed = true;
      socket?.close(); // 触发 close 事件→failAll（fake/真实一致）
      if (socket === null && connecting === null) {
        failAll(BRIDGE_ERROR_CODES.BRIDGE_CLOSED, `lane 桥连接已关闭：${url}`);
      }
    },
  };
}
