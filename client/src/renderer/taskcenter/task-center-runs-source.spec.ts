// createRunsSource 套件（T6-10；runs 数据装配——TDD-C-10 §1 runs$ 快照面本卡交付段）。
//   - records×statuses 镜像×ports×nodeName → RunRow[] 快照（§6.1a 装配位）；
//   - 订阅通知：setRuns/refresh/runStore 镜像变更三路；
//   - runStore 镜像归属判定：仅 flowId 槽位 runId 与记录一致才采用（防御半更新）；
//   - 与 C-03 真身 useRunStore 的结构兼容（编译期断言——T6-17 装配面保证）。
import { describe, expect, it, vi } from 'vitest';
import { useRunStore } from '../run';
import { createRunsSource, type RunStoreLike } from './runs-source';
import type { TaskRunRecord } from './run-row';

const T0 = 1_700_000_000_000;

function rec(over: Partial<TaskRunRecord>): TaskRunRecord {
  return { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'running', t0: T0, t1: null, total: 7, ...over };
}

// 编译期：C-03 runStore 真身满足 RunStoreLike 结构子集（T6-17 直接注入面）
const _typeCheckRunStore: RunStoreLike = useRunStore;

/** 真身 runStore 驱动（ getState/setState）——订阅与镜像路径走产品同一路径 */
function realStoreHarness() {
  useRunStore.getState().reset();
  return useRunStore;
}

describe('runs 数据装配（statuses 镜像→RunRow 列表快照面）', () => {
  it('镜像 statuses 与 ports/name 注入汇成 RunRow[]；顺序=记录序', () => {
    const store = realStoreHarness();
    store.getState().runOpened('f4', 'r1');
    store.getState().nodeStatus({ runId: 'r1', nodeId: 'n1', status: 'done' }, 'f4');
    store.getState().nodeStatus({ runId: 'r1', nodeId: 'n4', status: 'running' }, 'f4');

    const source = createRunsSource({
      listRuns: () => [rec({ runId: 'r1', flowId: 'f4' }), rec({ runId: 'r9', flowId: 'f2', flowName: '旧任务', status: 'done', t1: T0 + 9 })],
      runStore: store,
      portsOf: (runId) => (runId === 'r1' ? [9221, 9222] : []),
      nodeName: (_flowId, id) => (id === 'n4' ? '抓取视频列表' : '…'),
      now: () => T0 + 65_000,
    });

    expect(source.snapshot()).toEqual([
      {
        runId: 'r1',
        flowId: 'f4',
        flowName: '监控 UP 主',
        status: 'running',
        currentNodes: ['抓取视频列表'],
        progress: { done: 1, total: 7 },
        cdpPorts: [9221, 9222],
        elapsedMs: 65_000,
      },
      {
        runId: 'r9',
        flowId: 'f2',
        flowName: '旧任务',
        status: 'done',
        currentNodes: [],
        progress: { done: 0, total: 7 },
        cdpPorts: [],
        elapsedMs: 9,
      },
    ]);
    source.dispose();
  });

  it('镜像槽位 runId 不一致的记录不采用镜像（防半更新串台），回退记录自带 statuses', () => {
    const store = realStoreHarness();
    store.getState().runOpened('f1', 'rNew'); // f1 槽位已被新 run 占用
    const source = createRunsSource({
      listRuns: () => [rec({ runId: 'rOld', flowId: 'f1', status: 'running', statuses: { n1: 'done' } })],
      runStore: store,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => T0,
    });
    expect(source.snapshot()[0]?.progress).toEqual({ done: 1, total: 7 }); // 记录自带 statuses 生效
    source.dispose();
  });

  it('订阅三路通知：setRuns／refresh（listRuns 重读）／runStore 镜像变更', () => {
    const store = realStoreHarness();
    let list: TaskRunRecord[] = [rec({ runId: 'r1', flowId: 'f4' })];
    const source = createRunsSource({
      listRuns: () => list,
      runStore: store,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => T0,
    });
    const calls: string[] = [];
    const unsub = source.subscribe((rows) => calls.push(`n${rows.length}:${rows[0]?.status ?? '-'}`));

    store.getState().runOpened('f4', 'r1'); // runStore 变更 → 重投影
    expect(calls.at(-1)).toBe('n1:running');

    source.setRuns([rec({ runId: 'r1', flowId: 'f4', status: 'aborted', t1: T0 + 5 })]);
    expect(calls.at(-1)).toBe('n1:aborted');

    list = [rec({ runId: 'r2', flowId: 'f5', flowName: '新任务' })];
    source.refresh(); // listRuns 重读（收尾后刷新驱动位）
    expect(calls.at(-1)).toBe('n1:running');
    expect(source.snapshot()[0]?.runId).toBe('r2');

    unsub();
    const before = calls.length;
    source.setRuns([]);
    expect(calls.length).toBe(before); // 退订后不再通知
    source.dispose();
  });

  it('dispose：退订 runStore＋停心跳（无残留 timer/监听）', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const store = realStoreHarness();
      const source = createRunsSource({
        listRuns: () => [rec({ runId: 'r1', flowId: 'f4' })],
        runStore: store,
        portsOf: () => [],
        nodeName: () => 'x',
        now: () => Date.now(),
      });
      expect(vi.getTimerCount()).toBe(1);
      source.dispose();
      expect(vi.getTimerCount()).toBe(0);
      store.getState().runOpened('f4', 'r1'); // 退订后镜像变更不再触法（不抛错、不通知）
    } finally {
      vi.useRealTimers();
    }
  });

  it('clearFinished：已结束（done/error/aborted）移除、未结束（running/waiting）保留（§6.1e 任务 tab 语义）', () => {
    const store = realStoreHarness();
    const source = createRunsSource({
      listRuns: () => [
        rec({ runId: 'a', flowId: 'f1', status: 'running', t1: null }),
        rec({ runId: 'b', flowId: 'f2', status: 'waiting', t1: null }),
        rec({ runId: 'c', flowId: 'f3', status: 'done', t1: T0 + 1 }),
        rec({ runId: 'd', flowId: 'f5', status: 'error', t1: T0 + 1 }),
        rec({ runId: 'e', flowId: 'f6', status: 'aborted', t1: T0 + 1 }),
      ],
      runStore: store,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => T0,
    });
    source.clearFinished();
    expect(source.snapshot().map((r) => r.runId)).toEqual(['a', 'b']); // 运行中/待确认保留（03 §1「仅清已结束」）
    source.dispose();
  });
});
