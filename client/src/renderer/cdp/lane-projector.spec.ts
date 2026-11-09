// LaneProjector＋CdpSessionsModel 用例（T4-06；TDD-C-04 §1 LaneProjector 行——
// ✅ M4 收口会签 #3 导出面：portsOf(runId)/onLanesChange；数据源=cdp:listSessions 投影
// （lanes 台账只读）。台账 upsert/close 事务点在 renderer 侧的可见形=投影 diff——
// createSession/navigate→upsert、destroyRun→close，均经 refresh 后 diff 广播。
import { describe, expect, it } from 'vitest';
import type { ListSessionsRes } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';
import { createCdpSessionsModel } from './cdp-sessions-model';
import { createLaneProjector } from './lane-projector';

function fakeChannels(): { channels: CdpManagerChannels; setSessions(v: ListSessionsRes): void } {
  const byRun = new Map<string, ListSessionsRes>([
    ['r1', []],
    ['r2', []],
  ]);
  return {
    channels: {
      listSessions: async (req) => [...(byRun.get(req.runId) ?? [])],
      openViewer: async () => ({ ok: true }),
      destroyRun: async () => ({ ok: true }),
      probe: async () => ({ ok: true }),
    },
    setSessions: (v) => byRun.set('r1', v),
  };
}

describe('CdpSessionsModel（投影缓存＋diff 广播）', () => {
  it('首查入缓存；投影不变（同内容重复 refresh）静默不广播', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    const seen: string[] = [];
    model.onChange((runId) => seen.push(runId));
    await model.refresh('r1');
    expect(model.sessionsOf('r1')).toEqual([]);
    expect(seen).toEqual([]); // 空→空：无台账事务可见形
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
    ]);
    await model.refresh('r1');
    expect(seen).toEqual(['r1']); // []→1 会话=upsert 可见形
    await model.refresh('r1'); // 同内容
    expect(seen).toEqual(['r1']); // 静默
  });

  it('lane 增（upsert）/URL 变（navigate→upsert.last_url）/lane 减（close）皆广播', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    const seen: string[] = [];
    model.onChange((runId) => seen.push(runId));
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
    ]);
    await model.refresh('r1');
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
      { laneKey: 'n7', label: '评', port: 9222, url: 'https://b.example/' },
    ]);
    await model.refresh('r1');
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/v2' },
      { laneKey: 'n7', label: '评', port: 9222, url: 'https://b.example/' },
    ]);
    await model.refresh('r1');
    setSessions([
      { laneKey: 'n7', label: '评', port: 9222, url: 'https://b.example/' },
    ]);
    await model.refresh('r1');
    expect(seen).toEqual(['r1', 'r1', 'r1', 'r1']);
    expect(model.sessionsOf('r1')).toEqual([
      { laneKey: 'n7', label: '评', port: 9222, url: 'https://b.example/' },
    ]);
  });

  it('按 runId 隔离：r1 变更不广播 r2；sessionsOf 未查 run=空数组', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    const seen: string[] = [];
    model.onChange((runId) => seen.push(runId));
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
    ]);
    await model.refresh('r1');
    await model.refresh('r2');
    expect(seen).toEqual(['r1']);
    expect(model.sessionsOf('r2')).toEqual([]);
  });

  it('快照防御：sessionsOf 返回副本（外部改动不污染缓存）', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
    ]);
    await model.refresh('r1');
    const snap = model.sessionsOf('r1');
    snap.pop();
    expect(model.sessionsOf('r1')).toHaveLength(1);
  });
});

describe('LaneProjector（§1 导出面——C-10 RunRow.cdpPorts 数据源）', () => {
  it('portsOf(runId)=cdp:listSessions 投影端口列', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    const projector = createLaneProjector(model);
    expect(projector.portsOf('r1')).toEqual([]); // 未查/无会话
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
      { laneKey: 'n7', label: '评', port: 9222, url: 'https://b.example/' },
    ]);
    await model.refresh('r1');
    expect(projector.portsOf('r1')).toEqual([9221, 9222]);
  });

  it('onLanesChange=台账事务点后按 runId 广播（portsOf 随之更新）', async () => {
    const { channels, setSessions } = fakeChannels();
    const model = createCdpSessionsModel(channels);
    const projector = createLaneProjector(model);
    const seen: Array<{ runId: string; ports: number[] }> = [];
    const off = projector.onLanesChange((runId) => seen.push({ runId, ports: projector.portsOf(runId) }));
    setSessions([
      { laneKey: 'n1', label: '主', port: 9221, url: 'https://a.example/' },
    ]);
    await model.refresh('r1');
    setSessions([]); // destroyRun→close 全清
    await model.refresh('r1');
    off();
    setSessions([
      { laneKey: 'n9', label: '新', port: 9223, url: 'https://c.example/' },
    ]);
    await model.refresh('r1');
    expect(seen).toEqual([
      { runId: 'r1', ports: [9221] },
      { runId: 'r1', ports: [] },
    ]); // 退订后第三段不收
  });
});
