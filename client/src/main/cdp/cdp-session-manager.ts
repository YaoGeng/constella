// CdpSessionManager —— lane 执行面（T4-18 / TDD-C-M1 §3 CdpSessionManager 行＋§1 矩阵 Cdp 行；
// TDD-C-04 §1 语义权威的实现落位）。S-3 四坑内化：
//   坑① attach 后先导航再发命令（createSession 必导航 startUrl；attach 前先 loadURL('about:blank')
//       确保 renderer 存在——空窗口发 CDP 不可靠，spike 发现 1）；
//   坑② destroyRun 统一销毁 lane 窗、窗口数可归零——window-all-closed 覆盖由 AppRuntime 兜底
//       （T4-13），本组件只管销毁（§6.2b 回归断言在 head-run）；
//   坑③ cookie 显式 expires 语义在操作面（renderer CookieSemantics/ctx.browser 文档）——本组件
//       不写 cookie（Network.setCookie 走 CdpBridge 帧代理）；
//   坑④ navigate 就绪等待=Page.enable→Page.navigate→loadEventFired（仅 enable 后派发，spike
//       发现 4）＋readyState 轮询兜底。
import {
  IPC_ERROR_CODES,
  type CreateSessionReq,
  type CreateSessionRes,
  type CdpProbeRes,
  type DestroyRunReq,
  type DestroyRunRes,
  type LaneMemory,
  type ListSessionsReq,
  type ListSessionsRes,
  type NavigateReq,
  type NavigateRes,
  type OpenViewerReq,
  type OpenViewerRes,
} from '@constella/shared/ipc';
import { CdpChannelError } from './errors';
import type { InvokeRegistry } from '../runtime/domain-channels';
import { registerCdpChannels } from './cdp-channels';
import type { CdpBridgeFace } from './cdp-bridge';
import { InMemoryLanesLedger, type LanesLedger, type LaneLedgerRecord } from './lanes-ledger';
import type { CdpPortPool } from './port-pool';

// ————————————————————————————————————————————
// electron 面（本域消费子集；生产=真实 electron——组合根装配，结构匹配）
// ————————————————————————————————————————————

/** webContents.debugger 面（attach 仅 1.2/1.3——S-3 判据 2；sendCommand 代理面） */
export interface CdpDebuggerFace {
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): void;
  removeListener(event: string, listener: (...args: never[]) => void): void;
}

/** lane 会话承载窗 webContents 面 */
export interface CdpWebContentsFace {
  readonly debugger: CdpDebuggerFace;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  /** lane 承载 renderer 进程 OS pid（laneMemory 关联键——app.getAppMetrics 按 pid 汇聚） */
  getOSProcessId?(): number;
}

/** lane 隐藏承载窗面（show:false——外部页面，安全基线同查看窗） */
export interface CdpWindowFace {
  readonly webContents: CdpWebContentsFace;
  destroy(): void;
  isDestroyed(): boolean;
}

export type CdpBrowserWindowConstructor = new (options?: Record<string, unknown>) => CdpWindowFace;

/** 查看窗原语（T4-13 交面：openViewer/置顶/✕ 只关窗） */
export interface ViewerOpenerFace {
  openViewer(options: { laneKey: string; url: string }): unknown;
}

// ————————————————————————————————————————————
// 常量
// ————————————————————————————————————————————

/** attach 协议版本（仅 1.2/1.3 受支持，S-3 判据 2；缺省 '1.3'——C-M1 §1 矩阵） */
export const CDP_ATTACH_PROTOCOL_MAIN = '1.3';

/** loadEventFired 等待缺省预算（spike 同源 15s） */
const DEFAULT_NAV_TIMEOUT_MS = 15_000;
/** readyState 轮询兜底预算（坑④；spike 同源 5s，best-effort 不放大导航失败） */
const READY_POLL_BUDGET_MS = 5_000;
const READY_POLL_INTERVAL_MS = 50;

/** partition 形=`persist:<flowId>·<laneLabel>`（S-3 判据 1——renderer LaneSessionSpec.partitionOf
 * 同公式跨层同构复制，不 import renderer〔C-M1 §2 L 边界〕） */
export function partitionOfLane(prefix: string, laneLabel: string): string {
  return `persist:${prefix}·${laneLabel}`;
}

interface LaneSession {
  laneKey: string;
  runId: string;
  label: string;
  port: number;
  partition: string;
  window: CdpWindowFace;
  url: string;
}

