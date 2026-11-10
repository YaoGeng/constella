// NetProxyBridge —— ctx.net 的 main 网络代理入口宿主（T5-12a / TDD-C-M1 §3 NetProxyBridge 行
// ——T0-06 会签新增组件；02 §12.1「子进程无直连出网能力、HTTP 请求一律经 main 网络代理」的直接实现）。
//
// 端点形（03 §3 组件行）：独立端点 ws://127.0.0.1:<netPort>（PortPool net 段 9321–9420 独立池
// ——不挤占 lane 段 9221–9320，T0-06 会签）、run/node 作用域（scope key=nodeRunId——spawn 粒度；
// 组件行签名 endpointOf(runKey)）、仅监听 127.0.0.1。帧形与 CdpBridge 统一（T0-07 冻结形，
// X-01 ./ipc bridge.ts）：文本帧 JSON {"id",ns:'net',method:'fetch',params} → {"id",ok,result}｜
// {"id",ok:false,error:{code,message}}；id 连接内单调递增=客户端义务（同 CdpBridge 口径——
// 服务端逐帧应答不校验）、无服务端推送帧、服务端禁用 permessage-deflate（py 侧极简客户端前提）。
//
// 白名单双层（PM 缺省①，2026-11-10 裁决冻结）：
//   - 节点门=N1 类目含「网络」（判定纯函数=net-gate.ts，装配侧接线）；
//   - 域名层=连接级 allowlist（scope=端口——到该口的连接共享该 scope 的 provision）：host 供给，
//     V1.0 缺省 ['*']（02 §14 附注「白名单来自 N1 权限类目」单层直读——类目准入即放行）；
//     未授权连接〔provision 撤销=null〕→ 任何 fetch 真拒 NET-DENIED＋台账；
//     V1.1 收缩位（设置键/定义级声明）=provision(runKey, domains) 执行点已留。
//
// fetch 线形（PM 缺省③，与 T5-12b 共享契约）：params {url, method?, headers?, bodyB64?} →
// 成功 result {status, statusText, headers, bodyB64}｜白名单拒 {code:'NET-DENIED', message}。
// fetch 执行=main 侧真发 HTTP：缺省 Node 全局 fetch（undici）——02 §12.1「一律经 main 网络代理」
// 语义=子进程无直连、请求全部经 main 进程发起（node fetch 在 main 进程执行即满足；vitest node
// 直跑可用）。Electron net 模块（Chromium 网络栈/系统代理）=V1.1 替换点——fetchImpl 注入缝已留。
// 网络失败（DNS/连接拒绝等）=in-band result {status:0,...}：T0-07 帧错误码集（shared bridge.ts）
// 无网络失败码且冻结勿扩——不新增码、不混用 NET-DENIED（白名单拒绝专属语义）；
// SDK 侧 T5-12b 按 status===0 定形为网络错误（载荷定形权随卡）。
//
// 拒绝台账（02 §12.1「拒绝事件日志可见」）：内存台账起步（形={time,domain,url}——PM 授权起步形，
// 测试断言面）＋denials() 可查询；真落 logs 表=后续卡（T5-12b/评审备注）。
import { BRIDGE_ERROR_CODES, BRIDGE_NET_METHODS } from '@constella/shared/ipc';
import { createWssServer, type BoundBridgeServer, type BridgeServerFactory, type BridgeSocket } from '../cdp/cdp-bridge';
import { CdpPortPool, type PortPoolRange } from '../cdp/port-pool';

/** net 端口段（03 §3 PortPool 行：9321–9420 独立池——NetProxyBridge 专用，T0-06 会签） */
export const NET_PORT_RANGE_MAIN: PortPoolRange = { first: 9321, last: 9420 };

/** PM 缺省①：V1.0 连接级 allowlist 缺省供给=['*']（类目准入即放行） */
const DEFAULT_NET_ALLOW: readonly string[] = ['*'];

/** net 桥 method 白名单集合（T0-07 冻结：ns='net' 仅 fetch） */
const METHOD_WHITELIST: ReadonlySet<string> = new Set(BRIDGE_NET_METHODS);

/** fetch 线形（PM 缺省③）：params 面 */
export interface NetFetchParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyB64?: string;
}

/** fetch 线形（PM 缺省③）：成功 result 面 */
export interface NetFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyB64: string;
}

/** 拒绝台账记录（内存台账起步——PM 授权形；真落 logs 表=后续卡） */
export interface NetDenialRecord {
  time: number;
  domain: string;
  url: string;
}

/** fetch 执行器返回形（窄接口——node fetch/Electron net 双实现同构） */
export interface NetFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** fetch 执行器（缺省=nodeFetchImpl；V1.1 Electron net 模块替换点） */
export type NetFetchImpl = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<NetFetchResponse>;

