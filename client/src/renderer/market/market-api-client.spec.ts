// MarketApiClient 用例（T5-09；TDD-C-09 §6.1＋§6.2——fake fetch 注入，零真网）。
//
// 验收锚（03 L1977-1978）：
//   §6.1 匿名 list/detail 无 Authorization 头（X-6 鉴权边界）；401→refresh 恰一次＋原请求
//   重放恰一次；并发双 401 共享同一刷新 promise（S-01 C4 一次性轮换对端语义）；refresh 失效
//   →错误透传（登出+onAuthChange 归 AuthSession 用例）；
//   §6.2 未登录 download/install/publish/mine 四操作前置拦截零外发。
// 另覆盖：ErrorBody{code,requestId} 解析（02 §6.1）、超时/网络错误分类（离线判定输入枚举）、
// baseUrl 空（market.baseUrl 默认空＋首次使用引导——03 §7.3#2）。
import { describe, expect, it, vi } from 'vitest';
import type { MarketListQuery } from '@constella/shared/dto';
import {
  isMarketApiError,
  isMarketTransportError,
  isMarketUnauthorizedError,
  isMarketUnconfiguredError,
  MarketApiError,
} from './market-error';
import { createMarketApiClient } from './market-api-client';
import type { MarketApiClientDeps } from './market-api-client';

// ————————————————————————————————————————————
// fake fetch 注入（验收命令冻结：fake fetch、不用真网）
// ————————————————————————————————————————————

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface FetchHarness {
  deps: MarketApiClientDeps;
  calls: RecordedCall[];
  /** 按序弹出应答；无应答时 200 {} */
  respond(status: number, body?: unknown, headers?: Record<string, string>): void;
  respondBytes(status: number, bytes: Uint8Array): void;
  rejectNext(err: unknown): void;
  hangNext(): void;
}

function jsonRes(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeHarness(over: Partial<MarketApiClientDeps> = {}): FetchHarness {
  const calls: RecordedCall[] = [];
  const queue: Array<{ kind: 'res'; res: Response } | { kind: 'reject'; err: unknown } | { kind: 'hang' }> = [];
  const doFetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: init?.body,
    });
    const next = queue.shift();
    if (!next) return jsonRes(200, {});
    if (next.kind === 'reject') throw next.err;
    if (next.kind === 'hang') {
      // 真实 fetch 语义：挂起直至 signal abort → AbortError reject
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')));
      });
    }
    return next.res;
  };
  let access: string | null = over.getAccessToken ? null : 'old-access';
  const deps: MarketApiClientDeps = {
    baseUrl: over.baseUrl ?? (() => 'https://market.example'),
    getAccessToken: over.getAccessToken ?? (() => access),
    refreshAccessToken: over.refreshAccessToken ?? (async () => (access = 'new-access')),
    fetch: doFetch as unknown as typeof fetch,
    ...over,
  };
  // over 里可能带了自定义 getAccessToken/refreshAccessToken——上面 ?? 已让位（…over 覆盖回来）
  return {
    deps,
    calls,
    respond(status, body, headers) {
      queue.push({ kind: 'res', res: jsonRes(status, body, headers) });
    },
    respondBytes(status, bytes) {
      queue.push({
        kind: 'res',
        res: new Response(bytes.slice().buffer as ArrayBuffer, { status, headers: { 'content-type': 'application/zip' } }),
      });
    },
    rejectNext(err) {
      queue.push({ kind: 'reject', err });
    },
    hangNext() {
      queue.push({ kind: 'hang' });
    },
  };
}

/** 应答序列便捷：401 错误体（02 §6.1 统一形 {error:{code,message,requestId}}） */
function unauthorizedBody(requestId = 'req-401'): { error: { code: 'UNAUTHORIZED'; message: string; requestId: string } } {
  return { error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } };
}

// ————————————————————————————————————————————

