// @vitest-environment jsdom
// TaskNotices 套件（T6-11；TDD-C-10 §8① lane 内存告警行（注入位 laneMemories——生产数据面=
// env:systemInfo lanes 真数据〔T6-16 复跑落位，装配级真形测试见 assembly/app-shell spec〕）
// ＋§8② cron missed 提示行（A-6.6 只提示不补跑）。纯渲染件＋两个纯函数（lane 预算过滤/文案）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LANE_MEMORY_BUDGET_BYTES, type LaneMemory } from '@constella/shared/ipc';
import {
  TaskNotices,
  cronMissedText,
  formatMissedTime,
  laneMemoryAlertText,
  overBudgetLanes,
} from './task-notices';
import type { CronMissedNotice } from './log-replay-service';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function lane(over: Partial<LaneMemory> = {}): LaneMemory {
  return { laneKey: 'main', label: '主分支', workingSetBytes: 100 * 1024 * 1024, ...over };
}

function missed(over: Partial<CronMissedNotice> = {}): CronMissedNotice {
  return { flowId: 'f4', flowName: '监控 UP 主', lastFireAt: Date.UTC(2026, 10, 11, 3, 0), count: 3, truncated: false, ...over };
}

async function mountNotices(m: readonly CronMissedNotice[], lanes: readonly LaneMemory[]): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TaskNotices missed={m} laneMemories={lanes} />);
  });
  return { container, root };
}

describe('§8① lane 内存告警行（注入位 laneMemories——生产=env:systemInfo lanes 真数据〔T6-16 复跑〕）', () => {
  it('超预算过滤：workingSetBytes>150MB 命中（边界=恰 150MB 不告警）', () => {
    const over = overBudgetLanes([
      lane({ laneKey: 'a', workingSetBytes: 149 * 1024 * 1024 }),
      lane({ laneKey: 'b', workingSetBytes: LANE_MEMORY_BUDGET_BYTES }), // 恰预算=不超
      lane({ laneKey: 'c', workingSetBytes: 151 * 1024 * 1024 }),
      lane({ laneKey: 'd', workingSetBytes: 300 * 1024 * 1024 }),
    ]);
    expect(over.map((l) => l.laneKey)).toEqual(['c', 'd']);
  });

  it('告警文案：lane 名＋MB 数＋预算（01 §12「单 lane 会话预算 ≤150MB，超预算在任务中心告警」）', () => {
    expect(laneMemoryAlertText(lane({ label: '主分支', workingSetBytes: 151 * 1024 * 1024 }))).toBe(
      '「主分支」内存 151MB 超预算（150MB）',
    );
  });
});

describe('§8② cron missed 提示行（A-6.6 逐字模板）', () => {
  it('文案=「上次计划触发 <时间> 未执行，可手动运行」＋本地时间 YYYY-MM-DD HH:mm', () => {
    const at = Date.UTC(2026, 10, 11, 3, 5); // 2026-11-11T03:05Z
    expect(formatMissedTime(at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(cronMissedText(missed({ lastFireAt: at }))).toBe(`上次计划触发 ${formatMissedTime(at)} 未执行，可手动运行`);
  });
});

describe('TaskNotices 渲染（任务中心提示行——§8①②）', () => {
  it('cron missed 行＋lane 超预算行并列渲染；两者皆空 → 整块不渲染', async () => {
    const { container, root } = await mountNotices(
      [missed()],
      [lane({ laneKey: 'c', label: '分支C', workingSetBytes: 200 * 1024 * 1024 })],
    );
    try {
      expect(container.querySelector('[data-task-notice="cron-missed"]')?.textContent).toContain('上次计划触发');
      expect(container.querySelector('[data-task-notice="cron-missed"]')?.textContent).toContain('未执行，可手动运行');
      expect(container.querySelector('[data-task-notice="lane-memory"]')?.textContent).toBe('「分支C」内存 200MB 超预算（150MB）');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
    const empty = await mountNotices([], []);
    try {
      expect(empty.container.querySelector('[data-task-notices]')).toBeNull(); // 零提示零占位
    } finally {
      await act(async () => {
        empty.root.unmount();
      });
    }
  });
});
