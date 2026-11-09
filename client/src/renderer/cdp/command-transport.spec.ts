// C-04 CommandTransport ws client 实装单测（T4-05；M4 PM 裁决 3 方案 A——CdpBridge 同桥直发）。
// 帧协议＝T0-07 会签冻结形（X-01 ./ipc bridge.ts，逐字对端）：
//   请求文本帧 {"id",ns:'cdp',"method","params"} → {"id",ok:true,result}｜{"id",ok:false,error:{code,message}}；
//   id 连接内单调递增、无服务端推送帧；错误码集 BRIDGE-TIMEOUT/BRIDGE-CLOSED/BRIDGE-BAD-FRAME/CDP-*。
// 真实 ws 端点=main 侧 CdpBridge（C-M1 §3，ws 包）——renderer 侧为 Chromium 原生 WebSocket client，
// 本套件经注入 WebSocketLike fake 驱动（不真连）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeCommandError,
  createCommandTransport,
  laneBridgeUrl,
  type WebSocketFactory,
  type WebSocketLike,
} from './command-transport';

/** 最小 WebSocket fake（事件驱动面＝transport 所需子集；serverOpen/serverMessage 为测试驱动面） */
class FakeWebSocket implements WebSocketLike {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(ev: { data?: string }) => void>>();
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit('close');
  }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  private emit(type: 'open' | 'message' | 'close' | 'error', ev: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(ev);
  }
  /** —— 测试驱动面（模拟服务端/网络） —— */
  serverOpen(): void {
    this.emit('open');
  }
  serverMessage(data: string): void {
    this.emit('message', { data });
  }
  serverClose(): void {
    this.emit('close');
  }
}

/** 创建 transport＋捕获的 socket；flush 让惰性连接的 open 排队帧落地 */
function makeTransport(opts?: { sendTimeoutMs?: number }) {
  const sockets: FakeWebSocket[] = [];
  const factory: WebSocketFactory = (u) => {
    const s = new FakeWebSocket(u);
    sockets.push(s);
    return s;
  };
  const transport = createCommandTransport(laneBridgeUrl(9221), {
    socket: factory,
    sendTimeoutMs: opts?.sendTimeoutMs,
  });
  const sock = (): FakeWebSocket => {
    const s = sockets[0];
    if (s === undefined) throw new Error('socket 未创建');
    return s;
  };
  const openAndFlush = async (): Promise<void> => {
    for (let i = 0; i < 5 && sockets.length === 0; i += 1) await Promise.resolve();
    sock().serverOpen();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { transport, sock, openAndFlush };
}

describe('lane 桥端点形（03 §1 冻结结论：`ws://127.0.0.1:<lanePort>`，仅 loopback）', () => {
  it('端口映射 9221→ws://127.0.0.1:9221（段尾 9320 同形）', () => {
    expect(laneBridgeUrl(9221)).toBe('ws://127.0.0.1:9221');
    expect(laneBridgeUrl(9320)).toBe('ws://127.0.0.1:9320');
  });
});

describe('T0-07 冻结帧形（bridge.ts 逐字对端）', () => {
  it('请求帧={"id",ns:"cdp","method","params"}——id 从 1 起单调递增', async () => {
    const { transport, sock, openAndFlush } = makeTransport();
    const first = transport.send('Page.enable', {});
    await openAndFlush();
    sock().serverMessage(JSON.stringify({ id: 1, ok: true, result: {} }));
    await first;
    const second = transport.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(sock().sent).toHaveLength(2);
    expect(JSON.parse(sock().sent[0] ?? '')).toEqual({ id: 1, ns: 'cdp', method: 'Page.enable', params: {} });
    expect(JSON.parse(sock().sent[1] ?? '')).toEqual({
      id: 2,
      ns: 'cdp',
      method: 'Runtime.evaluate',
      params: { expression: '1+1', returnByValue: true },
    });
    sock().serverMessage(JSON.stringify({ id: 2, ok: true, result: { result: { value: 2 } } }));
    await expect(second).resolves.toEqual({ result: { value: 2 } });
  });

  it('响应按 id 关联——乱序回包各归各请求', async () => {
    const { transport, sock, openAndFlush } = makeTransport();
    const a = transport.send('Page.enable', {});
    const b = transport.send('Page.navigate', { url: 'https://x.y' });
    await openAndFlush();
    sock().serverMessage(JSON.stringify({ id: 2, ok: true, result: { frameId: 'f2' } })); // 后发先回
    sock().serverMessage(JSON.stringify({ id: 1, ok: true, result: { enabled: true } }));
    await expect(a).resolves.toEqual({ enabled: true });
    await expect(b).resolves.toEqual({ frameId: 'f2' });
  });

  it('错误帧→reject BridgeCommandError（code/message 原样保留——白名单外 BRIDGE-BAD-FRAME 例）', async () => {
    const { transport, sock, openAndFlush } = makeTransport();
    const p = transport.send('DOM.getDocument', { depth: -1 });
    await openAndFlush();
    sock().serverMessage(
      JSON.stringify({ id: 1, ok: false, error: { code: 'BRIDGE-BAD-FRAME', message: 'method not whitelisted' } }),
    );
    const err: unknown = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BridgeCommandError);
    if (err instanceof BridgeCommandError) {
      expect(err.code).toBe('BRIDGE-BAD-FRAME');
      expect(err.message).toBe('method not whitelisted');
    }
  });
});

describe('连接故障映射（T0-07 帧错误码集）', () => {
  it('服务端断连→在途请求全部 reject BRIDGE-CLOSED', async () => {
    const { transport, sock, openAndFlush } = makeTransport();
    const a = transport.send('Page.enable', {});
    const b = transport.send('Page.navigate', { url: 'https://x.y' });
    await openAndFlush();
    sock().serverClose();
    for (const p of [a, b]) {
      await expect(p).rejects.toMatchObject({ code: 'BRIDGE-CLOSED' });
    }
  });

  it('响应超时→reject BRIDGE-TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const { transport, openAndFlush } = makeTransport({ sendTimeoutMs: 1000 });
      const p = transport.send('Page.enable', {});
      // 先装 rejection handler 再推进时钟——否则 reject 发生在 handler 挂上前被判 unhandled
      const assertion = expect(p).rejects.toMatchObject({ code: 'BRIDGE-TIMEOUT' });
      await openAndFlush();
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() 主动关闭→在途 reject BRIDGE-CLOSED，幂等', async () => {
    const { transport, openAndFlush } = makeTransport();
    const p = transport.send('Page.enable', {});
    await openAndFlush();
    transport.close();
    transport.close(); // 幂等
    await expect(p).rejects.toMatchObject({ code: 'BRIDGE-CLOSED' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