/** 组装依赖 */
export interface CdpSessionManagerDeps {
  browserWindow: CdpBrowserWindowConstructor;
  bridge: CdpBridgeFace;
  portPool: CdpPortPool;
  /** 查看窗原语（生产=AppRuntime.viewers——T4-13 交面） */
  viewers?: ViewerOpenerFace;
  /** lanes 台账（缺省=内存台账；生产装配 T4-20 注入 C-06 dao.lanes——§2 main 内直调） */
  lanes?: LanesLedger;
  /** partition 前缀解析（runId→flowId；生产装配 T4-20 注入 runs DAO 查询；缺省=runId——
   * 隔离不弱化〔runId 唯一〕，flow 粒度跨 run cookie 复用随 T4-20 收口） */
  flowIdOfRun?: (runId: string) => string;
  /** attach 协议版本（缺省 '1.3'） */
  attachProtocol?: string;
  /** loadEventFired 等待预算（缺省 15s） */
  navTimeoutMs?: number;
  /** 轮询延迟注入位（测试 fake；缺省真实 setTimeout） */
  delay?: (ms: number) => Promise<void>;
  /** app 进程度表（生产=app.getAppMetrics——Electron 无 per-webContents memory API，按
   * getOSProcessId 关联〔workingSetSize KB〕；01 §8.1 单 lane 预算告警数据源，B-9/M4 #7） */
  processMetrics?: () => Array<{ pid: number; memory: { workingSetSize: number } }>;
}

/**
 * CdpSessionManager（§3 组件行）：createSession/navigate/listSessions/openViewer/destroyRun/
 * probe＋init（PortPool 预热）/destroyAllLaneWindows（退出序）/laneMemory（B-9）。
 */
export class CdpSessionManager {
  private readonly sessions = new Map<string, LaneSession>();
  private readonly lanes: LanesLedger;

  constructor(private readonly deps: CdpSessionManagerDeps) {
    this.lanes = deps.lanes ?? new InMemoryLanesLedger();
  }

  /** 启动序：PortPool 预热（全段探活）＋通道挂载（registry 注入时——SecretVault.init 同形，T4-15 先例） */
  async init(options?: { registry?: InvokeRegistry }): Promise<void> {
    if (options?.registry !== undefined) registerCdpChannels(this, options.registry);
    await this.deps.portPool.warmUp();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  // ————————————————————————————————————————————
  // cdp:createSession（lane 首个 cdp.*；S-3 坑①＋§1 矩阵错误码）
  // ————————————————————————————————————————————

  async createSession(req: CreateSessionReq): Promise<CreateSessionRes> {
    const existing = this.sessions.get(req.laneKey);
    if (existing !== undefined && !existing.window.isDestroyed()) {
      // A-8.1 同 lane 复用：只更新 URL（createSession 幂等面——renderer LaneManager 语义对端）
      if (req.startUrl !== existing.url) await this.navigateToLoad(existing, req.startUrl);
      return { port: existing.port, partition: existing.partition };
    }
    if (existing !== undefined) this.sessions.delete(req.laneKey); // 窗已毁（崩溃等）——重建

    const partition = partitionOfLane(this.deps.flowIdOfRun?.(req.runId) ?? req.runId, req.label);

    // 绑定 lane 桥端点（先于建窗——耗尽/全段冲突即报，不留孤儿窗）：EADDRINUSE → markBusy＋
    // 次号重试（创建前探活冲突跳号，N7）→ 耗尽 throw CDP-PORT-EXHAUSTED（透传）
    let port: number;
    for (;;) {
      port = this.deps.portPool.acquire();
      try {
        await this.deps.bridge.openLane(req.laneKey, port, () => this.targetOf(req.laneKey));
        break;
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== 'EADDRINUSE') throw err;
        this.deps.portPool.release(port);
        this.deps.portPool.markBusy(port);
      }
    }

    const window = new this.deps.browserWindow({
      show: false, // 隐藏承载窗（C-M1 §1 矩阵）
      width: 900,
      height: 700,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // 隐藏窗不降频（spike 参数）
      },
    });

