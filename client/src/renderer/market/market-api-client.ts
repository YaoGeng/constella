// MarketApiClient —— client 唯一 server HTTP 出口（T5-09；TDD-C-09 §3 首行组件）。
//
// 职责（§3 行原文）：baseUrl（settings 注入）/Bearer 注入/ErrorBody（code+requestId）解析/
// 401 单飞刷新重放/超时与网络错误分类（离线判定输入）。
//
// 鉴权边界（§1 D-1/X-6）：浏览匿名——list/detail 恒不带 Authorization（即使已登录）；
// download/recordInstall/publishPackage/mine 需登录（未登录→MarketUnauthorizedError 前置拦截
// 零外发；401→单飞刷新＋原请求重放恰一次——S-01 C4 一次性轮换对端语义：并发 401 共享同一
// 刷新 promise，/auth/refresh 只被打一次）。
//
// HTTP 不经 IPC：renderer fetch 直连（02 §3.4 L259 末注）；fetch=注入位（测试 fake fetch 零真网）。
// baseUrl=settings `market.baseUrl`（默认空＋首次使用引导——03 §7.3#2；空→MarketUnconfiguredError）。
import type {
  MarketListQuery,
  MarketListRes,
  MarketMineItem,
  PackageDetail,
  PublishAccepted,
} from '@constella/shared/dto';
import {
  isMarketApiError,
  MarketTransportError,
  MarketUnauthorizedError,
  MarketUnconfiguredError,
  toMarketApiError,
} from './market-error';
import type { TransportFailureKind } from './market-error';

/** 请求选项（§3 组件级接口 request<T>(path, init) 的 init 面） */
export interface MarketRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData | Uint8Array;
  /** 登录态操作位：true=注入 Bearer＋401 单飞刷新＋未登录前置拦截（仅四操作置位） */
  auth?: boolean;
  /** 超时毫秒（默认 15000——设计值；server 契约未冻结客户端超时，装配位可放宽） */
  timeoutMs?: number;
  /** 响应体形态：json（默认）｜bytes（download 字节体——302 预签名 follow 后同为字节，S-05 §1） */
  raw?: 'json' | 'bytes';
}

/** client 依赖注入位（装配点=createMarketStack——见 index.ts） */
export interface MarketApiClientDeps {
  /** settings `market.baseUrl` 读取面（每次请求现取——设置页改址即时生效） */
  baseUrl(): string;
  /** 内存 access 读取（AuthSession.getAccessToken 注入） */
  getAccessToken(): string | null;
  /** 刷新原语（AuthSession.doRefresh 注入：vault 往返＋POST /auth/refresh；单飞归本 client） */
  refreshAccessToken(): Promise<string>;
  /** fetch 注入位（生产=window.fetch；测试=fake fetch——零真网） */
  fetch?: typeof fetch;
}

/** 登录态下载结果：字节体（§1 download「落地临时文件→路径交 C-08」归 T5-10 Installer——
 * 本卡交字节与 contentType，路径落地在其领地；显式偏离已列报告） */
export interface MarketDownloadResult {
  data: Uint8Array;
  contentType: string | null;
}

/** 发布元信息（multipart meta 字段＝server publishMetaSchema 形；name≤24/summary≤40 限额
 * 拦截在 Publisher 表单——T5-10） */
export interface MarketPublishMeta {
  kind: 'node' | 'pack' | 'flow';
  name: string;
  summary?: string;
}

/** MarketApiClient 面（§3 组件级接口 request<T>＋六端点 HTTP 面） */
export interface MarketApiClient {
  request<T>(path: string, init?: MarketRequestInit): Promise<T>;
  /** GET /api/market/packages（匿名，D-1——恒不带 Authorization） */
  list(q?: MarketListQuery): Promise<MarketListRes>;
  /** GET /api/market/packages/:id（匿名） */
  detail(id: string): Promise<PackageDetail>;
  /** GET /api/market/packages/:id/download（需登录）→ 字节体（需登录；S-05 §1 预签名 300s） */
  download(id: string): Promise<MarketDownloadResult>;
  /** POST /api/market/packages/:id/installs（需登录；幂等 userId+packageId+day——S-02） */
  recordInstall(id: string): Promise<{ ok: boolean }>;
  /** POST /api/market/packages（需登录；multipart meta+file → 202 PublishAccepted；断网队列归 T5-10） */
  publishPackage(meta: MarketPublishMeta, file: { data: Uint8Array; filename: string }): Promise<PublishAccepted>;
  /** GET /api/market/mine（需登录；全状态＋驳回理由——PRD-A13-02） */
  mine(): Promise<{ items: MarketMineItem[]; total: number }>;
}

