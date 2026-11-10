// RunRowProjector 套件（T6-10；TDD-C-10 §6.1a「行模型投影」＋§6.1f「徽标」纯函数半段）。
//   a) 7 节点 3 done＋2 分支 running → RunRow={progress 3/7、currentNodes 两实例名、
//      状态映射、cdpPorts [9221,9222]}（01 A-9.1 行语义逐列；demo L2770-2790 行为源）；
//   f) 徽标计数 runningCountOf：2 running→2、0→0（「0→隐藏」渲染断言在 run-table spec 的
//      RunBadge；demo L2763-2767 renderNavBadge）。
import { describe, expect, it } from 'vitest';
import type { NodeStatus } from '../run';
import {
  STATUS_LABEL,
  STATUS_TONE,
  fmtElapsed,
  isRunUnfinished,
  project,
  runRecordFromSummary,
  runningCountOf,
  type RunRow,
  type TaskRunRecord,
} from './run-row';

const T0 = 1_700_000_000_000;
const NOW = T0 + 65_000;

/** 7 节点流程：n1-n3 done、n4/n5 两分支 running（多分支并行——01 A-9.1「当前节点 · 连接」源例） */
function sevenNodeStatuses(): Record<string, NodeStatus> {
  return { n1: 'done', n2: 'done', n3: 'done', n4: 'running', n5: 'running' };
}

function runningRecord(over: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'running', t0: T0, t1: null, total: 7, ...over };
}

describe('§6.1a 行模型投影 project(run,statuses,ports,nodeName)', () => {
  it('3 done＋2 分支 running → progress 3/7、currentNodes 两实例名、cdpPorts [9221,9222]、elapsedMs=now-t0', () => {
    const names: Record<string, string> = { n4: '抓取视频列表', n5: '截图存档' };
    const row = project(runningRecord(), sevenNodeStatuses(), [9221, 9222], (id) => names[id] ?? '…', NOW);

    expect(row.runId).toBe('r1');
    expect(row.flowId).toBe('f4');
    expect(row.flowName).toBe('监控 UP 主');
    expect(row.status).toBe('running');
    expect(row.progress).toEqual({ done: 3, total: 7 }); // done 计数/total=可达数（02 §10 #2）
    expect(row.currentNodes).toEqual(['抓取视频列表', '截图存档']); // 两分支实例名（「·」连接渲染归 RunTable）
    expect(row.cdpPorts).toEqual([9221, 9222]); // C-04 LaneProjector.portsOf 投影
    expect(row.elapsedMs).toBe(NOW - T0); // (t1||now)-t0
  });

  it('waiting run：waiting 节点入 currentNodes、状态映射 wait=琥珀', () => {
    const row = project(
      runningRecord({ status: 'waiting', runId: 'r2', flowId: 'f3', flowName: '人工确认' }),
      { h1: 'done', h2: 'waiting' },
      [],
      (id) => (id === 'h2' ? '复核名单' : '提取名单'),
      NOW,
    );
    expect(row.currentNodes).toEqual(['复核名单']);
    expect(STATUS_TONE[row.status]).toBe('wait'); // waiting=琥珀（01 A-9.1）
  });

  it('已收尾 run（t1 置位）：elapsedMs=t1-t0 不随 now 走、currentNodes 空', () => {
    const t1 = T0 + 30_000;
    const row = project(
      runningRecord({ status: 'done', t1, total: 7 }),
      { n1: 'done', n2: 'done', n3: 'done', n4: 'done', n5: 'done', n6: 'done', n7: 'done' },
      [],
      () => 'x',
      NOW + 999_999,
    );
    expect(row.elapsedMs).toBe(t1 - T0); // t1 已置位 → 用时冻结
    expect(row.currentNodes).toEqual([]); // 终态行无活动节点
    expect(row.progress).toEqual({ done: 7, total: 7 });
  });

  it('未登记节点名回退「…」（demo L2775 空名兜底）', () => {
    const row = project(runningRecord(), sevenNodeStatuses(), [], () => '', NOW);
    expect(row.currentNodes).toEqual(['…', '…']);
  });

  it('total 缺省以 statuses 键数兜底（重放半行——T6-11 runs.get 前的防御位）', () => {
    const { total: _drop, ...rec } = runningRecord();
    const row = project(rec, sevenNodeStatuses(), [], () => 'x', NOW);
    expect(row.progress).toEqual({ done: 3, total: 5 });
  });

  it('状态映射：running/done=青、waiting=琥珀、error/aborted=红（01 A-9.1）＋五值文案（demo L2772）', () => {
    expect(STATUS_TONE.running).toBe('ok');
    expect(STATUS_TONE.done).toBe('ok'); // demo L87 .dot.ok 同类（青）
    expect(STATUS_TONE.waiting).toBe('wait');
    expect(STATUS_TONE.error).toBe('off');
    expect(STATUS_TONE.aborted).toBe('off');
    expect(STATUS_LABEL).toEqual({
      running: '运行中',
      waiting: '待确认',
      done: '已完成',
      error: '失败',
      aborted: '已终止',
    });
  });
});

