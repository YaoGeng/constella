// CdpSessionManager 执行面单测（T4-18 / TDD-C-M1 §3 CdpSessionManager 行；mock electron 面
// ——真 electron 头跑归 head-run 套件）。断言面：
//   createSession 全序（隐藏窗〔partition=persist:<前缀>·<label>〕→about:blank 先于 attach→
//   attach('1.3')→桥端点→先导航〔坑①〕：Page.enable→Page.navigate→loadEventFired→readyState 轮询〔坑④〕→台账 upsert）；
//   CDP-ATTACH-FAILED／端口绑定冲突跳号／耗尽 CDP-PORT-EXHAUSTED；
//   navigate 复用只更新 URL（不新建窗）／CDP-SESSION-NOT-FOUND／CDP-NAV-FAILED（errorText＋事件超时）；
//   destroyRun 幂等（窗毁/桥关/口还池/台账 close）／destroyAllLaneWindows；probe in-band；
//   openViewer（未知 lane 拒）；listSessions 投影；laneMemory（KB→bytes）。
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CreateSessionReq, NavigateReq } from '@constella/shared/ipc';
import { CdpChannelError } from './errors';
import type { CdpBridgeFace } from './cdp-bridge';
import { CdpSessionManager, type CdpBrowserWindowConstructor } from './cdp-session-manager';
import type { LaneLedgerRecord } from './lanes-ledger';
import { CdpPortPool } from './port-pool';

// ————————————————————————————————————————————
// mock electron 面（窗口/debugger）
// ————————————————————————————————————————————

type MessageListener = (event: unknown, method: string, params: unknown) => void;

class MockDebugger {
  readonly attachCalls: string[] = [];
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  attached = false;
  detachCalls = 0;
  private readonly listeners = new Map<string, MessageListener[]>();
  /** 命令应答脚本（按调用序）；返回 Error 即 throw */
  script: (method: string, params: Record<string, unknown>, call: number) => unknown = () => ({});

  attach(protocolVersion?: string): void {
    if (this.attached) throw new Error('Debugger is already attached to the target');
    this.attached = true;
    this.attachCalls.push(protocolVersion ?? '(default)');
  }

  detach(): void {
    this.detachCalls += 1;
    this.attached = false;
  }

  on(event: 'message' | 'detach', listener: MessageListener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  removeListener(event: string, listener: MessageListener): void {
    const list = (this.listeners.get(event) ?? []).filter((l) => l !== listener);
    this.listeners.set(event, list);
  }

  emit(method: string, params: unknown): void {
    for (const l of [...(this.listeners.get('message') ?? [])]) l({}, method, params);
  }

  async sendCommand(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.commands.push({ method, params });
    const res = this.script(method, params, this.commands.length - 1);
    if (res instanceof Error) throw res;
    return res;
  }
}

class MockWebContents {
  readonly debugger = new MockDebugger();
  readonly loadUrls: string[] = [];
  osPid = 4242;
  /** Runtime.evaluate 'document.readyState' 应答序列（多值按轮询逐消费，余 1 值后恒取末值） */
  readyStates: string[] = ['complete'];

  constructor() {
    // 缺省导航脚本：Page.navigate 应答 frameId＋异步派发 loadEventFired（坑④事件源）
    this.debugger.script = (method, params, call) => {
      if (method === 'Page.navigate') {
        queueMicrotask(() => this.debugger.emit('Page.loadEventFired', {}));
        return { frameId: `F${call}` };
      }
      if (method === 'Runtime.evaluate' && params.expression === 'document.readyState') {
        const v = this.readyStates.length > 1 ? (this.readyStates.shift() as string) : this.readyStates[0]!;
        return { result: { value: v } };
      }
      return {};
    };
  }

  async loadURL(url: string): Promise<void> {
    this.loadUrls.push(url);
  }

  getURL(): string {
    return this.loadUrls[this.loadUrls.length - 1] ?? 'about:blank';
  }

