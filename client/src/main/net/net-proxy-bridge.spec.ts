// NetProxyBridge 单测（T5-12a / 03 C-M1 §3 NetProxyBridge 行＋T0-07 冻结帧形＋PM 缺省①③）。
//
// node 直跑真 ws（服务端=复用 CdpBridge createWssServer 工厂——loopback-only＋禁 deflate，
// CdpBridge 同构）；真 fetch 往返=本地 http server 起白名单域（卡文验收口径）。
// 端口段：9361–9380（9321–9420 net 段内错峰——卡文授权段；池耗尽面用 9379–9380 两口小段）。
//
// 断言面：
//   1) 帧协议（T0-07 冻结形·CdpBridge 同构口径）：ns/method 双白名单＋malformed→BRIDGE-BAD-FRAME；
//   2) 域名层（PM 缺省①）：连接级 allowlist 执行点——V1.0 缺省 ['*']；host 供给收缩集；
//      未授权连接（无 provision）→NET-DENIED 真拒＋台账；
//   3) fetch 线形（PM 缺省③，与 T5-12b 共享契约）：params {url,method?,headers?,bodyB64?} →
//      result {status,statusText,headers,bodyB64}；网络失败=in-band status=0（T0-07 码集无网络
//      失败码——不扩冻结码集的收口，上报注记）；
//   4) 端口池：net 段独立池（缺省 9321–9420）、耗尽 CDP-PORT-EXHAUSTED（文案=CDP 措辞——
//      port-pool.ts 不在本卡领地，盘货授权注记）、warmUp 探活跳号、回收口复用；
//   5) scope 生命周期：endpointOf(runKey)（03 组件行签名）/幂等/撤销 provision/closeScope/dispose。
import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BRIDGE_ERROR_CODES } from '@constella/shared/ipc';
import { NET_PORT_RANGE_MAIN, NetProxyBridge, type NetFetchResult } from './net-proxy-bridge';

/** 本套件 net 池段（9361–9380——net 段 9321–9420 内错峰，见文件头） */
const TEST_RANGE = { first: 9361, last: 9380 };
/** 耗尽面小段（两口） */
const TINY_RANGE = { first: 9379, last: 9380 };

/** 真连接客户端：发一帧收一帧（id 关联——caps-ws.ts 裸 ws 同形） */
class NetClient {
  private static nextSeq = 1;
  private readonly ws: WebSocket;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { id: number } & Record<string, unknown>;
      const waiter = this.pending.get(frame.id);
      if (waiter === undefined) return;
      this.pending.delete(frame.id);
      waiter.resolve(frame);
    });
    this.ws.on('close', () => {
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

  send(method: string, params: unknown, id?: number): Promise<{ id: number; ok: boolean; result?: NetFetchResult; error?: { code: string; message: string } }> {
    const frameId = id ?? NetClient.nextSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(frameId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: frameId, ns: 'net', method, params }));
    });
  }

  /** ns 覆盖（白名单外用例） */
  sendNs(ns: string, method: string, params: unknown, id?: number): Promise<{ id: number; ok: boolean; error?: { code: string; message: string } }> {
    const frameId = id ?? NetClient.nextSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(frameId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: frameId, ns, method, params }));
    });
  }

  sendRaw(text: string, id = NetClient.nextSeq++): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(text);
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** 本地 http server（白名单域 127.0.0.1）——/hello、/echo（回显 method/x-probe/body b64）、404 */
interface EchoServer {
  origin: string;
  requests: Array<{ method: string; url: string; probe: string | null; body: string }>;
  close(): Promise<void>;
}

function startEchoServer(): Promise<EchoServer> {
  const requests: EchoServer['requests'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        probe: (req.headers['x-probe'] as string | undefined) ?? null,
        body: body.toString('utf8'),
      });
      if (req.url === '/hello') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('world');
      } else if (req.url === '/echo') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ method: req.method, probe: req.headers['x-probe'] ?? null, bodyB64: body.toString('base64') }));
      } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('nope');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** 外部占用某口（EADDRINUSE 探活面） */
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const bridgesToClose: NetProxyBridge[] = [];
const clientsToClose: NetClient[] = [];
const serversToClose: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of clientsToClose) c.close();
  for (const b of bridgesToClose) await b.dispose().catch(() => undefined);
  for (const s of serversToClose) await s().catch(() => undefined);
});

