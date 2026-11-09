// 管理面真通道冒烟（T4-06；05 T4-18 备注「T4-06 管理面 cdp:listSessions/openViewer 真通道
// 冒烟随本卡（mock 解除）」——组件注入面单测（mock 通道）之外的真面半段）。
//
// 链路全真（唯 electron 窗/桥物理段 mock——真 electron 头跑已由 T4-18 head-run 套件覆盖）：
//   renderer 管理面注入面 createPreloadCdpChannels
//     → preload 真面 createConstellaApi（错误归一 normalizeIpcRejection 全真）
//     → loop ipcRenderer（Electron reject 摊平语义，T4-14 基建）
//     → IpcGateway 真网关（payload 校验＋{code,message} 序列化）
//     → registerCdpChannels → CdpSessionManager 真执行面（台账 upsert/close 事务点）
// 跨半段组装=组合根测试同构（main/ipc/preload-transport.spec.ts 先例——renderer 生产方向
// 仍只依赖注入面，P-3 不破）。
import { describe, expect, it, vi } from 'vitest';
import { IpcGateway } from '../../main/ipc/ipc-gateway';
import { createLoopMockElectron } from '../../main/ipc/testing/ipc-loop';
import { CdpSessionManager, type CdpBrowserWindowConstructor, type CdpDebuggerFace, type CdpWindowFace } from '../../main/cdp/cdp-session-manager';
import type { CdpBridgeFace } from '../../main/cdp/cdp-bridge';
import { CdpPortPool } from '../../main/cdp/port-pool';
import { createConstellaApi } from '../../preload/api';
import { createCdpSessionsModel } from './cdp-sessions-model';
import { createPreloadCdpChannels } from './manager-channels';
import { createSessionProbe } from './session-probe';

// ————————————————————————————————————————————
// electron 窗/桥 mock（cdp-session-manager.spec 同形最小副本——测试夹具，非导出面）
// ————————————————————————————————————————————

type MessageListener = (event: unknown, method: string, params: unknown) => void;

class SmokeDebugger {
  attached = false;
  private readonly listeners = new Map<string, MessageListener[]>();

  attach(v?: string): void {
    if (this.attached) throw new Error('already attached');
    void v;
    this.attached = true;
  }
  detach(): void {
    this.attached = false;
  }
  on(event: 'message', listener: MessageListener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  removeListener(event: string, listener: (...args: never[]) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== (listener as MessageListener)));
  }
  async sendCommand(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'Page.navigate') {
      queueMicrotask(() => {
        for (const l of [...(this.listeners.get('message') ?? [])]) l({}, 'Page.loadEventFired', {});
      });
      return { frameId: 'F1' };
    }
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression ?? '');
      if (expr === 'document.readyState') return { result: { value: 'complete' } };
      if (expr === '1') return { result: { value: 1 } };
    }
    return {};
  }
}

class SmokeWebContents {
  readonly debugger: CdpDebuggerFace = new SmokeDebugger();
  async loadURL(): Promise<void> {}
  getURL(): string {
    return 'https://lane.example/';
  }
}

