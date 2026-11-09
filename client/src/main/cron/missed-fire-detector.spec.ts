// MissedFireDetector 规格（T4-19 / TDD-C-M1 §6.3c——fake timers；A-6.6 错过不补跑只提示：
// 本组件只「计算」错过点——main 日志留痕＋renderer 启动自算〔C-10〕的数据语义源，无补跑副作用）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissedFireDetector, type MissedFireSchedule } from './missed-fire-detector';

/** 局部时间（五段式=本地墙钟） */
function at(y: number, m0: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m0, d, h, min, s);
}

describe('MissedFireDetector §6.3c：启动按 (lastAliveAt, now] 计算错过点', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lastAliveAt=昨日 19:00、now=今日 21:00、0 20 * * * → MissedFire 含今日 20:00', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0)); // 今日=2026-11-09 21:00
    const schedules: MissedFireSchedule[] = [{ flowId: 'f9', cron: '0 20 * * *' }];
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 8, 19, 0, 0).getTime() });
    const missed = detector.detect(schedules);
    // 窗口 (昨日19:00, 今日21:00]：昨日 20:00 与今日 20:00 两点均错过；验收锚=含今日 20:00
    expect(missed.map((m) => m.fireAt)).toEqual([
      at(2026, 10, 8, 20, 0, 0).getTime(),
      at(2026, 10, 9, 20, 0, 0).getTime(),
    ]);
    expect(missed.every((m) => m.flowId === 'f9' && m.cron === '0 20 * * *')).toBe(true);
  });

  it('左开：fireAt==lastAliveAt 不计（上次会话存活的分钟边界归上次会话）', () => {
    vi.setSystemTime(at(2026, 10, 9, 20, 5, 0));
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 9, 20, 0, 0).getTime() });
    expect(detector.detect([{ flowId: 'f1', cron: '0 20 * * *' }])).toEqual([]);
  });

  it('右闭：fireAt==now 恰计入（本次启动前最后一刻的触发点属错过）', () => {
    vi.setSystemTime(at(2026, 10, 9, 20, 0, 0));
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 8, 20, 0, 30).getTime() });
    const missed = detector.detect([{ flowId: 'f1', cron: '0 20 * * *' }]);
    expect(missed.map((m) => m.fireAt)).toEqual([at(2026, 10, 9, 20, 0, 0).getTime()]);
  });

  it('lastAliveAt=null（首启无键）→ 空（无窗口基线，不误报全历史）', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    const detector = new MissedFireDetector({ lastAliveAt: null });
    expect(detector.detect([{ flowId: 'f1', cron: '* * * * *' }])).toEqual([]);
  });

  it('步进窗内逐点：lastAliveAt=10:00:30、now=10:14、*/5 → 10:05/10:10（10:15 未到）', () => {
    vi.setSystemTime(at(2026, 10, 9, 10, 14, 0));
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 9, 10, 0, 30).getTime() });
    const missed = detector.detect([{ flowId: 'f2', cron: '*/5 * * * *' }]);
    expect(missed.map((m) => m.fireAt)).toEqual([
      at(2026, 10, 9, 10, 5, 0).getTime(),
      at(2026, 10, 9, 10, 10, 0).getTime(),
    ]);
  });

  it('非法表达式跳过（不产生错过点、不抛错）；多流程并列计算', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 9, 19, 30, 0).getTime() });
    const missed = detector.detect([
      { flowId: 'f-bad', cron: '61 * * * *' },
      { flowId: 'f-ok', cron: '0 20 * * *' },
    ]);
    expect(missed.map((m) => [m.flowId, m.fireAt])).toEqual([['f-ok', at(2026, 10, 9, 20, 0, 0).getTime()]]);
  });

  it('纯计算无副作用：detect 不写任何注入面（A-6.6 不补跑——补跑缺失即本组件语义）', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    const detector = new MissedFireDetector({ lastAliveAt: at(2026, 10, 8, 19, 0, 0).getTime() });
    expect(() => detector.detect([{ flowId: 'f9', cron: '0 20 * * *' }])).not.toThrow();
  });

  it('防呆上限：* * * * * 超 10000 分钟窗口 → 恰 10000 点且末点 truncated=true', () => {
    vi.setSystemTime(at(2026, 10, 9, 21, 0, 0));
    // 10020 分钟前的存活基线 → 窗口内理论 10020 点，上限截断为 10000
    const lastAliveAt = at(2026, 10, 9, 21, 0, 0).getTime() - 10_020 * 60_000;
    const detector = new MissedFireDetector({ lastAliveAt });
    const missed = detector.detect([{ flowId: 'fm', cron: '* * * * *' }]);
    expect(missed.length).toBe(10_000);
    expect(missed.at(-1)?.truncated).toBe(true);
    expect(missed[0]?.truncated).toBe(false);
  });
});