function makeBridge(range = TEST_RANGE): NetProxyBridge {
  const b = new NetProxyBridge({ portRange: range });
  bridgesToClose.push(b);
  return b;
}

describe('帧协议面（T0-07 冻结形·CdpBridge 同构口径）', () => {
  let bridge: NetProxyBridge;
  let endpoint: string;

  beforeAll(async () => {
    bridge = makeBridge();
    await bridge.init();
    endpoint = await bridge.openScope('r-frames:n-1', ['127.0.0.1']); // 收缩集=零外网依赖（真 fetch 往返另测）
  });

  it('ns 白名单外 → BRIDGE-BAD-FRAME', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.sendNs('cdp', 'fetch', { url: 'http://127.0.0.1/x' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME);
    expect(r.error?.message).toContain('ns 白名单外');
  });

  it('method 白名单外（ns=net 仅 fetch）→ BRIDGE-BAD-FRAME', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.send('get', { url: 'http://127.0.0.1/x' });
    expect(r.error?.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME);
    expect(r.error?.message).toContain('method 白名单外');
  });

  it('params 非对象 / url 缺失 / url 非法 → BRIDGE-BAD-FRAME', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const asParams = await c.send('fetch', ['not', 'object']);
    expect(asParams.error?.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME);
    expect(asParams.error?.message).toContain('params 须为 JSON 对象');
    const noUrl = await c.send('fetch', {});
    expect(noUrl.error?.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME);
    expect(noUrl.error?.message).toContain('url');
    const badUrl = await c.send('fetch', { url: 'not-a-url' });
    expect(badUrl.error?.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME);
    expect(badUrl.error?.message).toContain('非法 url');
  });

  it('畸形 JSON / 帧缺 number id → 无应答（连接保持——CdpBridge 口径）', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    await expect(
      Promise.race([
        c.sendRaw('{"ns":"net","method":"fetch","params":{"url":"http://127.0.0.1/x"}}'), // 无 id
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('应无应答（缺 id）')), 400)),
      ]),
    ).rejects.toThrow('应无应答');
    await expect(
      Promise.race([
        c.sendRaw('this is not json', 999),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('应无应答（畸形 JSON）')), 400)),
      ]),
    ).rejects.toThrow('应无应答');
  });
});

describe('域名层 allowlist（PM 缺省①：连接级执行点＋NET-DENIED＋台账）', () => {
  let bridge: NetProxyBridge;
  let endpoint: string;
  let echo: EchoServer;

  beforeAll(async () => {
    bridge = makeBridge();
    await bridge.init();
    echo = await startEchoServer();
    serversToClose.push(() => echo.close());
    endpoint = await bridge.openScope('r-allow:n-1', ['127.0.0.1']);
  });

  it('V1.0 缺省供给=首次 openScope 不传 allowlist → ["*"] 放行任意域（类目准入即放行——02 §14 附注单层直读）', async () => {
    const ep = await bridge.openScope('r-allow:n-star'); // 缺省 ['*']（PM 缺省①）
    const c = new NetClient(ep);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.send('fetch', { url: `${echo.origin}/hello` }); // 127.0.0.1 在 '*' 下放行
    expect(r.ok).toBe(true);
    expect(r.result?.status).toBe(200);
  });

  it('host 供给收缩集（V1.1 收缩位形态）：集内放行／集外拒 NET-DENIED＋台账 {time,domain,url}', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const ok = await c.send('fetch', { url: `${echo.origin}/hello` });
    expect(ok.ok).toBe(true);
    const denied = await c.send('fetch', { url: 'https://evil.example.net/exfil' });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe(BRIDGE_ERROR_CODES.NET_DENIED);
    expect(denied.error?.message).toContain('evil.example.net');
    const records = bridge.denials();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ domain: 'evil.example.net', url: 'https://evil.example.net/exfil' });
    expect(typeof records[0]!.time).toBe('number');
  });

  it('精确域匹配：收缩集含 localhost 不放行 127.0.0.1（hostname 精确比对）', async () => {
    bridge.provision('r-allow:n-1', ['localhost']);
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const denied = await c.send('fetch', { url: `${echo.origin}/hello` });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe(BRIDGE_ERROR_CODES.NET_DENIED);
    expect(bridge.denials().at(-1)).toMatchObject({ domain: '127.0.0.1' });
  });

  it('未授权连接（provision 撤销=null）→ 任何 fetch 真拒 NET-DENIED＋台账', async () => {
    bridge.provision('r-allow:n-1', null); // 撤销 provision——未授权态（PM 缺省①括号路径）
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const denied = await c.send('fetch', { url: `${echo.origin}/hello` });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe(BRIDGE_ERROR_CODES.NET_DENIED);
    expect(denied.error?.message).toContain('未授权');
    expect(bridge.denials().at(-1)).toMatchObject({ domain: '127.0.0.1', url: `${echo.origin}/hello` });
  });
});

