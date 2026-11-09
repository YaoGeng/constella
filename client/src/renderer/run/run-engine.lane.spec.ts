// LaneManager 组件套件（T4-02；TDD-C-03 §3 LaneManager 行；02 §10 #4 lane 键/标签）。
// 断言面：
//   - lane 键/标签：assign 后 laneOf 可查、未 assign 为 undefined（扇出支 lane 由交付路由
//     以「支首节点」构造后经 assign 落表——demo L1850/L1940 键形）；
//   - ensureSession 时机（A-8.1 生命周期语义源）：lane 首个 cdp.* → cdp:createSession 恰一次
//     （payload {runId,laneKey,label,startUrl}）；同 lane 后续 → 复用会话只更新 URL
//     （cdp:navigate 仅在携带新 url 时发）；无 url → 复用不动；
//   - 会话台账：sessionOf 按 laneKey 查 port/partition/url；
//   - 未注入执行面传输 → ensureSession 抛错（节点 error 路径）。
// 传输＝注入 fake（零 Electron 依赖，§8 替换点①）。
import { describe, expect, it } from 'vitest';
import { LaneManager } from './lane-manager';
import type { CreateSessionReq, NavigateReq } from '@constella/shared/ipc';
import type { Lane, RunTransport } from './types';

/** fake 执行面传输：只落 cdp 会话域调用记录（run 域打桩拒绝——本套件不消费） */
function fakeTransport(startPort = 9221) {
  const sessions: CreateSessionReq[] = [];
  const navigations: NavigateReq[] = [];
  let portSeq = startPort - 1;
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    spawnScript: async () => {
      throw new Error('本套件不消费 spawnScript');
    },
    onScriptEvent: () => () => undefined,
    cdpCreateSession: async (req) => {
      sessions.push(req);
      return { port: ++portSeq, partition: `persist:f1·${req.label}` };
    },
    cdpNavigate: async (req) => {
      navigations.push(req);
      return { ok: true };
    },
    killScript: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => ({ ok: true }),
  };
  return { transport, sessions, navigations };
}

const LANE_MAIN: Lane = { key: 'main', label: '社保上传' };
const LANE_B1: Lane = { key: 'b1', label: '北京人社局' };

describe('LaneManager 组件级', () => {
  it('laneOf：assign 后可查；未 assign → undefined', () => {
    const lanes = new LaneManager({ runId: 'r1' });
    expect(lanes.laneOf('a')).toBeUndefined();
    lanes.assign('a', LANE_MAIN);
    expect(lanes.laneOf('a')).toEqual(LANE_MAIN);
  });

  it('ensureSession lane 首个 cdp.* → cdp:createSession 恰一次（payload 含 runId/laneKey/label/startUrl），sessionOf 落台账', async () => {
    const { transport, sessions, navigations } = fakeTransport();
    const lanes = new LaneManager({ runId: 'r1', transport });
    const s1 = await lanes.ensureSession(LANE_B1, 'https://bj.example.com');
    expect(sessions).toEqual([
      { runId: 'r1', laneKey: 'b1', label: '北京人社局', startUrl: 'https://bj.example.com' },
    ]);
    expect(s1).toMatchObject({ port: 9221, url: 'https://bj.example.com' });
    expect(lanes.sessionOf('b1')).toMatchObject({ port: 9221, partition: 'persist:f1·北京人社局' });
    // 再次 ensure（无 url 变化）→ 复用，不 create 不 navigate
    const s2 = await lanes.ensureSession(LANE_B1);
    expect(s2).toEqual(s1);
    expect(sessions).toHaveLength(1);
    expect(navigations).toHaveLength(0);
  });

  it('ensureSession 缺省 startUrl → createSession 以 about:blank 起步（空窗不可靠，先导航再发命令）', async () => {
    const { transport, sessions } = fakeTransport();
    const lanes = new LaneManager({ runId: 'r9', transport });
    await lanes.ensureSession(LANE_MAIN);
    expect(sessions[0]).toMatchObject({ runId: 'r9', laneKey: 'main', startUrl: 'about:blank' });
  });

  it('同 lane 后续 cdp.* 带 url → 复用会话只更新 URL（cdp:navigate）；url 未变不重发', async () => {
    const { transport, sessions, navigations } = fakeTransport();
    const lanes = new LaneManager({ runId: 'r1', transport });
    await lanes.ensureSession(LANE_B1, 'https://a.example.com');
    const s = await lanes.ensureSession(LANE_B1, 'https://b.example.com');
    expect(s.url).toBe('https://b.example.com');
    expect(navigations).toEqual([{ runId: 'r1', laneKey: 'b1', url: 'https://b.example.com' }]);
    expect(sessions).toHaveLength(1);
    // 同 url 再来 → 不重复 navigate
    await lanes.ensureSession(LANE_B1, 'https://b.example.com');
    expect(navigations).toHaveLength(1);
  });

  it('异 lane 会话互异：每 lane 各自 createSession（端口递增分配）', async () => {
    const { transport, sessions } = fakeTransport();
    const lanes = new LaneManager({ runId: 'r1', transport });
    await lanes.ensureSession({ key: 'b1', label: '北京' }, 'https://a.example.com');
    await lanes.ensureSession({ key: 'b2', label: '上海' }, 'https://b.example.com');
    expect(sessions.map((s) => s.laneKey)).toEqual(['b1', 'b2']);
    expect(lanes.sessionOf('b1')?.port).toBe(9221);
    expect(lanes.sessionOf('b2')?.port).toBe(9222);
  });

  it('未注入执行面传输 → ensureSession 抛错（cdp.* 节点前置失败路径）', async () => {
    const lanes = new LaneManager({ runId: 'r1' });
    await expect(lanes.ensureSession(LANE_MAIN, 'https://a.example.com')).rejects.toThrow('执行面传输未注入');
  });
});
