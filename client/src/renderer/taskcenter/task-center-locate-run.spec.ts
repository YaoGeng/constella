// locate-run 套件（T6-11；TDD-C-10 §6.1d「脏闸分支」——01 A-9.1 定位钮/A-6.5 双写还原/
// A-3.01 panToNode；脏闸形态本卡冻结=demo L2795-2797：dirty→toast 拒绝不切换）。
//   d1) dirty → 原语（switchFlow/restoreStatuses/panToNode/fitView）零调用＋toast 逐字文案
//       （demo L2796「有未保存改动 — 先保存或取消」/level err）；
//   d2) 非 dirty＋活动节点 → 切流程＋statuses 还原＋panToNode 各恰一次（fitView 不调）；
//   d3) 非 dirty＋终态 run（无活动节点）→ fitView 回退恰一次（panToNode 不调——demo L2798）；
//   d4) resolveLocateTarget：首个 running/waiting 节点为定位焦点；终态 → null；
//   d5) createGotoHandler（RunsSource.locateTargetOf 装配位）：runId→目标解析→脏闸编排贯通。
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeStatus } from '../run';
import {
  LOCATE_DIRTY_TOAST,
  createGotoHandler,
  locateRun,
  resolveLocateTarget,
  type LocateRunDeps,
} from './locate-run';
import { createRunsSource, type RunsSource } from './runs-source';
import type { TaskRunRecord } from './run-row';
import { useRunStore } from '../run';

const T0 = 1_700_000_000_000;

/** 注入面＋mock 观测位（invocationCallOrder 断言需要） */
type Deps = LocateRunDeps & {
  switchFlow: Mock;
  restoreStatuses: Mock;
  panToNode: Mock;
  fitView: Mock;
  toast: Mock;
};

function deps(over: Partial<Deps> = {}): Deps {
  return {
    isDirty: () => false,
    switchFlow: vi.fn(),
    restoreStatuses: vi.fn(),
    panToNode: vi.fn(),
    fitView: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

function target(over: Partial<Parameters<typeof locateRun>[1]> = {}) {
  return { runId: 'r1', flowId: 'f4', focusNodeId: 'n4', ...over };
}

describe('§6.1d 脏闸分支（冻结形态=demo L2795-2797：dirty→toast 拒绝、不切换）', () => {
  it('d1) dirty → 四原语零调用＋toast（err 级，demo L2796 逐字文案）', () => {
    const d = deps({ isDirty: () => true });
    const ok = locateRun(d, target());
    expect(ok).toBe(false); // 拒绝（不切换）
    expect(d.toast).toHaveBeenCalledTimes(1);
    expect(d.toast).toHaveBeenCalledWith('err', LOCATE_DIRTY_TOAST);
    expect(LOCATE_DIRTY_TOAST).toBe('有未保存改动 — 先保存或取消'); // demo L2796 逐字
    expect(d.switchFlow).not.toHaveBeenCalled();
    expect(d.restoreStatuses).not.toHaveBeenCalled();
    expect(d.panToNode).not.toHaveBeenCalled();
    expect(d.fitView).not.toHaveBeenCalled();
  });

  it('d2) 非 dirty＋活动节点 → 切流程→statuses 还原→panToNode 闪烁 各恰一次（fitView 不调）', () => {
    const d = deps();
    const ok = locateRun(d, target({ flowId: 'f9', focusNodeId: 'n2' }));
    expect(ok).toBe(true);
    expect(d.switchFlow).toHaveBeenCalledTimes(1);
    expect(d.switchFlow).toHaveBeenCalledWith('f9');
    expect(d.restoreStatuses).toHaveBeenCalledTimes(1);
    expect(d.restoreStatuses).toHaveBeenCalledWith('f9');
    expect(d.panToNode).toHaveBeenCalledTimes(1); // A-3.01 视野居中＋闪烁
    expect(d.panToNode).toHaveBeenCalledWith('f9', 'n2');
    expect(d.fitView).not.toHaveBeenCalled();
    // 编排序：切流程 → 还原 → 定位（demo L2797-2798 先 renderNodes 后 fitView 同源）
    const order = [
      d.switchFlow.mock.invocationCallOrder[0] ?? 0,
      d.restoreStatuses.mock.invocationCallOrder[0] ?? 0,
      d.panToNode.mock.invocationCallOrder[0] ?? 0,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('d3) 非 dirty＋终态 run（无活动节点）→ fitView 回退恰一次（panToNode 不调——demo L2798）', () => {
    const d = deps();
    const ok = locateRun(d, target({ focusNodeId: null }));
    expect(ok).toBe(true);
    expect(d.switchFlow).toHaveBeenCalledTimes(1);
    expect(d.restoreStatuses).toHaveBeenCalledTimes(1);
    expect(d.fitView).toHaveBeenCalledTimes(1);
    expect(d.panToNode).not.toHaveBeenCalled();
  });
});

describe('resolveLocateTarget（run 记录＋statuses → 定位目标）', () => {
  it('d4) 首个 running/waiting 节点=定位焦点；终态 run → null', () => {
    const rec: TaskRunRecord = { runId: 'r1', flowId: 'f4', flowName: '监控', status: 'running', t0: T0, t1: null, total: 7 };
    const live: Readonly<Record<string, NodeStatus>> = { n1: 'done', n2: 'running', n3: 'waiting' };
    expect(resolveLocateTarget(rec, live)).toEqual({ runId: 'r1', flowId: 'f4', focusNodeId: 'n2' });
    expect(resolveLocateTarget(rec, { n1: 'done', n2: 'skipped' })).toEqual({ runId: 'r1', flowId: 'f4', focusNodeId: null });
    const dead: TaskRunRecord = { ...rec, status: 'done', t1: T0 + 9 };
    expect(resolveLocateTarget(dead, { n1: 'done' }).focusNodeId).toBeNull(); // 终态行无活动节点
  });
});

describe('createGotoHandler（RunsSource 目标解析装配位——T6-17 真画布原语接线面）', () => {
  function sourceWith(records: TaskRunRecord[]): RunsSource {
    useRunStore.getState().reset();
    return createRunsSource({
      listRuns: () => records,
      runStore: useRunStore,
      portsOf: () => [],
      nodeName: () => 'x',
      now: () => T0,
    });
  }

  it('d5) goto(runId) → 记录解析（statuses 镜像优先）→ 脏闸编排贯通；未知 runId 安静 no-op', () => {
    const rec: TaskRunRecord = { runId: 'r1', flowId: 'f4', flowName: '监控', status: 'running', t0: T0, t1: null, total: 7 };
    const source = sourceWith([rec]);
    useRunStore.getState().runOpened('f4', 'r1');
    useRunStore.getState().nodeStatus({ runId: 'r1', nodeId: 'n2', status: 'running' }, 'f4');

    const d = deps();
    const goto = createGotoHandler(source, d);
    goto('r1');
    expect(d.switchFlow).toHaveBeenCalledWith('f4');
    expect(d.panToNode).toHaveBeenCalledWith('f4', 'n2'); // 焦点=镜像 running 节点

    const d2 = deps({ isDirty: () => true });
    createGotoHandler(source, d2)('r1');
    expect(d2.switchFlow).not.toHaveBeenCalled(); // 脏闸仍拦截

    const d3 = deps();
    createGotoHandler(source, d3)('unknown'); // 未知 runId：不抛错、零原语
    expect(d3.switchFlow).not.toHaveBeenCalled();
    source.dispose();
  });
});