describe('真 fetch 往返（本地 http server 白名单域——PM 缺省③线形）', () => {
  let bridge: NetProxyBridge;
  let endpoint: string;
  let echo: EchoServer;

  beforeAll(async () => {
    bridge = makeBridge();
    await bridge.init();
    echo = await startEchoServer();
    serversToClose.push(() => echo.close());
    endpoint = await bridge.openScope('r-fetch:n-1', ['127.0.0.1']);
  });

  it('GET：result 全形 {status,statusText,headers,bodyB64}——body b64 解码回原文', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.send('fetch', { url: `${echo.origin}/hello` });
    expect(r.ok).toBe(true);
    expect(r.result?.status).toBe(200);
    expect(r.result?.statusText).toBe('OK');
    expect(r.result?.headers?.['content-type']).toContain('text/plain');
    expect(Buffer.from(r.result?.bodyB64 ?? '', 'base64').toString('utf8')).toBe('world');
    expect(echo.requests.at(-1)?.method).toBe('GET');
  });

  it('POST＋headers＋bodyB64：请求三件真达 server（回显断言）＋响应体 b64 往返', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const bodyB64 = Buffer.from('{"a":1}', 'utf8').toString('base64');
    const r = await c.send('fetch', {
      url: `${echo.origin}/echo`,
      method: 'POST',
      headers: { 'X-Probe': 't5-12a' },
      bodyB64,
    });
    expect(r.ok).toBe(true);
    expect(r.result?.status).toBe(200);
    const echoed = JSON.parse(Buffer.from(r.result?.bodyB64 ?? '', 'base64').toString('utf8')) as {
      method: string;
      probe: string;
      bodyB64: string;
    };
    expect(echoed.method).toBe('POST');
    expect(echoed.probe).toBe('t5-12a');
    expect(Buffer.from(echoed.bodyB64, 'base64').toString('utf8')).toBe('{"a":1}');
  });

  it('非 2xx 状态真值往返（404）', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.send('fetch', { url: `${echo.origin}/missing` });
    expect(r.ok).toBe(true); // HTTP 层成功（fetch 完成）——status 真值 in-band
    expect(r.result?.status).toBe(404);
  });

  it('网络失败（不可达口）→ in-band status=0（T0-07 码集无网络失败码——不扩冻结集的收口）', async () => {
    const c = new NetClient(endpoint);
    clientsToClose.push(c);
    await c.opened();
    const r = await c.send('fetch', { url: 'http://127.0.0.1:1/nope' }); // 空口=ECONNREFUSED
    expect(r.ok).toBe(true);
    expect(r.result?.status).toBe(0);
    expect(r.result?.bodyB64).toBe('');
    expect(bridge.denials()).toHaveLength(0); // 网络失败≠白名单拒绝——台账零记
  });
});

