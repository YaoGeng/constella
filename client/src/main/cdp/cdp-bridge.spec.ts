// CdpBridge ws 服务端单测（T4-18 / TDD-C-M1 §3 CdpBridge 行；帧协议=T0-07 会签冻结形
// X-01 ./ipc bridge.ts——renderer CommandTransport〔T4-05〕同桥对端，方案 A，M4 PM 裁决 3）。
//
// 本套件 node 直跑真 ws（服务端=本组件缺省 'ws' 包工厂；客户端=ws 包）——帧形/白名单/错误映射
// 逐字对端断言；真 electron 链（webContents.debugger 代理）归 head-run 套件。
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  CdpBridge,
  createWssServer,
  type BridgeListenOptions,
  type BridgeServerFactory,
  type CdpCommandTarget,
} from './cdp-bridge';

/** 真连接客户端：发一帧收一帧（id 关联） */
class BridgeClient {
  private static nextSeq = 1;
  private readonly ws: WebSocket;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private closed = false;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { id: number } & Record<string, unknown>;
      const waiter = this.pending.get(frame.id);
      if (waiter === undefined) return;
      this.pending.delete(frame.id);
      waiter.resolve(frame);
    });
    this.ws.on('close', () => {
      this.closed = true;
      for (const w of this.pending.values()) w.reject(new Error('connection closed'));
      this.pending.clear();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  /** params 按传入原样上帧（畸形面用非对象值） */
  send(ns: string, method: string, params: unknown, id?: number): Promise<unknown> {
    const frameId = id ?? BridgeClient.nextSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(frameId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: frameId, ns, method, params }));
    });
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.ws.close();
  }
}

/** 捕获服务端构造参数的工厂（真 ws server；BridgeListenOptions 断言面） */
function makeOptionsCapturingFactory(): { captured: BridgeListenOptions[]; factory: BridgeServerFactory } {
  const captured: BridgeListenOptions[] = [];
  return {
    captured,
    factory: async (options) => {
      captured.push(options);
      return createWssServer(options);
    },
  };
}

/** echo 命令靶（method/params 原样回显） */
const echoTarget: CdpCommandTarget = {
  async sendCommand(method: string, params: Record<string, unknown>) {
    return { echoed: true, method, params };
  },
};

const bridgesToClose: CdpBridge[] = [];
const clientsToClose: BridgeClient[] = [];
const extraPorts: number[] = [];
afterAll(async () => {
  for (const c of clientsToClose) c.close();
  await Promise.all(bridgesToClose.map((b) => b.closeAll()));
});

/** 独立端口开桥＋lane（测试段 97xx 与 lane 池段 9221–9320 隔离） */
async function openBridgeWithLane(laneKey = 'lane-a'): Promise<{ bridge: CdpBridge; port: number }> {
  const bridge = new CdpBridge();
  bridgesToClose.push(bridge);
  extraPorts.push(9710 + extraPorts.length);
  const port = extraPorts[extraPorts.length - 1]!;
  await bridge.openLane(laneKey, port, () => echoTarget);
  return { bridge, port };
}

describe('T0-07 冻结帧形（逐字对端）', () => {
  it('请求 {"id",ns:"cdp","method","params"} → {"id",ok:true,result}（id 原样关联、result 透传）', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    const frame = (await client.send('cdp', 'Page.enable', { a: 1 }, 42)) as Record<string, unknown>;
    expect(frame).toEqual({
      id: 42,
      ok: true,
      result: { echoed: true, method: 'Page.enable', params: { a: 1 } },
    });
  });

  it('同连接多帧 id 各归各（乱序回包按 id 关联）', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    const first = client.send('cdp', 'Page.enable', {}, 100);
    const second = client.send('cdp', 'Runtime.evaluate', { expression: '1+1' }, 101);
    expect(((await second) as Record<string, unknown>).id).toBe(101);
    expect(((await first) as Record<string, unknown>).id).toBe(100);
  });
});

describe('ns 与 method 双白名单（白名单外=BRIDGE-BAD-FRAME）', () => {
  it('method 白名单外（Browser.getVersion）→ {"id",ok:false,error:{code:"BRIDGE-BAD-FRAME"}}', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    const frame = (await client.send('cdp', 'Browser.getVersion', {}, 7)) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('BRIDGE-BAD-FRAME');
  });

  it('ns!="cdp"（net 帧）→ BRIDGE-BAD-FRAME', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    const frame = (await client.send('net', 'fetch', { url: 'http://x' }, 8)) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('BRIDGE-BAD-FRAME');
  });

  it('params 非对象（字符串）→ BRIDGE-BAD-FRAME', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    const frame = (await client.send('cdp', 'Page.enable', 'oops', 9)) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('BRIDGE-BAD-FRAME');
  });
});

