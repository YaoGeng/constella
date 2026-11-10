// AuthSession 用例（T5-09；TDD-C-09 §1 ClientAuthSession 接口＋§3 AuthSession 行；§6.1/§6.2 相关段）。
//
// 会话存储（§1 冻结）：access=内存；refresh=SecretVault 引用键 key='market.refresh'（经
// secret:* 通道——强于 A-01 浏览器端明文存储方案）；bootstrap 静默刷新；onAuthChange 订阅；
// refresh 失效（AUTH-REFRESH-INVALID）→登出＋onAuthChange；断网（TransportError）→不登出
// （02 §1.3 登录态过期且离线行）。register=201 {user}（无令牌对，C1）→ client 串 /auth/login。
// 末段=createMarketStack 集成：401 单飞刷新＋重放经真实 doRefresh 打点（S-01 C4 一次性轮换）。
import { describe, expect, it, vi } from 'vitest';
import type { LoginRes, UserProfile } from '@constella/shared/dto';
import type { MarketRequestInit } from './market-api-client';
import { isMarketApiError, MarketApiError } from './market-error';
import { MARKET_REFRESH_KEY, createAuthSession } from './auth-session';
import type { AuthSessionDeps, ClientAuthSession } from './auth-session';
import { createMarketStack } from './index';

// ————————————————————————————————————————————
// fake secret bridge（secret:* 通道 mock——T4-08/T4-15 先例同形）＋ fake transport
// ————————————————————————————————————————————

function fakeSecret() {
  const store = new Map<string, string>();
  const ops: Array<{ op: 'set' | 'get' | 'del'; key: string }> = [];
  return {
    ops,
    store,
    bridge: {
      set: vi.fn(async ({ key, value }: { key: string; value?: string }) => {
        ops.push({ op: 'set', key });
        store.set(key, value ?? '');
        return { ok: true };
      }),
      get: vi.fn(async ({ key }: { key: string }) => {
        ops.push({ op: 'get', key });
        return { value: store.get(key) ?? null };
      }),
      del: vi.fn(async ({ key }: { key: string }) => {
        ops.push({ op: 'del', key });
        store.delete(key);
        return { ok: true };
      }),
    },
  };
}

interface SendHarness {
  deps: Omit<AuthSessionDeps, 'secret'>;
  secret: ReturnType<typeof fakeSecret>;
  calls: Array<{ path: string; method: string; headers: Record<string, string>; body?: unknown }>;
  respond(status: number, body: unknown): void;
  rejectNext(err: unknown): void;
}

function makeSessionHarness(): SendHarness {
  const calls: SendHarness['calls'] = [];
  const queue: Array<{ status: number; body: unknown } | { reject: unknown }> = [];
  const send = async <T>(path: string, init: MarketRequestInit = {}): Promise<T> => {
    calls.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const next = queue.shift();
    if (!next) throw new MarketApiError('INTERNAL', 'no queued response', 500);
    if ('reject' in next) throw next.reject;
    if (next.status >= 400) {
      throw new MarketApiError(
        'UNAUTHORIZED',
        typeof next.body === 'object' && next.body !== null && 'error' in next.body
          ? String((next.body as { error: { message: string } }).error.message)
          : 'err',
        next.status,
      );
    }
    return next.body as T;
  };
  const secret = fakeSecret();
  return {
    deps: { send },
    secret,
    calls,
    respond(status, body) {
      queue.push({ status, body });
    },
    rejectNext(err) {
      queue.push({ reject: err });
    },
  };
}

function loginBody(user = { id: 'u1', email: 'a@b.c', role: 'user' as const }): LoginRes {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', user };
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
};

function userOf(): UserProfile {
  return { id: 'u1', email: 'a@b.c', role: 'user' };
}

// ————————————————————————————————————————————

