// @vitest-environment jsdom
// GlobalLogTab 套件（T6-11；TDD-C-10 §3 GlobalLogTab 行——01 A-9.2 全局日志 tab）。
//   - 行形「时间 级别着色 消息」：info/ok/err/warn 四级着色（demo L377）＋mono 时间列；
//   - 空态两文案：初态「暂无日志 — 跑一个任务试试」（demo L739）/清空后「已清空」（demo L2684）；
//   - LogLineRow 共享行（FlowLogPanel 复用同一点色语言）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '../run';
import { GlobalLogTab, GLOBAL_LOG_CLEARED_TEXT, GLOBAL_LOG_EMPTY_TEXT } from './global-log-tab';
import { LOG_LINE_LEVEL_CLASS, LogLineRow } from './log-line-row';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactElement): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function line(over: Partial<LogLine> = {}): LogLine {
  return { ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '任务启动', flowId: 'f4', ...over };
}

describe('GlobalLogTab（级别着色＋空态——A-9.2）', () => {
  it('每行「时间 级别 消息」：四级 data-log-level 标记＋ok=accent/err=red/warn=amber/info=tx-2（demo L377）', async () => {
    const lines = [
      line({ level: 'info', msg: '普通行' }),
      line({ level: 'ok', msg: 'CDP 会话 :9221 就绪' }),
      line({ level: 'err', msg: '任务失败' }),
      line({ level: 'warn', msg: '任务已终止' }),
    ];
    const { container, root } = await mount(<GlobalLogTab lines={lines} />);
    try {
      const rows = container.querySelectorAll('[data-log-line]');
      expect(rows.length).toBe(4);
      expect(rows[0]?.getAttribute('data-log-line')).toBe('info');
      expect(rows[0]?.textContent).toContain('2026-11-11T03:00:00.000Z');
      expect(rows[0]?.textContent).toContain('普通行');
      expect([...rows].map((r) => r.getAttribute('data-log-line'))).toEqual(['info', 'ok', 'err', 'warn']);
      // 级别着色（demo L377 四级类映射）
      expect(rows[0]?.querySelector('[data-log-msg]')?.className).toContain(LOG_LINE_LEVEL_CLASS.info);
      expect(rows[1]?.querySelector('[data-log-msg]')?.className).toContain(LOG_LINE_LEVEL_CLASS.ok);
      expect(rows[2]?.querySelector('[data-log-msg]')?.className).toContain(LOG_LINE_LEVEL_CLASS.err);
      expect(rows[3]?.querySelector('[data-log-msg]')?.className).toContain(LOG_LINE_LEVEL_CLASS.warn);
    } finally {
      await unmount(root);
    }
  });

  it('空态两文案：初态=暂无日志（demo L739）；cleared=已清空（demo L2684）', async () => {
    expect(GLOBAL_LOG_EMPTY_TEXT).toBe('暂无日志 — 跑一个任务试试');
    expect(GLOBAL_LOG_CLEARED_TEXT).toBe('已清空');
    const { container, root } = await mount(<GlobalLogTab lines={[]} />);
    try {
      expect(container.querySelector('[data-task-center="log-empty"]')?.textContent).toBe(GLOBAL_LOG_EMPTY_TEXT);
    } finally {
      await unmount(root);
    }
    const second = await mount(<GlobalLogTab lines={[]} cleared />);
    try {
      expect(second.container.querySelector('[data-task-center="log-empty"]')?.textContent).toBe(GLOBAL_LOG_CLEARED_TEXT);
    } finally {
      await unmount(second.root);
    }
  });

  it('LogLineRow 共享行：ts/level/msg 三段（FlowLogPanel 复用）', async () => {
    const { container, root } = await mount(<LogLineRow line={line({ level: 'ok', msg: '就绪' })} />);
    try {
      const row = container.querySelector('[data-log-line="ok"]');
      expect(row?.querySelector('[data-log-ts]')?.textContent).toBe('2026-11-11T03:00:00.000Z');
      expect(row?.querySelector('[data-log-msg]')?.textContent).toBe('就绪');
    } finally {
      await unmount(root);
    }
  });
});