describe('未结束判据 isRunUnfinished（心跳派发面——demo L3088 if(r.t1) continue）', () => {
  it('t1 未置位且 running/waiting → true；t1 已置位或终态 → false', () => {
    expect(isRunUnfinished(runningRecord())).toBe(true);
    expect(isRunUnfinished(runningRecord({ status: 'waiting' }))).toBe(true);
    expect(isRunUnfinished(runningRecord({ status: 'running', t1: T0 + 1 }))).toBe(false); // t1 置位即冻结
    expect(isRunUnfinished(runningRecord({ status: 'done', t1: T0 + 1 }))).toBe(false);
    expect(isRunUnfinished(runningRecord({ status: 'aborted', t1: T0 + 1 }))).toBe(false);
  });
});

describe('用时格式 fmtElapsed（demo L1753 mm:ss）', () => {
  it('0/65s/1h 三例', () => {
    expect(fmtElapsed(0)).toBe('00:00');
    expect(fmtElapsed(65_000)).toBe('01:05');
    expect(fmtElapsed(3_600_000)).toBe('60:00');
  });
});

describe('§6.1f 徽标计数 runningCountOf（demo L2763-2767）', () => {
  it('2 running→2；running 0（含 waiting/done 混布）→0', () => {
    const rows: RunRow[] = [
      { runId: 'a', flowId: 'f1', flowName: 'a', status: 'running', currentNodes: [], progress: { done: 0, total: 1 }, cdpPorts: [], elapsedMs: 0 },
      { runId: 'b', flowId: 'f2', flowName: 'b', status: 'running', currentNodes: [], progress: { done: 0, total: 1 }, cdpPorts: [], elapsedMs: 0 },
      { runId: 'c', flowId: 'f3', flowName: 'c', status: 'waiting', currentNodes: [], progress: { done: 0, total: 1 }, cdpPorts: [], elapsedMs: 0 },
      { runId: 'd', flowId: 'f4', flowName: 'd', status: 'done', currentNodes: [], progress: { done: 1, total: 1 }, cdpPorts: [], elapsedMs: 0 },
    ];
    expect(runningCountOf(rows)).toBe(2);
    expect(runningCountOf(rows.filter((r) => r.runId !== 'a' && r.runId !== 'b'))).toBe(0);
  });
});

describe('RunSummary 适配 runRecordFromSummary（C-06 runs.list 行→投影入参；T6-11 重放装载侧共用）', () => {
  it('id/name 列名归位 runId/flowName，total/t1 透传', () => {
    const rec = runRecordFromSummary({
      id: 'run-9',
      flowId: 'f1',
      name: '北京人社局',
      status: 'aborted',
      t0: 100,
      t1: 200,
      aborted: 1,
      failed: 0,
      total: 5,
      skips: [],
      createdAt: 100,
    });
    expect(rec).toEqual({ runId: 'run-9', flowId: 'f1', flowName: '北京人社局', status: 'aborted', t0: 100, t1: 200, total: 5 });
  });
});