describe('AuthSession login/register（S-01 §1 端点；C1 register 不签发→串 login）', () => {
  it('login → access=内存/refresh=secret:set key=market.refresh/user 档案；onAuthChange 恰一次', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    const changed = vi.fn();
    auth.onAuthChange(changed);
    h.respond(200, loginBody());
    const user = await auth.login('a@b.c', 'pw');
    expect(user).toEqual(userOf());
    expect(auth.getAccessToken()).toBe('access-1');
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.getUser()).toEqual(userOf());
    expect(h.secret.store.get(MARKET_REFRESH_KEY)).toBe('refresh-1');
    expect(h.secret.ops.filter((o) => o.op === 'set' && o.key === MARKET_REFRESH_KEY)).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(1);
    // 请求形：POST /api/auth/login {email,password}，无 Authorization（登录原语匿名）
    expect(h.calls[0]?.path).toBe('/api/auth/login');
    expect(h.calls[0]?.method).toBe('POST');
    expect(h.calls[0]?.body).toEqual(JSON.stringify({ email: 'a@b.c', password: 'pw' }));
    expect(h.calls[0]?.headers['Authorization']).toBeUndefined();
  });

  it('login 失败（AUTH-INVALID-CREDENTIALS）→ 透传 MarketApiError，会话零写入', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    h.rejectNext(new MarketApiError('AUTH-INVALID-CREDENTIALS', 'Invalid email or password', 401, 'r1'));
    await expect(auth.login('a@b.c', 'bad')).rejects.toSatisfy(
      (e: unknown) => isMarketApiError(e) && e.code === 'AUTH-INVALID-CREDENTIALS',
    );
    expect(auth.isLoggedIn()).toBe(false);
    expect(h.secret.store.has(MARKET_REFRESH_KEY)).toBe(false);
  });

  it('register → POST /api/auth/register（201 {user}）后自动串 /auth/login（C1）', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    h.respond(201, { user: userOf() });
    h.respond(200, loginBody());
    const user = await auth.register('a@b.c', 'pw');
    expect(user).toEqual(userOf());
    expect(h.calls.map((c) => c.path)).toEqual(['/api/auth/register', '/api/auth/login']);
    expect(h.calls[0]?.body).toEqual(JSON.stringify({ email: 'a@b.c', password: 'pw' }));
    expect(auth.getAccessToken()).toBe('access-1');
    expect(h.secret.store.get(MARKET_REFRESH_KEY)).toBe('refresh-1');
  });

  it('register 邮箱占用（409 AUTH-EMAIL-TAKEN）→ 透传且不串 login', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    h.rejectNext(new MarketApiError('AUTH-EMAIL-TAKEN', 'Email already registered', 409, 'r2'));
    await expect(auth.register('a@b.c', 'pw')).rejects.toSatisfy(
      (e: unknown) => isMarketApiError(e) && e.code === 'AUTH-EMAIL-TAKEN',
    );
    expect(h.calls).toHaveLength(1);
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe('AuthSession bootstrap（静默刷新）', () => {
  function booted(h: SendHarness): ClientAuthSession {
    h.secret.store.set(MARKET_REFRESH_KEY, 'refresh-old');
    return createAuthSession({ ...h.deps, secret: h.secret.bridge });
  }

  it('vault 有 refresh → POST /auth/refresh（旧 token 一次性消费）→ 新对落位 → true', async () => {
    const h = makeSessionHarness();
    const auth = booted(h);
    const changed = vi.fn();
    auth.onAuthChange(changed);
    h.respond(200, { accessToken: 'access-2', refreshToken: 'refresh-2', user: userOf() });
    await expect(auth.bootstrap()).resolves.toBe(true);
    expect(h.calls[0]?.path).toBe('/api/auth/refresh');
    expect(h.calls[0]?.body).toEqual(JSON.stringify({ refreshToken: 'refresh-old' }));
    expect(auth.getAccessToken()).toBe('access-2');
    expect(h.secret.store.get(MARKET_REFRESH_KEY)).toBe('refresh-2'); // 一次性轮换：新 refresh 落 vault
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('vault 无 refresh → false 且零外发', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    await expect(auth.bootstrap()).resolves.toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it('refresh 失效（AUTH-REFRESH-INVALID）→ 登出（secret:del）＋onAuthChange → false', async () => {
    const h = makeSessionHarness();
    const auth = booted(h);
    const changed = vi.fn();
    auth.onAuthChange(changed);
    h.rejectNext(new MarketApiError('AUTH-REFRESH-INVALID', 'Invalid or expired refresh token', 401, 'r3'));
    await expect(auth.bootstrap()).resolves.toBe(false);
    await flush(); // logout 的 secret:del fire-and-forget
    expect(h.secret.store.has(MARKET_REFRESH_KEY)).toBe(false);
    expect(h.secret.ops.some((o) => o.op === 'del' && o.key === MARKET_REFRESH_KEY)).toBe(true);
    expect(auth.isLoggedIn()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('断网（MarketTransportError）→ false 但不登出（02 §1.3 离线行）', async () => {
    const h = makeSessionHarness();
    const auth = booted(h);
    const changed = vi.fn();
    auth.onAuthChange(changed);
    h.rejectNext(new (await import('./market-error')).MarketTransportError('network', '网络错误'));
    await expect(auth.bootstrap()).resolves.toBe(false);
    await flush();
    expect(h.secret.store.get(MARKET_REFRESH_KEY)).toBe('refresh-old'); // 未清理
    expect(h.secret.ops.some((o) => o.op === 'del')).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('AuthSession logout（§1 void 签名）', () => {
  it('logout → access 清空＋secret:del＋onAuthChange；已登录会话收口', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    h.respond(200, loginBody());
    await auth.login('a@b.c', 'pw');
    expect(auth.isLoggedIn()).toBe(true);
    const changed = vi.fn();
    auth.onAuthChange(changed);
    auth.logout();
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.getUser()).toBeNull();
    await flush();
    expect(h.secret.store.has(MARKET_REFRESH_KEY)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('未登录 logout → 幂等（不触发 onAuthChange）', async () => {
    const h = makeSessionHarness();
    const auth = createAuthSession({ ...h.deps, secret: h.secret.bridge });
    const changed = vi.fn();
    auth.onAuthChange(changed);
    auth.logout();
    await flush();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('createMarketStack 集成（401→doRefresh 单飞＋重放——S-01 C4 对端语义全链）', () => {
  it('access 过期 → mine() 401 → /auth/refresh 恰一次 → 新 access 重放恰一次 → 新 refresh 落 vault', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
    const queue: Array<Response | Error> = [];
    const doFetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
        body: init?.body,
      });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next as Response;
    };
    const secret = fakeSecret();
    const stack = createMarketStack({
      baseUrl: () => 'https://market.example',
      secret: secret.bridge,
      fetch: doFetch as unknown as typeof fetch,
    });
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    // 预置会话：vault 旧 refresh → bootstrap 静默刷新一次（access-2/refresh-2 落位）
    secret.store.set(MARKET_REFRESH_KEY, 'refresh-old');
    queue.push(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', user: userOf() }));
    await stack.auth.bootstrap();
    queue.length = 0;
    calls.length = 0;

    queue.push(json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId: 'ra' } }));
    queue.push(json(200, { accessToken: 'access-3', refreshToken: 'refresh-3', user: userOf() }));
    queue.push(json(200, { items: [], total: 0 }));

    const res = await stack.client.mine();
    expect(res.total).toBe(0);
    expect(calls.map((c) => c.url)).toEqual([
      'https://market.example/api/market/mine', // 原（旧 access）
      'https://market.example/api/auth/refresh', // 刷新恰一次（旧 refresh 一次性消费）
      'https://market.example/api/market/mine', // 重放恰一次（新 access）
    ]);
    expect(calls[0]?.headers['Authorization']).toBe('Bearer access-2');
    expect(calls[2]?.headers['Authorization']).toBe('Bearer access-3');
    expect(stack.auth.getAccessToken()).toBe('access-3');
    expect(secret.store.get(MARKET_REFRESH_KEY)).toBe('refresh-3');
  });
});
