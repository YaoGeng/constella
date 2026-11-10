// HeartbeatTicker 套件（T6-10；TDD-C-10 §6.1b「心跳」三例——fake timers）。
//   b1) +1s → 未结束行派 tick（用时刷新驱动）；
//   b2) t1 已置位行不刷（tick 载荷不含该行；行 elapsedMs 冻结——装配级断言）；
//   b3) 无未结束 run → timer 停（省电；demo L3088-3098 单 interval 同源）。
// 装配级（createRunsSource×ticker）：快照行 elapsedMs 随拍推进、t1 行不变、收尾后停表。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeStatus } from '../run';
import { HeartbeatTicker } from './heartbeat-ticker';
import { createRunsSource } from './runs-source';
import type { TaskRunRecord } from './run-row';
import type { RunStoreLike } from './runs-source';

const T0 = 1_700_000_000_000;

function rec(over: Partial<TaskRunRecord>): TaskRunRecord {
  return { flowName: 'f', status: 'running', t0: T0, t1: null, total: 1, ...over } as TaskRunRecord;
}

/** C-03 runStore 结构子集 fake（源消费 getState().lastRunOfFlow＋subscribe） */
type MirrorMap = Record<string, { runId: string; statuses: Record<string, NodeStatus> }>;

function fakeRunStore(mirror: MirrorMap = {}) {
  type S = { lastRunOfFlow: MirrorMap };
  let state: S = { lastRunOfFlow: mirror };
  const listeners = new Set<(s: S) => void>();
  const store = {
    getState: (): S => state,
    subscribe(fn: (s: S) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(m: MirrorMap): void {
      state = { lastRunOfFlow: m };
      for (const l of [...listeners]) l(state);
    },
  };
  return store satisfies RunStoreLike;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HeartbeatTicker（§3：start()/stop()/onTick(fn)；1s 单 timer）', () => {
  it('b1: +1s 派 tick，载荷=未结束 runId 列表', () => {
    let unfinished = ['r1', 'r2'];
    const ticker = new HeartbeatTicker({ getUnfinishedRunIds: () => unfinished });
    const seen: string[][] = [];
    ticker.onTick((ids) => seen.push([...ids]));
    ticker.start();

    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([['r1', 'r2']]);
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(2);
    ticker.stop();
  });

  it('b2: t1 已置位行不派（载荷只剩未结束行）', () => {
    const ticker = new HeartbeatTicker({ getUnfinishedRunIds: () => ['rLive'] });
    const seen: string[][] = [];
    ticker.onTick((ids) => seen.push([...ids]));
    ticker.start();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([['rLive']]); // rDone（t1 置位）从不入载荷
    ticker.stop();
  });

  it('b3: 无未结束 run → 不起表；拍内复查空集即自停（省电）', () => {
    vi.setSystemTime(T0);
    let unfinished: string[] = [];
    const ticker = new HeartbeatTicker({ getUnfinishedRunIds: () => unfinished });
    const onTick = vi.fn();
    ticker.onTick(onTick);

    ticker.start();
    expect(vi.getTimerCount()).toBe(0); // 无未结束 run：start 不起 timer
    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();

    unfinished = ['r1'];
    ticker.start(); // 有未结束 run 再起
    expect(vi.getTimerCount()).toBe(1);
    unfinished = []; // 拍前全部收尾（t1 置位）
    vi.advanceTimersByTime(1000);
    expect(onTick).not.toHaveBeenCalled(); // 空集拍=停表不派
    expect(vi.getTimerCount()).toBe(0); // 自停（省电）
  });
});

describe('装配级：createRunsSource×HeartbeatTicker（runs$ 快照随拍刷新）', () => {
  it('b1/b2: +1s 未结束行 elapsedMs 刷新、t1 行冻结；快照与订阅双面一致', () => {
    vi.setSystemTime(T0);
    const records = [
      rec({ runId: 'rLive', flowId: 'f1', status: 'running' }),
      rec({ runId: 'rDone', flowId: 'f2', status: 'done', t1: T0 + 30_000 }),
    ];
    const store = fakeRunStore();
    const source = createRunsSource({
      listRuns: () => records,
      runStore: store,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => Date.now(),
    });
    const seen: number[] = [];
    const unsub = source.subscribe(() => seen.push(source.snapshot().find((r) => r.runId === 'rLive')?.elapsedMs ?? -1));

    const liveBefore = source.snapshot().find((r) => r.runId === 'rLive')?.elapsedMs ?? -1;
    const doneBefore = source.snapshot().find((r) => r.runId === 'rDone')?.elapsedMs ?? -1;
    expect(liveBefore).toBe(0);
    expect(doneBefore).toBe(30_000);

    vi.advanceTimersByTime(1000);
    const rows = source.snapshot();
    expect(rows.find((r) => r.runId === 'rLive')?.elapsedMs).toBe(1000); // 未结束行刷新
    expect(rows.find((r) => r.runId === 'rDone')?.elapsedMs).toBe(30_000); // t1 行不刷
    expect(seen.at(-1)).toBe(1000); // 订阅方收到刷新后快照

    unsub();
    source.dispose();
  });

  it('b3: 全部收尾（setRuns 全 t1 置位）→ timer 停、不再派拍', () => {
    vi.setSystemTime(T0);
    const live = rec({ runId: 'r1', flowId: 'f1' });
    const store = fakeRunStore();
    const source = createRunsSource({
      listRuns: () => [live],
      runStore: store,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => Date.now(),
    });
    expect(vi.getTimerCount()).toBe(1); // 有未结束 run → 心跳在跑

    source.setRuns([rec({ runId: 'r1', flowId: 'f1', status: 'done', t1: T0 + 5000 })]);
    expect(vi.getTimerCount()).toBe(0); // 无未结束 run → 停表（省电）

    const rows = source.snapshot();
    expect(rows[0]?.status).toBe('done');
    source.dispose();
  });
});