/** 缺省执行器：Node 全局 fetch（undici；main 进程发起=02 §12.1 代理语义） */
export async function nodeFetchImpl(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
): Promise<NetFetchResponse> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: new Uint8Array(init.body) } : {}),
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers) headers[k] = headers[k] === undefined ? v : `${headers[k]}, ${v}`;
  return { status: res.status, statusText: res.statusText, headers, body: new Uint8Array(await res.arrayBuffer()) };
}

interface NetScope {
  port: number;
  server: BoundBridgeServer;
  /** 连接级 allowlist（scope=端口；null=未授权态——provision 撤销，任何 fetch 真拒） */
  allow: ReadonlySet<string> | null;
}

/** 失败帧（T0-07 冻结形） */
function errorFrame(id: number, code: string, message: string): string {
  return JSON.stringify({ id, ok: false, error: { code, message } });
}

/** 构造依赖 */
export interface NetProxyBridgeDeps {
  /** net 池段（缺省=NET_PORT_RANGE_MAIN 9321–9420；测试注入错峰小段） */
  portRange?: PortPoolRange;
  /** fetch 执行器（缺省=nodeFetchImpl——Node 全局 fetch；Electron net 模块=V1.1 替换点） */
  fetchImpl?: NetFetchImpl;
  /** ws 服务端工厂（缺省=createWssServer——loopback-only＋禁 deflate 工厂冻结；测试注入 fake） */
  createServer?: BridgeServerFactory;
}

/**
 * NetProxyBridge（03 §3 组件行）：run/node 作用域 ws 端点管理＋net fetch 帧代理＋
 * 连接级 allowlist 执行点＋拒绝台账。端口池=CdpPortPool 参数化实例（net 段——耗尽报错
 * 沿用 CDP-PORT-EXHAUSTED 码；耗尽文案为 cdp/port-pool.ts 硬编码 CDP 措辞〔「收敛并行
 * lane 数」〕——该文件不在本卡领地，前次盘货授权注记，参数化归后续卡）。
 */
export class NetProxyBridge {
  private readonly pool: CdpPortPool;
  private readonly fetchImpl: NetFetchImpl;
  private readonly createServer: BridgeServerFactory;
  private readonly scopes = new Map<string, NetScope>();
  private readonly denialLog: NetDenialRecord[] = [];

  constructor(deps: NetProxyBridgeDeps = {}) {
    this.pool = new CdpPortPool(deps.portRange ?? NET_PORT_RANGE_MAIN);
    this.fetchImpl = deps.fetchImpl ?? nodeFetchImpl;
    this.createServer = deps.createServer ?? createWssServer;
  }

  /** 启动序（全序位次=cdp.init 后、主窗加载 renderer 前——PM 缺省②）：PortPool 预热（全段探活） */
  async init(): Promise<void> {
    await this.pool.warmUp();
  }