describe('MarketApiClient §6.1 匿名浏览（X-6：list/detail 不带 Authorization）', () => {
  it('list/detail 请求无 Authorization 头——即使已登录', async () => {
    const h = makeHarness(); // getAccessToken 默认 'old-access'（登录态）
    const client = createMarketApiClient(h.deps);
    h.respond(200, { items: [], total: 0 });
    h.respond(200, { id: 'p1', versions: [] });
    await client.list({ kind: 'node', q: 'a', sort: 'downloads', page: 2, pageSize: 10 });
    await client.detail('p1');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]?.headers['Authorization']).toBeUndefined();
    expect(h.calls[1]?.headers['Authorization']).toBeUndefined();
  });

  it('list 查询参拼装：kind/q/sort/page/pageSize 全量（server zod 默认对端）', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(200, { items: [], total: 0 });
    const q: MarketListQuery = { kind: 'flow', q: '日报', sort: 'downloads', page: 3, pageSize: 50 };
    await client.list(q);
    const url = h.calls[0]?.url ?? '';
    expect(url.startsWith('https://market.example/api/market/packages?')).toBe(true);
    for (const kv of ['kind=flow', 'q=%E6%97%A5%E6%8A%A5', 'sort=downloads', 'page=3', 'pageSize=50']) {
      expect(url).toContain(kv);
    }
  });

  it('list 空参省略（undefined 不入查询串）', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(200, { items: [], total: 0 });
    await client.list();
    expect(h.calls[0]?.url).toBe('https://market.example/api/market/packages');
  });

  it('detail 404 → ErrorBody{code,requestId} 解析成类型化错误', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(404, { error: { code: 'MARKET-PACKAGE-NOT-FOUND', message: 'Package not found', requestId: 'req-9' } });
    await expect(client.detail('p-nope')).rejects.toSatisfy((e: unknown) => {
      if (!isMarketApiError(e)) return false;
      return e.code === 'MARKET-PACKAGE-NOT-FOUND' && e.status === 404 && e.requestId === 'req-9';
    });
  });

  it('错误体不可解析 → INTERNAL 兜底（仍类型化）', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(500, 'not-json', { 'content-type': 'text/plain' });
    await expect(client.list()).rejects.toSatisfy((e: unknown) => isMarketApiError(e) && e.code === 'INTERNAL');
  });
});

describe('MarketApiClient §6.1 401 单飞刷新＋原请求重放恰一次', () => {
  it('401 → refresh 恰一次＋原请求重放恰一次（Bearer=新 access）', async () => {
    const refreshAccessToken = vi.fn(async () => 'new-access');
    const h = makeHarness({ refreshAccessToken });
    const client = createMarketApiClient(h.deps);
    h.respond(401, unauthorizedBody());
    h.respond(200, { items: [], total: 0 });
    const res = await client.mine();
    expect(res.total).toBe(0);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const mineCalls = h.calls.filter((c) => c.url.endsWith('/api/market/mine'));
    expect(mineCalls).toHaveLength(2); // 原请求＋重放恰一次
    expect(mineCalls[0]?.headers['Authorization']).toBe('Bearer old-access');
    expect(mineCalls[1]?.headers['Authorization']).toBe('Bearer new-access');
  });

  it('重放再 401 → 抛错且不再刷新/不再重放（恰一次语义）', async () => {
    const refreshAccessToken = vi.fn(async () => 'new-access');
    const h = makeHarness({ refreshAccessToken });
    const client = createMarketApiClient(h.deps);
    h.respond(401, unauthorizedBody('r1'));
    h.respond(401, unauthorizedBody('r2'));
    await expect(client.mine()).rejects.toSatisfy(
      (e: unknown) => isMarketApiError(e) && e.code === 'UNAUTHORIZED' && e.requestId === 'r2',
    );
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => c.url.endsWith('/api/market/mine'))).toHaveLength(2);
  });

  it('并发双 401 → 共享同一刷新 promise（refreshAccessToken 恰一次，双请求各重放一次）', async () => {
    let release!: () => void;
    const refreshAccessToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('new-access');
        }),
    );
    const h = makeHarness({ refreshAccessToken });
    const client = createMarketApiClient(h.deps);
    h.respond(401, unauthorizedBody());
    h.respond(401, unauthorizedBody());
    h.respond(200, { items: [], total: 0 });
    h.respond(200, { items: [], total: 1 });
    const p1 = client.mine();
    const p2 = client.download('pkg-1');
    // 宏任务两拍：让两请求都走完 401 解析并进入刷新等待（refreshAccessToken 已被首调用）
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    void r1;
    void r2;
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const auths = h.calls.map((c) => c.headers['Authorization']);
    expect(auths).toEqual(['Bearer old-access', 'Bearer old-access', 'Bearer new-access', 'Bearer new-access']);
  });

  it('refresh 失效（AUTH-REFRESH-INVALID）→ 透传类型化错误', async () => {
    const refreshAccessToken = vi.fn(async () => {
      throw new MarketApiError('AUTH-REFRESH-INVALID', 'Invalid or expired refresh token', 401, 'req-r');
    });
    const h = makeHarness({ refreshAccessToken });
    const client = createMarketApiClient(h.deps);
    h.respond(401, unauthorizedBody());
    await expect(client.mine()).rejects.toSatisfy(
      (e: unknown) => isMarketApiError(e) && e.code === 'AUTH-REFRESH-INVALID',
    );
  });
});

