// runs$·logs$ Bus 套件（T6-11；TDD-C-10 §1 runs$/logs$ 契约面＋§3 Bus 行——LogLine 双路分发）。
//   - logs$ face：subscribe(fn: (line) => void)（§1 逐字）——publish 恰一次分发到每订阅方
//     （全局 tab＋流程面板双路各恰一次）；
//   - 全局缓冲：snapshot 增量追加；clear=全局清（A-9.2——清空后空态文案判据 wasCleared）；
//   - 上游装配：createLogsBus(onRunLog) —— C-03 onRunLog 事件→publish 唯一入口；
//   - runs$ 包裹 T6-10 RunsSource（subscribe/snapshot 透传）。
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../run';
import { asRuns$, createLogsBus } from './runs-bus';
import { createRunsSource } from './runs-source';
import { useRunStore } from '../run';
import type { TaskRunRecord } from './run-row';

const T0 = 1_700_000_000_000;

function line(over: Partial<LogLine> = {}): LogLine {
  return { ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '行', flowId: 'f4', ...over };
}

describe('logs$ Bus（§1 face：实时行流＋双路分发恰一次）', () => {
  it('publish → 每订阅方恰一次收到（全局 tab＋流程面板双路各恰一次——§6.1h 分发半段）', () => {
    const bus = createLogsBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    const l = line({ msg: '任务启动' });
    bus.publish(l);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(l);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(l);
    bus.publish(line({ msg: '第二行' }));
    expect(a).toHaveBeenCalledTimes(2);
    bus.dispose();
  });

  it('退订后不再分发；dispose 后零分发', () => {
    const bus = createLogsBus();
    const a = vi.fn();
    const unsub = bus.subscribe(a);
    unsub();
    bus.publish(line());
    expect(a).not.toHaveBeenCalled();
    bus.subscribe(a);
    bus.dispose();
    bus.publish(line());
    expect(a).not.toHaveBeenCalled();
  });

  it('全局缓冲 snapshot 增量追加（GlobalLogTab 渲染面）；clear=全局清＋wasCleared 位＋onChanged 通知', () => {
    const bus = createLogsBus();
    expect(bus.snapshot()).toEqual([]);
    expect(bus.wasCleared()).toBe(false); // 初态（demo L739「暂无日志」文案判据）
    bus.publish(line({ msg: 'a' }));
    bus.publish(line({ msg: 'b', level: 'err' }));
    expect(bus.snapshot().map((l) => l.msg)).toEqual(['a', 'b']);
    const changes: string[] = [];
    bus.onChanged(() => changes.push('c'));
    bus.clear(); // A-9.2 清空=全局清（demo L2684 logs=[]）
    expect(bus.snapshot()).toEqual([]);
    expect(bus.wasCleared()).toBe(true); // demo L2684「已清空」文案判据
    expect(changes).toEqual(['c']); // 快照消费面（useSyncExternalStore 驱动）
    bus.publish(line({ msg: 'c' }));
    expect(changes).toEqual(['c', 'c']); // publish 同样驱动快照变更
    expect(bus.wasCleared()).toBe(false); // 新行到达复位（空态不再显示「已清空」）
    expect(bus.snapshot().map((l) => l.msg)).toEqual(['c']);
    bus.dispose();
  });

  it('上游装配：createLogsBus(onRunLog) —— C-03 事件面经 publish 单点进入（恰一次）', () => {
    const upstreamLines: Array<(l: LogLine) => void> = [];
    const bus = createLogsBus((fn) => {
      upstreamLines.push(fn);
      return () => undefined;
    });
    const a = vi.fn();
    bus.subscribe(a);
    upstreamLines[0]?.(line({ msg: '经上游' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(bus.snapshot().map((l) => l.msg)).toEqual(['经上游']);
    bus.dispose();
  });
});

describe('runs$ 包裹 RunsSource（§1 runs$ face：subscribe/snapshot 透传）', () => {
  it('asRuns$ 透传订阅与快照（T6-10 RunsSource 即 runs$ 数据源）', () => {
    useRunStore.getState().reset();
    const rec: TaskRunRecord = { runId: 'r1', flowId: 'f4', flowName: '监控', status: 'running', t0: T0, t1: null, total: 7 };
    const source = createRunsSource({
      listRuns: () => [rec],
      runStore: useRunStore,
      portsOf: () => [9221],
      nodeName: () => 'x',
      now: () => T0,
    });
    const runs$ = asRuns$(source);
    expect(runs$.snapshot()[0]?.runId).toBe('r1'); // 快照透传
    const seen: number[] = [];
    const unsub = runs$.subscribe((rows) => seen.push(rows.length)); // 订阅只听后续发射（T6-10 语义）
    source.setRuns([]);
    expect(seen.at(-1)).toBe(0);
    unsub();
    source.dispose();
  });
});
