// T5-12b ts 侧 net 绑定客户端进程内单测（K-01 §6.1 bound 传输面——mini 桥驱动；
// bootstrap 三态子进程态在 contract.test.ts，真宿主 e2e 在 client sandbox-chain.spec.ts）。
//
// 覆盖面：
//   - bound 帧往返：ok result → NetFetchResponse（含 utf8 body 解码、headers 透传、headers 请求面上桥）；
//   - 非 2xx（404）=in-band 成功（status 真值原样）；
//   - status===0 → SdkNetError{code:'NET-FAILED'}（message=宿主 statusText）；
//   - 白名单外 → SdkNetError{code:'NET-DENIED'}（可判别）；
//   - 超时 → BRIDGE-TIMEOUT；应答前断连 → BRIDGE-CLOSED；
//   - 连接复用（多次 fetch 单连接、id 单调递增）与断连后重连（lazy reconnect）；
//   - close() 后 fetch → BRIDGE-CLOSED 不再重连。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SdkNetError, makeNetCap } from '@constella/sdk';
import { b64, startMiniNetBridge, type MiniNetBridge } from './mini-net-bridge.ts';

const OK_BODY = 'constella net ✓ 网络代理';

let bridge: MiniNetBridge;

beforeAll(async () => {
  bridge = await startMiniNetBridge({
    replies: {
      'https://ok.example.com/api': {
        ok: true,
        result: { status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-mini': '1' }, bodyB64: b64(OK_BODY) },
      },
      'https://ok.example.com/notfound': {
        ok: true,
        result: { status: 404, statusText: 'Not Found', headers: {}, bodyB64: b64('nope') },
      },
      'https://dead.example.com/unreachable': {
        ok: true,
        result: { status: 0, statusText: '网络失败: getaddrinfo ENOTFOUND dead.example.com', headers: {}, bodyB64: '' },
      },
      'https://evil.example.net/exfil': {
        ok: false,
        error: { code: 'NET-DENIED', message: '域名白名单外默认拒绝: evil.example.net' },
      },
    },
  });
});

afterAll(async () => {
  await bridge.close();
});

async function expectSdkNetError(p: Promise<unknown>, code: string, messageContains?: string): Promise<SdkNetError> {
  let caught: unknown;
  await p.then(
    () => {
      caught = new Error('应抛 SdkNetError');
    },
    (e: unknown) => {
      caught = e;
    },
  );
  expect(caught, `应抛 SdkNetError{code:${code}}`).toBeInstanceOf(SdkNetError);
  const err = caught as SdkNetError;
  expect(err.code).toBe(code);
  expect(err.name).toBe('SdkNetError'); // 错误帧 name（ts/py 同构判据）
  if (messageContains !== undefined) expect(err.message).toContain(messageContains);
  return err;
}

describe('NetCapClient（bound 帧往返——K-01 §6.1 三态②传输面）', () => {
  it('ok result → NetFetchResponse（utf8 body 解码/headers 透传/请求 headers 上桥）', async () => {
    const cap = makeNetCap(bridge.url);
    const res = await cap.fetch('https://ok.example.com/api', { headers: { 'x-probe': 'constella' } });
    expect(res).toStrictEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-mini': '1' },
      body: OK_BODY,
    });
    // 请求面：params 携 headers（PM 缺省③线形）＋id 从 1 起
    expect(bridge.requests.at(-1)?.params).toStrictEqual({ url: 'https://ok.example.com/api', headers: { 'x-probe': 'constella' } });
    expect(bridge.requests.at(-1)?.id).toBe(1);
    cap.close();
  });

  it('init 缺省 → params 仅 url（不带 headers 键）', async () => {
    const cap = makeNetCap(bridge.url);
    await cap.fetch('https://ok.example.com/api');
    expect(bridge.requests.at(-1)?.params).toStrictEqual({ url: 'https://ok.example.com/api' });
    cap.close();
  });

  it('非 2xx（404）=in-band 成功——status 真值原样返回（宿主冻结语义）', async () => {
    const cap = makeNetCap(bridge.url);
    const res = await cap.fetch('https://ok.example.com/notfound');
    expect(res.status).toBe(404);
    expect(res.statusText).toBe('Not Found');
    expect(res.body).toBe('nope');
    cap.close();
  });

  it('连接复用：两次 fetch 单连接＋id 单调递增（T0-07 客户端义务）', async () => {
    const before = bridge.connections;
    const cap = makeNetCap(bridge.url);
    await cap.fetch('https://ok.example.com/api');
    await cap.fetch('https://ok.example.com/notfound');
    expect(bridge.connections).toBe(before + 1); // 复用=不新开连接
    const ids = bridge.requests.slice(-2).map((r) => r.id);
    expect(ids).toStrictEqual([ids[0], (ids[0] as number) + 1]); // 同连接内 +1 递增
    cap.close();
  });

  it('并发 fetch 同连接多路应答（id 关联）', async () => {
    const before = bridge.connections;
    const cap = makeNetCap(bridge.url);
    const [a, b] = await Promise.all([
      cap.fetch('https://ok.example.com/api'),
      cap.fetch('https://ok.example.com/notfound'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(404);
    expect(bridge.connections).toBe(before + 1);
    cap.close();
  });
});

describe('NetCapClient 错误面（三态③＋传输层）', () => {
  it('status===0 → SdkNetError{code:NET-FAILED}（message=宿主 statusText）', async () => {
    const cap = makeNetCap(bridge.url);
    await expectSdkNetError(cap.fetch('https://dead.example.com/unreachable'), 'NET-FAILED', '网络失败: getaddrinfo');
    cap.close();
  });

  it('白名单外 → SdkNetError{code:NET-DENIED}（可判别＋宿主文案透传）', async () => {
    const cap = makeNetCap(bridge.url);
    await expectSdkNetError(cap.fetch('https://evil.example.net/exfil'), 'NET-DENIED', '域名白名单外默认拒绝');
    cap.close();
  });

  it('未脚本化 url → mini 桥默认拒（NET-DENIED 镜像白名单语义）', async () => {
    const cap = makeNetCap(bridge.url);
    await expectSdkNetError(cap.fetch('https://unknown.example.org/x'), 'NET-DENIED');
    cap.close();
  });

  it('连接失败（端点不开）→ BRIDGE-CLOSED', async () => {
    const cap = makeNetCap('ws://127.0.0.1:1'); // 不可达端口（1 号段本机不开）
    await expectSdkNetError(cap.fetch('https://ok.example.com/api'), 'BRIDGE-CLOSED', 'net 桥连接失败');
    cap.close();
  });

  it('close() 后 fetch → BRIDGE-CLOSED 不再重连', async () => {
    const cap = makeNetCap(bridge.url);
    await cap.fetch('https://ok.example.com/api');
    cap.close();
    await expectSdkNetError(cap.fetch('https://ok.example.com/api'), 'BRIDGE-CLOSED', 'net 客户端已关闭');
  });
});

describe('NetCapClient 超时/断连/重连（专用 mini 桥实例）', () => {
  it('服务端不应答 → BRIDGE-TIMEOUT（逐请求计时）', async () => {
    const silent = await startMiniNetBridge({ mode: 'silent' });
    try {
      const cap = makeNetCap(silent.url, { fetchTimeoutMs: 300 });
      await expectSdkNetError(cap.fetch('https://ok.example.com/api'), 'BRIDGE-TIMEOUT', '>300ms');
      cap.close();
    } finally {
      await silent.close();
    }
  });

  it('应答前服务端断连 → BRIDGE-CLOSED', async () => {
    const killer = await startMiniNetBridge({ mode: 'close-on-message' });
    try {
      const cap = makeNetCap(killer.url);
      await expectSdkNetError(cap.fetch('https://ok.example.com/api'), 'BRIDGE-CLOSED');
      cap.close();
    } finally {
      await killer.close();
    }
  });

  it('服务端应答后断连 → 后续 fetch 懒重连成功（新连接新 id 序列）', async () => {
    const chatty = await startMiniNetBridge({
      mode: 'close-after-reply',
      replies: {
        'https://ok.example.com/api': {
          ok: true,
          result: { status: 200, statusText: 'OK', headers: {}, bodyB64: b64('round1') },
        },
        'https://ok.example.com/api2': {
          ok: true,
          result: { status: 200, statusText: 'OK', headers: {}, bodyB64: b64('round2') },
        },
      },
    });
    try {
      const cap = makeNetCap(chatty.url);
      const first = await cap.fetch('https://ok.example.com/api');
      expect(first.body).toBe('round1');
      // 服务端已 close-after-reply：连接死面由下一次 fetch 重连吸收
      const second = await cap.fetch('https://ok.example.com/api2');
      expect(second.body).toBe('round2');
      expect(chatty.connections).toBe(2); // 重连=第二连接
      expect(chatty.requests.map((r) => r.id)).toStrictEqual([1, 2]); // id 连接内单调递增（跨连接续号同满足 T0-07 义务）
      cap.close();
    } finally {
      await chatty.close();
    }
  });
});