  /**
   * 开 scope 端点＝provision＋开口（run/node 作用域）：绑定成功才返回 endpoint——端口绑定
   * 确认（EADDRINUSE→markBusy＋次号重试，CdpSessionManager 同构）先于 env 注入，endpoint
   * 永不指向未确认口。幂等：已开 scope 返回原端点（N6 同 id 重试）；携 allowDomains 时刷新
   * provision（不携=保持现状——重试不重置收缩集）。缺省供给=['*']（PM 缺省①）。
   */
  async openScope(runKey: string, allowDomains?: readonly string[]): Promise<string> {
    const existing = this.scopes.get(runKey);
    if (existing !== undefined) {
      if (allowDomains !== undefined) existing.allow = new Set(allowDomains);
      return this.endpointOf(runKey);
    }
    let port: number;
    let server: BoundBridgeServer;
    for (;;) {
      port = this.pool.acquire();
      try {
        server = await this.createServer({ host: '127.0.0.1', port, perMessageDeflate: false });
        break;
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== 'EADDRINUSE') throw err;
        this.pool.release(port);
        this.pool.markBusy(port); // 绑定冲突跳号（N7 对策——CdpSessionManager 同构）
      }
    }
    const scope: NetScope = { port, server, allow: new Set(allowDomains ?? DEFAULT_NET_ALLOW) };
    this.scopes.set(runKey, scope);
    server.onConnection((socket) => {
      socket.onMessage((data) => {
        void this.handleFrame(scope, data, socket);
      });
    });
    return `ws://127.0.0.1:${port}`;
  }

  /**
   * 连接级 allowlist 收缩执行点（V1.1 收缩位=设置键/定义级声明，PM 缺省①留位）：
   * 供给域名集或 null（撤销——未授权态：该 scope 任何 fetch 真拒 NET-DENIED＋台账）。
   * 返回是否命中在开 scope。
   */
  provision(runKey: string, allowDomains: readonly string[] | null): boolean {
    const scope = this.scopes.get(runKey);
    if (scope === undefined) return false;
    scope.allow = allowDomains === null ? null : new Set(allowDomains);
    return true;
  }

  /** net 端点（§3 组件行签名 `endpointOf(runKey)`；未开 scope → 空串） */
  endpointOf(runKey: string): string {
    const scope = this.scopes.get(runKey);
    return scope === undefined ? '' : `ws://127.0.0.1:${scope.port}`;
  }

  /** 关 scope（未开=no-op；口还池——run 收尾接线位，C-03/后续卡） */
  async closeScope(runKey: string): Promise<void> {
    const scope = this.scopes.get(runKey);
    if (scope === undefined) return;
    this.scopes.delete(runKey);
    this.pool.release(scope.port);
    await scope.server.close();
  }

  /** 关全部 scope（退出序——全序位次=sandbox.dispose 后、cdp.destroyAllLaneWindows 前，PM 缺省②） */
  async dispose(): Promise<void> {
    const entries = [...this.scopes.values()];
    this.scopes.clear();
    for (const e of entries) this.pool.release(e.port);
    await Promise.all(entries.map((e) => e.server.close()));
  }

  /** 拒绝台账快照（可查询——形={time,domain,url} 起步；真落 logs 表=后续卡） */
  denials(): NetDenialRecord[] {
    return [...this.denialLog];
  }

  get scopeCount(): number {
    return this.scopes.size;
  }

  // ————————————————————————————————————————————

  /** 单帧代理：帧校验（CdpBridge 同构口径）→ 连接级 allowlist 执行点 → 真 fetch → 线形帧 */
  private async handleFrame(scope: NetScope, data: string, socket: BridgeSocket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // 畸形 JSON 无 id——无帧可应（连接保持；客户端超时兜底——CdpBridge 口径）
    }
    const badFrame = (message: string): void => {
      if (typeof (parsed as { id?: unknown })?.id === 'number') {
        socket.send(errorFrame((parsed as { id: number }).id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, message));
      }
    };
    if (typeof parsed !== 'object' || parsed === null) return badFrame('帧须为 JSON 对象');
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== 'number') return badFrame('帧缺 number id');
    if (rec.ns !== 'net') {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `ns 白名单外：${String(rec.ns)}`));
    }
    if (typeof rec.method !== 'string' || !METHOD_WHITELIST.has(rec.method)) {
      return void socket.send(
        errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `method 白名单外：${String(rec.method)}`),
      );
    }
    if (typeof rec.params !== 'object' || rec.params === null || Array.isArray(rec.params)) {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, 'params 须为 JSON 对象'));
    }
    const params = rec.params as Record<string, unknown>;
    if (typeof params.url !== 'string' || params.url === '') {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, 'params.url 须为非空 string'));
    }
    const url = params.url;
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `非法 url: ${url}`));
    }

    // 连接级 allowlist 执行点（PM 缺省①）：未授权连接（无 provision）与域名白名单外——真拒＋台账
    const frameId: number = rec.id; // 闭包外收窄（deny 闭包内不保 narrowing）
    const deny = (message: string): void => {
      this.denialLog.push({ time: Date.now(), domain: hostname, url });
      socket.send(errorFrame(frameId, BRIDGE_ERROR_CODES.NET_DENIED, message));
    };
    if (scope.allow === null) return deny('未授权连接（无 provision）——默认拒绝');
    if (!(scope.allow.has('*') || scope.allow.has(hostname))) {
      return deny(`域名白名单外默认拒绝: ${hostname}`);
    }

    // 白名单内 → main 侧真 fetch（02 §12.1「一律经 main 网络代理」）；响应按 PM 缺省③线形回帧
    const method = typeof params.method === 'string' && params.method !== '' ? params.method : 'GET';
    const headers: Record<string, string> = {};
    if (typeof params.headers === 'object' && params.headers !== null && !Array.isArray(params.headers)) {
      for (const [k, v] of Object.entries(params.headers)) if (typeof v === 'string') headers[k] = v;
    }
    const body =
      typeof params.bodyB64 === 'string' && params.bodyB64 !== ''
        ? new Uint8Array(Buffer.from(params.bodyB64, 'base64'))
        : undefined;
    let result: NetFetchResult;
    try {
      const res = await this.fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}) });
      result = {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        bodyB64: Buffer.from(res.body).toString('base64'),
      };
    } catch (err) {
      // 网络失败=in-band status=0（T0-07 码集无网络失败码——不扩冻结集；T5-12b 按 status===0 定形）
      result = {
        status: 0,
        statusText: `网络失败: ${err instanceof Error ? err.message : String(err)}`,
        headers: {},
        bodyB64: '',
      };
    }
    socket.send(JSON.stringify({ id: rec.id, ok: true, result }));
  }
}