    try {
      // 坑①前提：attach 前确保 renderer 存在（S-3 发现 1）；挂起护栏=navTimeoutMs 预算内竞速
      const blankTimeoutMs = this.deps.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
      const blankGuard = new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`loadURL(about:blank) 超时（${blankTimeoutMs}ms）`)),
          blankTimeoutMs,
        );
        timer.unref?.(); // 输方计时器不拖住事件循环
      });
      await Promise.race([window.webContents.loadURL('about:blank'), blankGuard]);
      window.webContents.debugger.attach(this.deps.attachProtocol ?? CDP_ATTACH_PROTOCOL_MAIN);
    } catch (err) {
      await this.teardownSession(req.laneKey, window, port); // 还池＋关桥＋销毁窗
      throw new CdpChannelError(
        IPC_ERROR_CODES.CDP_ATTACH_FAILED,
        `lane 会话 attach 失败（${req.laneKey}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const session: LaneSession = {
      laneKey: req.laneKey,
      runId: req.runId,
      label: req.label,
      port,
      partition,
      window,
      url: req.startUrl,
    };
    this.sessions.set(req.laneKey, session);
    try {
      await this.navigateToLoad(session, req.startUrl); // 坑①：先导航再供命令（桥靶随会话存活）
    } catch (err) {
      await this.destroySession(session); // 导航失败＝会话不可用——整体回收
      throw err;
    }
    this.upsertLane(session, 'open');
    return { port, partition };
  }

  // ————————————————————————————————————————————
  // cdp:navigate（同 lane 复用只更新 URL，A-8.1）
  // ————————————————————————————————————————————

  async navigate(req: NavigateReq): Promise<NavigateRes> {
    const session = this.liveSession(req.laneKey);
    await this.navigateToLoad(session, req.url);
    session.url = req.url;
    this.upsertLane(session, 'open');
    return { ok: true };
  }

  // ————————————————————————————————————————————
  // cdp:listSessions（lanes 台账投影；无会话 in-band []）
  // ————————————————————————————————————————————

  async listSessions(req: ListSessionsReq): Promise<ListSessionsRes> {
    return this.lanes
      .listByRun(req.runId)
      .map((r) => ({ laneKey: r.id, label: r.label, port: r.cdpPort ?? 0, url: r.lastUrl ?? '' }));
  }

  // ————————————————————————————————————————————
  // cdp:openViewer（查看窗打开/置顶；✕ 只关窗不中断自动化，A-8.2）
  // ————————————————————————————————————————————

  async openViewer(req: OpenViewerReq): Promise<OpenViewerRes> {
    const session = this.liveSession(req.laneKey);
    this.deps.viewers?.openViewer({ laneKey: req.laneKey, url: session.url });
    return { ok: true };
  }

  // ————————————————————————————————————————————
  // cdp:destroyRun（run 收尾统一销毁；in-band 幂等 {ok:true}——坑②见文件头）
  // ————————————————————————————————————————————

  async destroyRun(req: DestroyRunReq): Promise<DestroyRunRes> {
    for (const session of [...this.sessions.values()]) {
      if (session.runId === req.runId) await this.destroySession(session);
    }
    return { ok: true };
  }

  /** 退出序：销毁全部 lane 窗（此阶段才允许窗口全空——AppRuntime 退出序第 3 步） */
  async destroyAllLaneWindows(): Promise<void> {
    for (const session of [...this.sessions.values()]) await this.destroySession(session);
  }

  // ————————————————————————————————————————————
  // env:cdpProbe（附栈会话探活；in-band {ok,detail}——不 reject，B-9/B-14）
  // ————————————————————————————————————————————

  async probe(): Promise<CdpProbeRes> {
    const faults: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.window.isDestroyed()) {
        faults.push(`${session.laneKey}: 窗口已销毁`);
        continue;
      }
      try {
        await session.window.webContents.debugger.sendCommand('Runtime.evaluate', {
          expression: '1',
          returnByValue: true,
        });
      } catch (err) {
        faults.push(`${session.laneKey}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return faults.length === 0 ? { ok: true } : { ok: false, detail: faults.join('；') };
  }

  /** env:systemInfo lanes 内存数组数据源（M4 #7：app 进程度表按 OS pid 关联，KB→bytes；
   *  度表缺注入/进程未上榜 → 0〔lane 仍列出——会话面完整性优先〕） */
  async laneMemory(): Promise<LaneMemory[]> {
    const metrics = this.deps.processMetrics?.() ?? [];
    const byPid = new Map(metrics.map((m) => [m.pid, m.memory.workingSetSize]));
    const out: LaneMemory[] = [];
    for (const session of this.sessions.values()) {
      if (session.window.isDestroyed()) continue;
      const pid = session.window.webContents.getOSProcessId?.();
      const kb = pid === undefined ? 0 : (byPid.get(pid) ?? 0);
      out.push({ laneKey: session.laneKey, label: session.label, workingSetBytes: kb * 1024 });
    }
    return out;
  }

  // ————————————————————————————————————————————
  // 内部
  // ————————————————————————————————————————————

  /** 桥命令靶（会话存活→debugger 面；销毁→undefined→CDP-SESSION-NOT-FOUND） */
  private targetOf(laneKey: string) {
    const session = this.sessions.get(laneKey);
    if (session === undefined || session.window.isDestroyed()) return undefined;
    return {
      sendCommand: (method: string, params: Record<string, unknown>) =>
        session.window.webContents.debugger.sendCommand(method, params),
    };
  }

  private liveSession(laneKey: string): LaneSession {
    const session = this.sessions.get(laneKey);
    if (session === undefined || session.window.isDestroyed()) {
      throw new CdpChannelError(IPC_ERROR_CODES.CDP_SESSION_NOT_FOUND, `lane 会话不存在：${laneKey}`);
    }
    return session;
  }

  /** 就绪导航（坑①先导航＋坑④ enable→navigate→loadEventFired→readyState 轮询兜底） */
  private async navigateToLoad(session: LaneSession, url: string): Promise<void> {
    const dbg = session.window.webContents.debugger;
    const timeoutMs = this.deps.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
    await dbg.sendCommand('Page.enable', {}); // loadEventFired 仅 enable 后派发（S-3 发现 4）
    const loaded = this.waitForCdpEvent(dbg, 'Page.loadEventFired', timeoutMs);
    const nav = (await dbg.sendCommand('Page.navigate', { url })) as { errorText?: string } | null;
    if (nav !== null && typeof nav.errorText === 'string' && nav.errorText !== '') {
      throw new CdpChannelError(IPC_ERROR_CODES.CDP_NAV_FAILED, `导航失败（${url}）：${nav.errorText}`);
    }
    try {
      await loaded; // 事件早于监听的极端时序由轮询兜底（spike navigateAndAwait 同源）
    } catch (err) {
      throw new CdpChannelError(
        IPC_ERROR_CODES.CDP_NAV_FAILED,
        `导航超时未触发 loadEventFired（${url}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.pollReadyState(dbg); // best-effort（预算内不达 complete 不判失败——B-14 轮询兜底语义）
  }

  /** readyState 轮询兜底（坑④；预算内每 50ms 单查，达 complete 即止） */
  private async pollReadyState(dbg: CdpDebuggerFace): Promise<void> {
    const delay = this.deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + READY_POLL_BUDGET_MS;
    for (;;) {
      try {
        const res = (await dbg.sendCommand('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })) as { result?: { value?: unknown } } | null;
        if (res?.result?.value === 'complete') return;
      } catch {
        /* best-effort：下一轮重试 */
      }
      if (Date.now() + READY_POLL_INTERVAL_MS > deadline) return;
      await delay(READY_POLL_INTERVAL_MS);
    }
  }

  /** CDP 事件等待（一次性监听＋超时） */
  private waitForCdpEvent(dbg: CdpDebuggerFace, method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const onMessage = (_e: unknown, m: string, params: unknown): void => {
        if (m === method) {
          cleanup();
          resolve(params);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        dbg.removeListener('message', onMessage as unknown as (...args: never[]) => void);
      };
      dbg.on('message', onMessage);
    });
  }

  /** 单会话销毁（detach〔best-effort〕→桥关→窗毁→口还池→台账 close） */
  private async destroySession(session: LaneSession): Promise<void> {
    await this.teardownSession(session.laneKey, session.window, session.port);
    this.lanes.close(session.laneKey);
  }

  private async teardownSession(
    laneKey: string,
    window: CdpWindowFace,
    port: number,
  ): Promise<void> {
    this.sessions.delete(laneKey);
    try {
      if (!window.isDestroyed() && window.webContents.debugger) window.webContents.debugger.detach();
    } catch {
      /* best-effort（未 attach/已断） */
    }
    await this.deps.bridge.closeLane(laneKey);
    if (!window.isDestroyed()) window.destroy();
    this.deps.portPool.release(port);
  }

  private upsertLane(session: LaneSession, status: string): void {
    const rec: LaneLedgerRecord = {
      id: session.laneKey,
      runId: session.runId,
      label: session.label,
      cdpPort: session.port,
      partition: session.partition,
      lastUrl: session.url,
      status,
    };
    this.lanes.upsert(rec);
  }
}