describe('帧错误映射（T0-07 帧错误码集）', () => {
  it('靶不可用（会话已销毁）→ CDP-SESSION-NOT-FOUND', async () => {
    const bridge = new CdpBridge();
    bridgesToClose.push(bridge);
    let alive = true;
    await bridge.openLane('lane-x', 9781, () => (alive ? echoTarget : undefined));
    const client = new BridgeClient(9781);
    clientsToClose.push(client);
    await client.opened();
    alive = false; // 会话销毁后 provider → undefined
    const frame = (await client.send('cdp', 'Page.enable', {}, 11)) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('CDP-SESSION-NOT-FOUND');
  });

  it('sendCommand 抛错 → CDP-COMMAND-FAILED（message 保留）', async () => {
    const bridge = new CdpBridge();
    bridgesToClose.push(bridge);
    await bridge.openLane('lane-y', 9784, () => ({
      sendCommand: async () => {
        throw new Error('Debugger is attached by another client');
      },
    }));
    const client = new BridgeClient(9784);
    clientsToClose.push(client);
    await client.opened();
    const frame = (await client.send('cdp', 'Runtime.evaluate', {}, 12)) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('CDP-COMMAND-FAILED');
    expect(frame.error?.message).toContain('Debugger is attached');
  });

  it('畸形 JSON 帧（无 id）→ 连接不断，后续合法帧正常应答（无响应帧可造——超时兜底归客户端）', async () => {
    const { port } = await openBridgeWithLane();
    const client = new BridgeClient(port);
    clientsToClose.push(client);
    await client.opened();
    client.sendRaw('this is not json');
    const frame = (await client.send('cdp', 'Page.enable', {}, 13)) as Record<string, unknown>;
    expect(frame).toMatchObject({ id: 13, ok: true });
  });
});

describe('服务端安全面（02 §12.3：仅监听 127.0.0.1；T0-07：禁用 permessage-deflate）', () => {
  it('ws 服务端监听参数=host 127.0.0.1＋perMessageDeflate:false（py 侧极简客户端前提）', async () => {
    const cap = makeOptionsCapturingFactory();
    const bridge = new CdpBridge(cap.factory);
    bridgesToClose.push(bridge);
    await bridge.openLane('lane-opt', 9787, () => echoTarget);
    expect(cap.captured).toEqual([{ host: '127.0.0.1', perMessageDeflate: false, port: 9787 }]);
  });

  it('endpointOf(laneKey)=ws://127.0.0.1:<lanePort>；未知 lane → 空串', async () => {
    const { bridge, port } = await openBridgeWithLane('lane-ep');
    expect(bridge.endpointOf('lane-ep')).toBe(`ws://127.0.0.1:${port}`);
    expect(bridge.endpointOf('unknown')).toBe('');
  });
});

describe('lane 生命周期（openLane/closeLane/closeAll）', () => {
  it('端口被占（EADDRINUSE）→ openLane reject code=EADDRINUSE（调用方跳号重试——PortPool markBusy 面）', async () => {
    const { WebSocketServer } = await import('ws');
    const holder = new WebSocketServer({ host: '127.0.0.1', port: 9790, perMessageDeflate: false });
    const bridge = new CdpBridge();
    bridgesToClose.push(bridge);
    await expect(bridge.openLane('lane-busy', 9790, () => echoTarget)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    await new Promise<void>((r) => holder.close(() => r()));
  });

  it('closeLane 后连接关闭、端口释放（新 server 可绑同口）', async () => {
    const bridge = new CdpBridge();
    bridgesToClose.push(bridge);
    await bridge.openLane('lane-c', 9793, () => echoTarget);
    const client = new BridgeClient(9793);
    clientsToClose.push(client);
    await client.opened();
    await bridge.closeLane('lane-c');
    await new Promise<void>((r) => setTimeout(r, 300));
    expect(client.isClosed).toBe(true);
    const rebind = new (await import('ws')).WebSocketServer({ host: '127.0.0.1', port: 9793 });
    await new Promise<void>((r) => rebind.close(() => r())); // 同口可绑=已释放
  });

  it('openLane/closeLane 幂等观测：laneCount 随开合（closeLane 未开 lane=无操作）', async () => {
    const bridge = new CdpBridge();
    bridgesToClose.push(bridge);
    expect(bridge.laneCount).toBe(0);
    await bridge.openLane('lane-n', 9796, () => echoTarget);
    expect(bridge.laneCount).toBe(1);
    await bridge.closeLane('lane-n');
    await bridge.closeLane('lane-n'); // 幂等
    expect(bridge.laneCount).toBe(0);
  });
});