class SmokeWindow {
  readonly webContents = new SmokeWebContents();
  destroyed = false;
  constructor(readonly options: Record<string, unknown> | undefined) {}
  destroy(): void {
    this.destroyed = true;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function makeBrowserWindow(): { ctor: CdpBrowserWindowConstructor; created: SmokeWindow[] } {
  const created: SmokeWindow[] = [];
  function ctor(this: unknown, options?: Record<string, unknown>): SmokeWindow {
    const w = new SmokeWindow(options);
    created.push(w);
    return w;
  }
  return { ctor: ctor as unknown as CdpBrowserWindowConstructor, created };
}

function makeBridge(): CdpBridgeFace {
  // 结构匹配 openLane/closeLane/closeAll/endpointOf/laneCount（物理绑定/冲突路径归 main 侧套件）
  return {
    openLane: async () => 0,
    closeLane: async () => {},
    closeAll: async () => {},
    endpointOf: () => '',
    laneCount: 0,
  };
}

// ————————————————————————————————————————————
// 组装：真网关＋真通道＋真 preload 面 → 管理面注入面
// ————————————————————————————————————————————

async function rig(): Promise<{
  created: SmokeWindow[];
  viewers: { openViewer: ReturnType<typeof vi.fn> };
  model: ReturnType<typeof createCdpSessionsModel>;
  channels: ReturnType<typeof createPreloadCdpChannels>;
  api: ReturnType<typeof createConstellaApi>;
}> {
  const loop = createLoopMockElectron();
  const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
  const { ctor, created } = makeBrowserWindow();
  const viewers = { openViewer: vi.fn() };
  const manager = new CdpSessionManager({
    browserWindow: ctor,
    bridge: makeBridge(),
    portPool: new CdpPortPool({ first: 9221, last: 9224 }, async () => false),
    viewers,
  });
  await manager.init({ registry: gateway });
  const api = createConstellaApi(loop.ipcRenderer);
  const channels = createPreloadCdpChannels(api);
  const model = createCdpSessionsModel(channels);
  return { created, viewers, model, channels, api };
}

const RUN = 'r1';

describe('管理面真通道冒烟（preload 真面→IpcGateway→registerCdpChannels→CdpSessionManager）', () => {
  it('listSessions 无会话 in-band []（02 §3.4）', async () => {
    const { channels } = await rig();
    expect(await channels.listSessions({ runId: RUN })).toEqual([]);
  });

  it('createSession→upsert→listSessions 投影=管理面消费形（laneKey/label/port/url）', async () => {
    const { api, model } = await rig();
    const created = await api.cdpCreateSession({
      runId: RUN,
      laneKey: 'f1·主',
      label: '主流程',
      startUrl: 'https://news.example.com/hot',
    });
    expect(created.port).toBeGreaterThanOrEqual(9221);
    expect(created.partition).toBe('persist:r1·主流程');
    await model.refresh(RUN);
    expect(model.sessionsOf(RUN)).toEqual([
      { laneKey: 'f1·主', label: '主流程', port: created.port, url: 'https://news.example.com/hot' },
    ]);
  });

  it('openViewer 经真通道往返：ok＋查看窗原语收到 {laneKey,url}', async () => {
    const { api, channels, viewers } = await rig();
    await api.cdpCreateSession({
      runId: RUN,
      laneKey: 'f1·主',
      label: '主流程',
      startUrl: 'https://news.example.com/hot',
    });
    const res = await channels.openViewer({ runId: RUN, laneKey: 'f1·主' });
    expect(res).toEqual({ ok: true });
    expect(viewers.openViewer).toHaveBeenCalledWith({
      laneKey: 'f1·主',
      url: 'https://news.example.com/hot',
    });
  });

  it('probe 全活 ok；lane 窗故障→in-band {ok:false,detail 含 laneKey}→onState 广播', async () => {
    const { api, channels, created } = await rig();
    await api.cdpCreateSession({
      runId: RUN,
      laneKey: 'f1·主',
      label: '主流程',
      startUrl: 'https://a.example/',
    });
    await api.cdpCreateSession({
      runId: RUN,
      laneKey: 'f1·评',
      label: '评论',
      startUrl: 'https://b.example/',
    });
    expect(await channels.probe()).toEqual({ ok: true });
    const probe = createSessionProbe(channels);
    const seen: Array<{ ok: boolean; detail?: string }> = [];
    probe.onState((s) => seen.push(s));
    created[1]!.destroyed = true; // lane 窗故障（进程外崩溃的可见形）
    const res = await probe.probe();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('f1·评');
    expect(seen).toEqual([res]);
  });

  it('destroyRun→close→投影清空（LaneProjector portsOf 随之归空）', async () => {
    const { api, model, channels } = await rig();
    await api.cdpCreateSession({ runId: RUN, laneKey: 'f1·主', label: '主流程', startUrl: 'https://a.example/' });
    await api.cdpCreateSession({ runId: RUN, laneKey: 'f1·评', label: '评论', startUrl: 'https://b.example/' });
    await model.refresh(RUN);
    const portsBefore = model.sessionsOf(RUN).map((s) => s.port);
    expect(portsBefore).toHaveLength(2);
    expect(await channels.destroyRun({ runId: RUN })).toEqual({ ok: true }); // in-band 幂等
    await model.refresh(RUN);
    expect(model.sessionsOf(RUN)).toEqual([]);
    expect(await channels.probe()).toEqual({ ok: true }); // 无会话=无故障
  });

  it('payload 校验/错误序列化全真：白名单外字段校验失败→preload 收 {code,message}（前缀不泄漏）', async () => {
    const { api } = await rig();
    // cdp:openViewer 缺 laneKey → VALIDATION-FAILED（IpcGateway 真校验）经真序列化回 preload
    await expect(api.cdpOpenViewer({ runId: RUN } as never)).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
  });
});
