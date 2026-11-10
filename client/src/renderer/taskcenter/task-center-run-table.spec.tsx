// @vitest-environment jsdom
// RunTable＋RunBadge 套件（T6-10；TDD-C-10 §6.1a 渲染半段＋§6.1f 徽标渲染）。
//   - 行 DOM 逐列：状态点色（data-task-tone）/流程名/状态文案＋currentNodes「·」连接/
//     progress n/m/cdpPorts 「:9221/:9222」/用时 mm:ss（demo L2770-2790 renderTasks 同构）；
//   - 空态文案（demo L2773 逐字）；
//   - 徽标：2 running→「2」、0→隐藏（demo L2763-2767 renderNavBadge）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { RunTable } from './run-table';
import { RunBadge } from './run-badge';
import { runningCountOf, type RunRow } from './run-row';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function row(over: Partial<RunRow>): RunRow {
  return {
    runId: 'r1',
    flowId: 'f4',
    flowName: '监控 UP 主',
    status: 'running',
    currentNodes: [],
    progress: { done: 0, total: 1 },
    cdpPorts: [],
    elapsedMs: 0,
    ...over,
  };
}

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

describe('RunTable 行渲染（RunRow→行 DOM，01 A-9.1 逐列）', () => {
  it('状态点/流程名/两分支「·」连接/进度 3/7/端口 :9221/:9222/用时 mm:ss', async () => {
    const rows = [
      row({
        status: 'running',
        currentNodes: ['抓取视频列表', '截图存档'],
        progress: { done: 3, total: 7 },
        cdpPorts: [9221, 9222],
        elapsedMs: 65_000,
      }),
    ];
    const { container, root } = await mount(<RunTable rows={rows} onStop={() => {}} onGoto={() => {}} />);
    try {
      const rowEl = container.querySelector('[data-task-row="r1"]');
      expect(rowEl).toBeTruthy();
      expect(container.querySelector('[data-task-tone="ok"]')).toBeTruthy(); // running=青
      expect(rowEl?.querySelector('b')?.textContent).toBe('监控 UP 主');
      expect(rowEl?.querySelector('[data-task-meta]')?.textContent).toBe('运行中 · 抓取视频列表 · 截图存档 · 3/7 · :9221/:9222');
      expect(rowEl?.querySelector('[data-task-elapsed="r1"]')?.textContent).toBe('01:05');
    } finally {
      await unmount(root);
    }
  });

  it('waiting=琥珀/error·aborted=红 点色映射（01 A-9.1）', async () => {
    const rows = [
      row({ runId: 'w', flowId: 'a', status: 'waiting' }),
      row({ runId: 'e', flowId: 'b', status: 'error' }),
      row({ runId: 'x', flowId: 'c', status: 'aborted' }),
    ];
    const { container, root } = await mount(<RunTable rows={rows} onStop={() => {}} onGoto={() => {}} />);
    try {
      expect(container.querySelector('[data-task-row="w"] [data-task-tone="wait"]')).toBeTruthy();
      expect(container.querySelector('[data-task-row="e"] [data-task-tone="off"]')).toBeTruthy();
      expect(container.querySelector('[data-task-row="x"] [data-task-tone="off"]')).toBeTruthy();
    } finally {
      await unmount(root);
    }
  });

  it('空态文案（demo L2773 逐字）＋零行数', async () => {
    const { container, root } = await mount(<RunTable rows={[]} onStop={() => {}} onGoto={() => {}} />);
    try {
      expect(container.querySelector('[data-task-center="empty"]')?.textContent).toBe(
        '暂无任务 — 点「▶ 运行」启动；并行分支各得独立 CDP 会话，右上角 CDP 列表打开窗口',
      );
      expect(container.querySelectorAll('[data-task-row]')).toHaveLength(0);
    } finally {
      await unmount(root);
    }
  });
});

describe('§6.1f 导航徽标 RunBadge（demo L2763-2767：n>0 才显示）', () => {
  it('2 running→「2」；0 running→隐藏（不渲染）', async () => {
    const two = [
      row({ runId: 'a', flowId: 'f1', status: 'running' }),
      row({ runId: 'b', flowId: 'f2', status: 'running' }),
      row({ runId: 'c', flowId: 'f3', status: 'waiting' }),
    ];
    const shown = await mount(<RunBadge count={runningCountOf(two)} />);
    try {
      expect(shown.container.querySelector('[data-task-center-badge]')?.textContent).toBe('2');
    } finally {
      await unmount(shown.root);
    }
    const hidden = await mount(<RunBadge count={runningCountOf(two.filter((r) => r.status !== 'running'))} />);
    try {
      expect(hidden.container.querySelector('[data-task-center-badge]')).toBeNull(); // 0→隐藏
    } finally {
      await unmount(hidden.root);
    }
  });
});