describe('端口池 net 段（9321–9420 独立池——T0-06 会签）', () => {
  it('缺省段=9321–9420；openScope 实绑口落在段内', async () => {
    expect(NET_PORT_RANGE_MAIN).toEqual({ first: 9321, last: 9420 });
    const bridge = new NetProxyBridge(); // 缺省段
    bridgesToClose.push(bridge);
    await bridge.init();
    const ep = await bridge.openScope('r-pool:n-default');
    const port = Number(new URL(ep).port);
    expect(port).toBeGreaterThanOrEqual(9321);
    expect(port).toBeLessThanOrEqual(9420);
  });

  it('耗尽 → CDP-PORT-EXHAUSTED（文案=CDP 措辞——port-pool.ts 不在本卡领地，注记留痕）；closeScope 回收口可复用', async () => {
    const bridge = makeBridge(TINY_RANGE); // 两口
    await bridge.init();
    const a = await bridge.openScope('r-pool:n-a');
    const b = await bridge.openScope('r-pool:n-b');
    expect(new URL(a).port).not.toBe(new URL(b).port);
    await expect(bridge.openScope('r-pool:n-c')).rejects.toMatchObject({ code: 'CDP-PORT-EXHAUSTED' });
    await bridge.closeScope('r-pool:n-a');
    const reused = await bridge.openScope('r-pool:n-d');
    expect(new URL(reused).port).toBe(new URL(a).port); // 回收口复用（CdpPortPool 语义）
  });

  it('warmUp 探活：外部占用段首口 → 分配跳号（N7 对策同构）', async () => {
    // 独立子段（9371–9380）：前序 describe 的 scope 仍占着 9361 段首——occupy 须用本用例独占口
    const range = { first: 9371, last: 9380 };
    const blocker = await occupyPort(range.first);
    serversToClose.push(
      () => new Promise<void>((r) => blocker.close(() => r())),
    );
    const bridge = makeBridge(range);
    await bridge.init(); // warmUp 全段探活——9371 入 busy 记账
    const ep = await bridge.openScope('r-pool:n-skip');
    expect(Number(new URL(ep).port)).toBe(range.first + 1);
  });
});

describe('scope 生命周期（run/node 作用域——03 组件行 endpointOf(runKey)）', () => {
  it('endpointOf 未开=空串；openScope 返回 endpoint 且幂等；provision/closeScope 未开=no-op', async () => {
    const bridge = makeBridge();
    await bridge.init();
    expect(bridge.endpointOf('r-life:n-1')).toBe('');
    expect(bridge.provision('r-life:n-1', ['a.example.com'])).toBe(false); // 未开 scope
    await bridge.closeScope('r-life:n-1'); // 未开=no-op
    const ep = await bridge.openScope('r-life:n-1');
    expect(ep).toBe(bridge.endpointOf('r-life:n-1'));
    expect(ep).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    const again = await bridge.openScope('r-life:n-1'); // 幂等（N6 重试同 id 再 spawn）
    expect(again).toBe(ep);
    expect(bridge.scopeCount).toBe(1);
    expect(bridge.provision('r-life:n-1', ['x.example.com'])).toBe(true); // V1.1 收缩位执行点
    await bridge.closeScope('r-life:n-1');
    expect(bridge.endpointOf('r-life:n-1')).toBe('');
    expect(bridge.scopeCount).toBe(0);
  });

  it('dispose=closeAll：在连客户端收 close＋scopeCount 归零', async () => {
    const bridge = makeBridge();
    await bridge.init();
    const ep = await bridge.openScope('r-life:n-dispose');
    const c = new NetClient(ep);
    await c.opened();
    const closed = new Promise<void>((resolve) => {
      (c as unknown as { ws: WebSocket }).ws.once('close', () => resolve());
    });
    await bridge.dispose();
    await expect(Promise.race([closed, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('close 未到')), 3_000))])).resolves.toBeUndefined();
    expect(bridge.scopeCount).toBe(0);
  });
});
