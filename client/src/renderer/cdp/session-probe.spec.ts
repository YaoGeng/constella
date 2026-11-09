// SessionProbe 用例（T4-06；TDD-C-04 §6.3e——probe fail→onState 广播；C-03 决策输入/
// B-9 顶栏 pill 同源）。env:cdpProbe 语义=in-band {ok,detail} 不 reject（C-M1 §1）；
// 传输层异常兜底映射 {ok:false,detail}（B-14 故障上报不静默）。
import { describe, expect, it } from 'vitest';
import type { CdpProbeRes } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';
import { createSessionProbe } from './session-probe';

function channelsWith(answer: () => Promise<CdpProbeRes>): CdpManagerChannels {
  return {
    listSessions: async () => [],
    openViewer: async () => ({ ok: true }),
    destroyRun: async () => ({ ok: true }),
    probe: answer,
  };
}

describe('SessionProbe（§6.3e probe fail→onState 广播）', () => {
  it('probe fail → onState 广播 {ok:false,detail}（C-03 断连决策输入）', async () => {
    const probe = createSessionProbe(
      channelsWith(async () => ({ ok: false, detail: 'n1: 窗口已销毁' })),
    );
    const seen: CdpProbeRes[] = [];
    probe.onState((s) => seen.push(s));
    const res = await probe.probe();
    expect(res).toEqual({ ok: false, detail: 'n1: 窗口已销毁' });
    expect(seen).toEqual([{ ok: false, detail: 'n1: 窗口已销毁' }]);
  });

  it('probe ok → onState 广播 {ok:true}（B-9 pill 同源：ok/fail 两态皆广播）', async () => {
    const probe = createSessionProbe(channelsWith(async () => ({ ok: true })));
    const seen: CdpProbeRes[] = [];
    probe.onState((s) => seen.push(s));
    await probe.probe();
    expect(seen).toEqual([{ ok: true }]);
  });

  it('多订阅方各收广播；退订后不再收', async () => {
    const probe = createSessionProbe(channelsWith(async () => ({ ok: true })));
    const a: CdpProbeRes[] = [];
    const b: CdpProbeRes[] = [];
    const offA = probe.onState((s) => a.push(s));
    probe.onState((s) => b.push(s));
    await probe.probe();
    offA();
    await probe.probe();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('lastState=最近一次探活结果（pill 初挂回显）', async () => {
    const probe = createSessionProbe(
      channelsWith(async () => ({ ok: false, detail: 'x' })),
    );
    expect(probe.lastState()).toBeUndefined();
    await probe.probe();
    expect(probe.lastState()).toEqual({ ok: false, detail: 'x' });
  });

  it('通道 reject（传输层故障）→ 兜底 {ok:false,detail=code:message} 广播', async () => {
    const probe = createSessionProbe(
      channelsWith(async () => {
        throw { code: 'INTERNAL', message: 'ipc down' };
      }),
    );
    const seen: CdpProbeRes[] = [];
    probe.onState((s) => seen.push(s));
    const res = await probe.probe();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('INTERNAL');
    expect(seen).toHaveLength(1);
  });
});