  getOSProcessId(): number {
    return this.osPid;
  }
}

class MockWindow {
  readonly webContents = new MockWebContents();
  destroyed = false;
  constructor(readonly options: Record<string, unknown> | undefined) {}
  destroy(): void {
    this.destroyed = true;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

/** 窗口构造面 mock（记录全部创建参数） */
function makeBrowserWindow() {
  const created: MockWindow[] = [];
  function ctor(this: unknown, options?: Record<string, unknown>): MockWindow {
    const w = new MockWindow(options);
    created.push(w);
    return w;
  }
  return { created, ctor: ctor as unknown as CdpBrowserWindowConstructor };
}

// ————————————————————————————————————————————
// 组装面
// ————————————————————————————————————————————

interface MakeOpts {
  poolRange?: { first: number; last: number };
  failFirstBridgeBindPorts?: number[];
  flowIdOfRun?: (runId: string) => string;
  navTimeoutMs?: number;
}

const VIEWER_CALLS: Array<{ laneKey: string; url: string }> = [];

/** Fake 桥（无真实端口绑定——真 ws 帧协议归 cdp-bridge.spec；EADDRINUSE 可注入） */
function makeFakeBridge(failPorts: number[] = []): CdpBridgeFace & { openLaneCalls: number[] } {
  const openLaneCalls: number[] = [];
  const lanes = new Map<string, number>();
  const failing = new Set(failPorts);
  return {
    openLaneCalls,
    async openLane(laneKey, port) {
      openLaneCalls.push(port);
      if (failing.delete(port)) throw { code: 'EADDRINUSE', message: `port ${port} in use (fake)` };
      lanes.set(laneKey, port);
      return port;
    },
    async closeLane(laneKey) {
      lanes.delete(laneKey);
    },
    async closeAll() {
      lanes.clear();
    },
    endpointOf(laneKey) {
      const p = lanes.get(laneKey);
      return p === undefined ? '' : `ws://127.0.0.1:${p}`;
    },
    get laneCount() {
      return lanes.size;
    },
  };
}

function makeManager(opts: MakeOpts = {}) {
  const bw = makeBrowserWindow();
  const pool = new CdpPortPool(opts.poolRange ?? { first: 9600, last: 9610 }, async () => false);
  const bridge = makeFakeBridge(opts.failFirstBridgeBindPorts);
  const lanes = {
    upserts: [] as LaneLedgerRecord[],
    closes: [] as string[],
    rows: new Map<string, LaneLedgerRecord>(),
    upsert(rec: LaneLedgerRecord): void {
      this.upserts.push({ ...rec });
      this.rows.set(rec.id, { ...rec });
    },
    close(id: string): void {
      this.closes.push(id);
      const row = this.rows.get(id);
      if (row !== undefined) this.rows.set(id, { ...row, status: 'closed' });
    },
    listByRun(runId: string): LaneLedgerRecord[] {
      return [...this.rows.values()].filter((r) => r.runId === runId && r.status !== 'closed');
    },
  };
  VIEWER_CALLS.length = 0;
  const manager = new CdpSessionManager({
    browserWindow: bw.ctor,
    bridge,
    portPool: pool,
    viewers: { openViewer: (o) => VIEWER_CALLS.push(o) },
    lanes,
    flowIdOfRun: opts.flowIdOfRun,
    navTimeoutMs: opts.navTimeoutMs ?? 2000,
  });
  return { manager, bw, pool, bridge, lanes };
}

function createReq(over: Partial<CreateSessionReq> = {}): CreateSessionReq {
  return { runId: 'r-1', laneKey: 'n-1', label: 'lane-主', startUrl: 'http://127.0.0.1:1/page', ...over };
}

const navigateReq = (over: Partial<NavigateReq> = {}): NavigateReq => ({ runId: 'r-1', laneKey: 'n-1', url: 'http://127.0.0.1:2/next', ...over });

describe('createSession 全序（C-M1 §3 行：隐藏窗→attach 1.3→桥端点→先导航→台账）', () => {
  it('窗口=show:false＋partition=persist:<flowId>·<label>；loadURL(about:blank) 先于 attach(1.3)', async () => {
    const { manager, bw } = makeManager({ flowIdOfRun: (rid) => `flow-of-${rid}` });
    const res = await manager.createSession(createReq());
    expect(res).toEqual({ port: 9600, partition: 'persist:flow-of-r-1·lane-主' });
    const win = bw.created[0]!;
    const webPrefs = (win.options as { webPreferences: Record<string, unknown> }).webPreferences;
    expect((win.options as { show?: boolean }).show).toBe(false);
    expect(webPrefs.partition).toBe('persist:flow-of-r-1·lane-主');
    expect(webPrefs.contextIsolation).toBe(true);
    expect(webPrefs.nodeIntegration).toBe(false);
    expect(win.webContents.debugger.attachCalls).toEqual(['1.3']);
    // 坑①：attach 前先有 renderer（about:blank 载入）；导航 startUrl 走 CDP Page.navigate
    // （自动化同通道——非 loadURL）
    expect(win.webContents.loadUrls).toEqual(['about:blank']);
    const seq = win.webContents.debugger.commands.map((c) => c.method);
    expect(seq.indexOf('Page.enable')).toBeLessThan(seq.indexOf('Page.navigate'));
    const nav = win.webContents.debugger.commands.find((c) => c.method === 'Page.navigate');
    expect(nav?.params).toEqual({ url: 'http://127.0.0.1:1/page' });
  });

  it('flowIdOfRun 未注入 → 缺省以 runId 为 partition 前缀（T4-20 注入 runs DAO 前的装配位）', async () => {
    const { manager } = makeManager();
    const res = await manager.createSession(createReq());
    expect(res.partition).toBe('persist:r-1·lane-主');
  });

  it('坑④：navigate=Page.enable→Page.navigate→等 loadEventFired→readyState 轮询兜底（loading→complete 两查）', async () => {
    const made = makeManager();
    await made.manager.createSession(createReq());
    const wc = made.bw.created[0]!.webContents;
    wc.readyStates = ['loading', 'complete'];
    wc.debugger.commands.length = 0;
    await made.manager.navigate(navigateReq());
    const evals = wc.debugger.commands.filter((c) => c.method === 'Runtime.evaluate');
    expect(evals.length).toBeGreaterThanOrEqual(2); // loading→complete 轮询
  });

  it('台账 upsert（lanes 事务点）：id=laneKey/runId/label/cdpPort/partition/lastUrl/status=open', async () => {
    const { manager, lanes } = makeManager();
    await manager.createSession(createReq());
    expect(lanes.upserts).toEqual([
      {
        id: 'n-1',
        runId: 'r-1',
        label: 'lane-主',
        cdpPort: 9600,
        partition: 'persist:r-1·lane-主',
        lastUrl: 'http://127.0.0.1:1/page',
        status: 'open',
      },
    ]);
  });
});

describe('createSession 失败面（§1 矩阵错误码）', () => {
  it('attach 抛错（真实注入）→ CDP-ATTACH-FAILED；窗销毁、端口还池（后续 createSession 复用同口）', async () => {
    const bw = makeBrowserWindow();
    const pool = new CdpPortPool({ first: 9600, last: 9601 }, async () => false);
    const bridge = makeFakeBridge();
    let failAttach = true;
    function hookCtor(this: unknown, options?: Record<string, unknown>): MockWindow {
      const w = new MockWindow(options);
      if (failAttach) {
        w.webContents.debugger.attach = (): void => {
          throw new Error('Another debugger is attached');
        };
      }
      bw.created.push(w);
      return w;
    }
    const manager = new CdpSessionManager({
      browserWindow: hookCtor as unknown as CdpBrowserWindowConstructor,
      bridge,
      portPool: pool,
      navTimeoutMs: 500,
    });
    const err: unknown = await manager.createSession(createReq()).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CdpChannelError);
    if (err instanceof CdpChannelError) {
      expect(err.code).toBe('CDP-ATTACH-FAILED');
      expect(err.message).toContain('Another debugger is attached');
    }
    expect(bw.created[0]!.destroyed).toBe(true);
    expect(pool.available).toBe(2); // 端口已还池
    failAttach = false;
    const res = await manager.createSession(createReq({ laneKey: 'n-2' }));
    expect(res.port).toBe(9600); // 复用还池口
  });

  it('loadURL(about:blank) 挂起（navTimeoutMs 预算内）→ CDP-ATTACH-FAILED（attach 前置失败域；窗口回收）', async () => {
    const bw = makeBrowserWindow();
    function hangCtor(this: unknown, options?: Record<string, unknown>): MockWindow {
      const w = new MockWindow(options);
      w.webContents.loadURL = (): Promise<void> => new Promise<void>(() => {}); // 永不 resolve
      bw.created.push(w);
      return w;
    }
    const manager = new CdpSessionManager({
      browserWindow: hangCtor as unknown as CdpBrowserWindowConstructor,
      bridge: makeFakeBridge(),
      portPool: new CdpPortPool({ first: 9600, last: 9601 }, async () => false),
      navTimeoutMs: 100,
    });
    const err: unknown = await manager.createSession(createReq()).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (err instanceof CdpChannelError) {
      expect(err.code).toBe('CDP-ATTACH-FAILED');
      expect(err.message).toContain('about:blank');
    } else throw new Error('expected CdpChannelError');
    expect(bw.created[0]!.destroyed).toBe(true); // 窗口回收
  });

  it('端口绑定冲突（EADDRINUSE）→ markBusy 跳号取次口', async () => {
    const { manager, pool } = makeManager({ failFirstBridgeBindPorts: [9600] });
    const res = await manager.createSession(createReq());
    expect(res.port).toBe(9601);
    expect(pool.available).toBe(9); // 9600 已 markBusy 出池
  });

  it('端口池耗尽 → CDP-PORT-EXHAUSTED（无窗口创建）', async () => {
    const { manager, bw } = makeManager({ poolRange: { first: 9600, last: 9600 }, failFirstBridgeBindPorts: [9600] });
    const err: unknown = await manager.createSession(createReq()).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CdpChannelError);
    if (err instanceof CdpChannelError) expect(err.code).toBe('CDP-PORT-EXHAUSTED');
    expect(bw.created).toHaveLength(0);
  });
});

describe('navigate（A-8.1：同 lane 复用只更新 URL）', () => {
  it('复用窗口不新建；台账 lastUrl 更新；返回 {ok:true}', async () => {
    const { manager, bw, lanes } = makeManager();
    await manager.createSession(createReq());
    const res = await manager.navigate(navigateReq());
    expect(res).toEqual({ ok: true });
    expect(bw.created).toHaveLength(1);
    expect(lanes.upserts.at(-1)).toMatchObject({ id: 'n-1', lastUrl: 'http://127.0.0.1:2/next' });
  });

  it('未知 lane → CDP-SESSION-NOT-FOUND', async () => {
    const { manager } = makeManager();
    const err: unknown = await manager.navigate(navigateReq({ laneKey: 'nope' })).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (err instanceof CdpChannelError) expect(err.code).toBe('CDP-SESSION-NOT-FOUND');
    else throw new Error('expected CdpChannelError');
  });

  it('Page.navigate errorText → CDP-NAV-FAILED', async () => {
    const made = makeManager();
    await made.manager.createSession(createReq());
    const wc = made.bw.created[0]!.webContents;
    wc.debugger.script = (method) =>
      method === 'Page.navigate' ? { frameId: 'F0', errorText: 'ERR_FAILED' } : {};
    const err: unknown = await made.manager.navigate(navigateReq()).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (err instanceof CdpChannelError) {
      expect(err.code).toBe('CDP-NAV-FAILED');
      expect(err.message).toContain('ERR_FAILED');
    } else throw new Error('expected CdpChannelError');
  });

  it('loadEventFired 超时 → CDP-NAV-FAILED', async () => {
    const made = makeManager({ navTimeoutMs: 100 });
    await made.manager.createSession(createReq());
    const wc = made.bw.created[0]!.webContents;
    wc.debugger.script = (method) => (method === 'Page.navigate' ? { frameId: 'F0' } : {}); // 不派发事件
    const err: unknown = await made.manager.navigate(navigateReq()).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (err instanceof CdpChannelError) expect(err.code).toBe('CDP-NAV-FAILED');
    else throw new Error('expected CdpChannelError');
  });
});

describe('destroyRun／destroyAllLaneWindows（A-6.4/A-8.1：run 收尾统一销毁，幂等）', () => {
  it('销毁全部 lane 窗＋桥关＋口还池＋台账 close；二次调用幂等 {ok:true}', async () => {
    const { manager, bw, pool, lanes } = makeManager();
    await manager.createSession(createReq({ laneKey: 'a' }));
    await manager.createSession(createReq({ laneKey: 'b', label: '支2' }));
    expect(pool.available).toBe(9); // 段 11 口已持 2
    const res = await manager.destroyRun({ runId: 'r-1' });
    expect(res).toEqual({ ok: true });
    expect(bw.created.map((w) => w.destroyed)).toEqual([true, true]);
    expect(lanes.closes.sort()).toEqual(['a', 'b']);
    expect(pool.available).toBe(11); // 全部还池
    expect(await manager.destroyRun({ runId: 'r-1' })).toEqual({ ok: true }); // 幂等
    // destroyRun 后新建（坑②回归的 mock 半段：新会话正常建）
    const again = await manager.createSession(createReq({ laneKey: 'c' }));
    expect(again.port).toBe(9600); // 还池口复用
  });

  it('destroyAllLaneWindows 不分 run 全销（退出序）', async () => {
    const { manager, bw } = makeManager();
    await manager.createSession(createReq({ runId: 'r-1', laneKey: 'a' }));
    await manager.createSession(createReq({ runId: 'r-2', laneKey: 'b' }));
    await manager.destroyAllLaneWindows();
    expect(bw.created.map((w) => w.destroyed)).toEqual([true, true]);
    expect(manager.sessionCount).toBe(0);
  });
});

describe('probe（env:cdpProbe：in-band {ok,detail}——不 reject）', () => {
  it('无会话 → {ok:true}；会话健康 → {ok:true}', async () => {
    const { manager } = makeManager();
    expect(await manager.probe()).toEqual({ ok: true });
    await manager.createSession(createReq());
    expect(await manager.probe()).toEqual({ ok: true });
  });

  it('会话窗已毁 → {ok:false,detail 含 laneKey}（附栈探活，B-14）', async () => {
    const made = makeManager();
    await made.manager.createSession(createReq({ laneKey: 'dead-lane' }));
    made.bw.created[0]!.destroy(); // 外部销毁（如崩溃）
    const res = await made.manager.probe();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('dead-lane');
  });
});

describe('openViewer／listSessions／laneMemory（§1 矩阵投影面）', () => {
  it('openViewer=查看窗打开（laneKey＋最近 URL）；未知 lane → CDP-SESSION-NOT-FOUND', async () => {
    const { manager } = makeManager();
    await manager.createSession(createReq());
    await manager.navigate(navigateReq());
    expect(await manager.openViewer({ runId: 'r-1', laneKey: 'n-1' })).toEqual({ ok: true });
    expect(VIEWER_CALLS).toEqual([{ laneKey: 'n-1', url: 'http://127.0.0.1:2/next' }]);
    const err: unknown = await manager.openViewer({ runId: 'r-1', laneKey: 'nope' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (err instanceof CdpChannelError) expect(err.code).toBe('CDP-SESSION-NOT-FOUND');
    else throw new Error('expected CdpChannelError');
  });

  it('listSessions=lanes 台账投影（无会话→[]）；占位行（cdpPort=null，nodeRunStart ensureLane）不投影——防 port=0 幽灵会话（T4-20 评审收口）', async () => {
    const { manager, lanes } = makeManager();
    expect(await manager.listSessions({ runId: 'r-1' })).toEqual([]);
    await manager.createSession(createReq());
    // 占位行：纯数据流 nodeRunStart 的 ensureLane 兜底（cdp 字段 NULL）——不进投影
    lanes.upsert({ id: 'main', runId: 'r-1', label: 'main', cdpPort: null, partition: null, lastUrl: null, status: 'open' });
    expect(await manager.listSessions({ runId: 'r-1' })).toEqual([
      { laneKey: 'n-1', label: 'lane-主', port: 9600, url: 'http://127.0.0.1:1/page' },
    ]);
  });

  it('laneMemory=app 进程度表按 OS pid 关联（workingSetSize KB→bytes；B-9 单 lane 预算告警数据源）', async () => {
    const { manager, bw } = makeManager();
    await manager.createSession(createReq()); // 旧窗（无度表注入的 manager）
    const metrics = [
      { pid: 1, memory: { workingSetSize: 999_999 } },
      { pid: 777, memory: { workingSetSize: 2 } }, // 2KB——该 lane 的 renderer 进程
    ];
    const withMetrics = new CdpSessionManager({
      browserWindow: bw.ctor,
      bridge: makeFakeBridge(),
      portPool: new CdpPortPool({ first: 9600, last: 9601 }, async () => false),
      processMetrics: () => metrics,
    });
    await withMetrics.createSession(createReq());
    bw.created.at(-1)!.webContents.osPid = 777; // withMetrics 会话窗的 renderer pid
    const lanes = await withMetrics.laneMemory();
    expect(lanes).toEqual([{ laneKey: 'n-1', label: 'lane-主', workingSetBytes: 2 * 1024 }]);
  });
});

describe('init（PortPool 预热＋通道挂载）', () => {
  it('init 调 pool.warmUp（探活占用口记账——创建前探活）', async () => {
    const busyPorts: number[] = [];
    const pool = new CdpPortPool({ first: 9600, last: 9602 }, async (p) => {
      void busyPorts.push(p);
      return p === 9600;
    });
    const manager = new CdpSessionManager({
      browserWindow: makeBrowserWindow().ctor,
      bridge: makeFakeBridge(),
      portPool: pool,
    });
    await manager.init();
    expect(busyPorts).toEqual([9600, 9601, 9602]); // 全段扫描
    expect(pool.acquire()).toBe(9601);
  });

  it('init({registry}) 挂载 cdp 域六通道（SecretVault.init 同形——T4-15 先例）', async () => {
    const handlers = new Map<string, unknown>();
    const registry = {
      handle: (ch: string, h: (payload: unknown) => unknown): void => {
        handlers.set(ch, h);
      },
    };
    const manager = new CdpSessionManager({
      browserWindow: makeBrowserWindow().ctor,
      bridge: makeFakeBridge(),
      portPool: new CdpPortPool({ first: 9600, last: 9601 }, async () => false),
    });
    await manager.init({ registry });
    expect([...handlers.keys()].filter((c) => c.startsWith('constella:')).length).toBe(6);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