/** 默认超时（设计值） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 单次发送（无 401 语义）：超时中止/网络拒绝→MarketTransportError；!ok→ErrorBody 类型化错误 */
async function sendOnce(
  doFetch: typeof fetch,
  url: string,
  init: MarketRequestInit,
  bearer: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: init.method ?? 'GET',
      headers,
      // TS5.9 ArrayBufferView 泛型收窄（Uint8Array<ArrayBufferLike> vs BodyInit）——运行时三态
      // （string/FormData/Uint8Array）均为合法 BodyInit，静态断言收口
      body: init.body as BodyInit | undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // 分类（离线判定输入枚举 TransportFailureKind——T5-11 消费）：本端超时中止=timeout；
    // 其余 fetch 拒绝（TypeError 网络不可达/断网等）=network
    const kind: TransportFailureKind = controller.signal.aborted ? 'timeout' : 'network';
    throw new MarketTransportError(
      kind,
      kind === 'timeout' ? `请求超时（${init.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）` : '网络错误（无法连接广场服务）',
      err,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw await toMarketApiError(res);
  }
  return res;
}

/** 成功响应体读取（json/bytes 二态） */
async function readBody<T>(res: Response, init: MarketRequestInit): Promise<T> {
  if (init.raw === 'bytes') {
    const contentType = res.headers.get('content-type');
    return { data: new Uint8Array(await res.arrayBuffer()), contentType } as unknown as T;
  }
  return (await res.json()) as T;
}

export function createMarketApiClient(deps: MarketApiClientDeps): MarketApiClient {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);

  /** 401 单飞刷新（并发共享同一 promise——S-01 C4：refresh 一次性轮换只许一发） */
  let refreshFlight: Promise<string> | null = null;
  function refreshSingleFlight(): Promise<string> {
    if (refreshFlight === null) {
      refreshFlight = deps.refreshAccessToken().finally(() => {
        refreshFlight = null;
      });
    }
    return refreshFlight;
  }

  /** 核心发送（§3 组件级接口）：baseUrl 拼装＋Bearer 注入（auth 位）＋401 单飞刷新＋重放恰一次 */
  async function request<T>(path: string, init: MarketRequestInit = {}): Promise<T> {
    const base = deps.baseUrl().trim();
    if (base === '') {
      throw new MarketUnconfiguredError(); // market.baseUrl 默认空——首次使用引导（03 §7.3#2）
    }
    const url = `${base.replace(/\/+$/, '')}${path}`;
    const bearer = init.auth === true ? deps.getAccessToken() : null;
    if (init.auth === true && bearer === null) {
      throw new MarketUnauthorizedError(); // §6.2 前置拦截——零外发
    }

    let res: Response;
    try {
      res = await sendOnce(doFetch, url, init, bearer);
    } catch (err) {
      if (init.auth === true && isMarketApiError(err) && err.status === 401) {
        // 401：单飞刷新 → 原请求重放恰一次（重放再 401 → sendOnce 直抛，不二刷）
        const fresh = await refreshSingleFlight();
        const replay = await sendOnce(doFetch, url, init, fresh);
        return readBody<T>(replay, init);
      }
      throw err;
    }
    return readBody<T>(res, init);
  }

  /** §6.2 四操作（download/recordInstall/publishPackage/mine）未登录前置拦截——零外发 */
  function requireLogin(): void {
    if (deps.getAccessToken() === null) throw new MarketUnauthorizedError();
  }

  function queryOf(q: MarketListQuery | undefined): string {
    if (q === undefined) return '';
    const params = new URLSearchParams();
    if (q.kind !== undefined) params.set('kind', q.kind);
    if (q.q !== undefined && q.q !== '') params.set('q', q.q);
    if (q.sort !== undefined) params.set('sort', q.sort);
    if (q.page !== undefined) params.set('page', String(q.page));
    if (q.pageSize !== undefined) params.set('pageSize', String(q.pageSize));
    const s = params.toString();
    return s === '' ? '' : `?${s}`;
  }

  return {
    request,
    async list(q) {
      return request<MarketListRes>(`/api/market/packages${queryOf(q)}`); // 匿名——无 Authorization
    },
    async detail(id) {
      return request<PackageDetail>(`/api/market/packages/${encodeURIComponent(id)}`); // 匿名
    },
    async download(id) {
      requireLogin();
      return request<MarketDownloadResult>(`/api/market/packages/${encodeURIComponent(id)}/download`, {
        auth: true,
        method: 'GET',
        raw: 'bytes',
      });
    },
    async recordInstall(id) {
      requireLogin();
      const r = await request<{ ok: boolean }>(`/api/market/packages/${encodeURIComponent(id)}/installs`, {
        auth: true,
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      return { ok: r.ok === true };
    },
    async publishPackage(meta, file) {
      requireLogin();
      const form = new FormData();
      form.set('meta', JSON.stringify(meta));
      form.set('file', new File([file.data.slice().buffer as ArrayBuffer], file.filename, { type: 'application/zip' }));
      return request<PublishAccepted>('/api/market/packages', { auth: true, method: 'POST', body: form });
    },
    async mine() {
      requireLogin();
      return request<{ items: MarketMineItem[]; total: number }>('/api/market/mine', {
        auth: true,
        method: 'GET',
      });
    },
  };
}