describe('MarketApiClient §6.2 未登录四操作前置拦截零外发', () => {
  it('download/recordInstall/publishPackage/mine 未登录 → MarketUnauthorizedError 且零外发', async () => {
    const h = makeHarness({ getAccessToken: () => null });
    const client = createMarketApiClient(h.deps);
    await expect(client.download('p1')).rejects.toSatisfy(isMarketUnauthorizedError);
    await expect(client.recordInstall('p1')).rejects.toSatisfy(isMarketUnauthorizedError);
    await expect(
      client.publishPackage({ kind: 'node', name: 'n' }, { data: new Uint8Array([1]), filename: 'a.zip' }),
    ).rejects.toSatisfy(isMarketUnauthorizedError);
    await expect(client.mine()).rejects.toSatisfy(isMarketUnauthorizedError);
    expect(h.calls).toHaveLength(0); // 零外发
  });
});

describe('MarketApiClient 登录态操作形状', () => {
  it('download：GET …/:id/download 带 Bearer → 字节体返回（302 预签名 follow 后同为字节）', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respondBytes(200, new Uint8Array([1, 2, 3, 4]));
    const out = await client.download('pkg-1');
    expect(out.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    const call = h.calls[0]!;
    expect(call.url).toBe('https://market.example/api/market/packages/pkg-1/download');
    expect(call.method).toBe('GET');
    expect(call.headers['Authorization']).toBe('Bearer old-access');
  });

  it('recordInstall：POST …/:id/installs 空 JSON 体', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(200, { ok: true });
    await client.recordInstall('pkg-1');
    const call = h.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://market.example/api/market/packages/pkg-1/installs');
    expect(call.body).toBe('{}');
  });

  it('publishPackage：multipart（meta JSON 字段＋file）→ 202 PublishAccepted', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(202, { packageId: 'pkg-2', status: 'pending', perms: [], checksum: 'sha256:ab' });
    const accepted = await client.publishPackage(
      { kind: 'node', name: '汇总器', summary: 's' },
      { data: new Uint8Array([9, 9]), filename: 'pkg.zip' },
    );
    expect(accepted.status).toBe('pending');
    const call = h.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://market.example/api/market/packages');
    const form = call.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('meta')).toBe(JSON.stringify({ kind: 'node', name: '汇总器', summary: 's' }));
    expect((form.get('file') as File).name).toBe('pkg.zip');
  });

  it('mine：GET /api/market/mine 带 Bearer', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.respond(200, { items: [], total: 0 });
    await client.mine();
    expect(h.calls[0]?.url).toBe('https://market.example/api/market/mine');
    expect(h.calls[0]?.headers['Authorization']).toBe('Bearer old-access');
  });
});

describe('MarketApiClient 超时与网络错误分类（离线判定输入）', () => {
  it('超时 → MarketTransportError kind="timeout"', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.hangNext();
    await expect(client.request('/api/market/packages', { timeoutMs: 25 })).rejects.toSatisfy(
      (e: unknown) => isMarketTransportError(e) && e.kind === 'timeout',
    );
  });

  it('网络拒绝（TypeError）→ MarketTransportError kind="network"', async () => {
    const h = makeHarness();
    const client = createMarketApiClient(h.deps);
    h.rejectNext(new TypeError('fetch failed'));
    await expect(client.list()).rejects.toSatisfy(
      (e: unknown) => isMarketTransportError(e) && e.kind === 'network',
    );
  });
});

describe('MarketApiClient baseUrl 空（用户清空→引导态；默认值 2026-11-12 起为线上广场——03 §7.3#2 ⚠ 已收口）', () => {
  it('baseUrl 空/空白 → MarketUnconfiguredError 且零外发', async () => {
    const h = makeHarness({ baseUrl: () => '' });
    const client = createMarketApiClient(h.deps);
    await expect(client.list()).rejects.toSatisfy(isMarketUnconfiguredError);
    await expect(client.mine()).rejects.toSatisfy(isMarketUnconfiguredError);
    expect(h.calls).toHaveLength(0);
  });

  it('baseUrl 空白串同判定；baseUrl 带尾斜杠不产生双斜杠', async () => {
    const h1 = makeHarness({ baseUrl: () => '   ' });
    const c1 = createMarketApiClient(h1.deps);
    await expect(c1.detail('p')).rejects.toSatisfy(isMarketUnconfiguredError);

    const h2 = makeHarness({ baseUrl: () => 'https://x.example/' });
    const c2 = createMarketApiClient(h2.deps);
    h2.respond(200, { id: 'p', versions: [] });
    await c2.detail('p');
    expect(h2.calls[0]?.url).toBe('https://x.example/api/market/packages/p');
  });
});
