// cdp:*＋env:cdpProbe 通道注册单测（T4-18 / TDD-C-M1 §1 矩阵 Cdp 行——通道×语义×错误码）。
// 注册面=InvokeRegistry（缺省 AppRuntime.ipc〔IpcGateway〕；AppRuntimeDeps.invokeRegistry 注入缝
// 同 T4-13/T4-15）。错误序列化归 IpcGateway（T4-14）——本套件断言 handler 抛 CdpChannelError
// 原样冒泡（网关识别序 ②）＋ in-band 面（listSessions []/destroyRun {ok:true}/probe {ok,...}）。
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { CdpChannelError } from './errors';
import { registerCdpChannels, type CdpChannelFace } from './cdp-channels';

type Handler = (payload: unknown) => Promise<unknown>;

function makeRegistry() {
  const handlers = new Map<string, Handler>();
  const registry = {
    handle: (ch: string, h: Handler) => {
      handlers.set(ch, h);
    },
  };
  return { handlers, registry };
}

/** manager 面 spy（通道面消费的 CdpSessionManager 子集） */
function makeManagerFace() {
  const calls: string[] = [];
  const face: CdpChannelFace = {
    createSession: vi.fn(async (req) => {
      calls.push(`createSession:${req.laneKey}`);
      return { port: 9221, partition: 'persist:f-1·主' };
    }),
    navigate: vi.fn(async (req) => {
      calls.push(`navigate:${req.laneKey}`);
      return { ok: true };
    }),
    listSessions: vi.fn(async (req) => {
      calls.push(`listSessions:${req.runId}`);
      return req.runId === 'none' ? [] : [{ laneKey: 'n-1', label: '主', port: 9221, url: 'http://a/' }];
    }),
    openViewer: vi.fn(async () => {
      calls.push('openViewer');
      return { ok: true };
    }),
    destroyRun: vi.fn(async () => {
      calls.push('destroyRun');
      return { ok: true };
    }),
    probe: vi.fn(async () => {
      calls.push('probe');
      return { ok: false, detail: 'n-1: 窗口已销毁' };
    }),
  };
  return { face, calls };
}

describe('registerCdpChannels（§1 矩阵 Cdp 行六通道）', () => {
  it('注册恰六通道（cdp:* 五＋env:cdpProbe）——通道名=X-01 IPC_CHANNELS', () => {
    const { handlers, registry } = makeRegistry();
    const { face } = makeManagerFace();
    registerCdpChannels(face, registry);
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC_CHANNELS.cdpCreateSession,
        IPC_CHANNELS.cdpNavigate,
        IPC_CHANNELS.cdpListSessions,
        IPC_CHANNELS.cdpOpenViewer,
        IPC_CHANNELS.cdpDestroyRun,
        IPC_CHANNELS.envCdpProbe,
      ].sort(),
    );
  });

  it('payload 透传 manager 方法（payload 形状已过 payload-schemas 通道面——T4-14）', async () => {
    const { handlers, registry } = makeRegistry();
    const { face } = makeManagerFace();
    registerCdpChannels(face, registry);
    const payload = { runId: 'r-1', laneKey: 'n-1', label: '主', startUrl: 'http://a/' };
    await handlers.get(IPC_CHANNELS.cdpCreateSession)!(payload);
    expect(vi.mocked(face.createSession)).toHaveBeenCalledWith(payload);
    await handlers.get(IPC_CHANNELS.cdpNavigate)!({ runId: 'r-1', laneKey: 'n-1', url: 'http://b/' });
    expect(vi.mocked(face.navigate)).toHaveBeenCalledWith({ runId: 'r-1', laneKey: 'n-1', url: 'http://b/' });
  });

  it('manager 抛 CdpChannelError 原样冒泡（IpcGateway 序列化识别序 ②→{code,message} reject）', async () => {
    const { handlers, registry } = makeRegistry();
    const face = {
      ...makeManagerFace().face,
      navigate: async (): Promise<never> => {
        throw new CdpChannelError('CDP-SESSION-NOT-FOUND', 'lane 会话不存在：n-x');
      },
    };
    registerCdpChannels(face, registry);
    const err: unknown = await handlers.get(IPC_CHANNELS.cdpNavigate)!({ runId: 'r', laneKey: 'n-x', url: 'u' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CdpChannelError);
    if (err instanceof CdpChannelError) expect(err.code).toBe('CDP-SESSION-NOT-FOUND');
  });

  it('in-band 面：listSessions 无会话→[]；destroyRun 幂等 {ok:true}；probe 失败→{ok:false,detail} 不 reject', async () => {
    const { handlers, registry } = makeRegistry();
    const { face } = makeManagerFace();
    registerCdpChannels(face, registry);
    await expect(handlers.get(IPC_CHANNELS.cdpListSessions)!({ runId: 'none' })).resolves.toEqual([]);
    await expect(handlers.get(IPC_CHANNELS.cdpDestroyRun)!({ runId: 'r-1' })).resolves.toEqual({ ok: true });
    await expect(handlers.get(IPC_CHANNELS.envCdpProbe)!(undefined)).resolves.toEqual({
      ok: false,
      detail: 'n-1: 窗口已销毁',
    });
  });
});
