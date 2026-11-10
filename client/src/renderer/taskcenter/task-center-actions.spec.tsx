// @vitest-environment jsdom
// TaskActions 套件（T6-10；TDD-C-10 §6.1c「终止调用」——行内动作注入位）。
//   c1) running 行点终止 → onStop(runId) 恰一次（C-03 abortRun 注入面——单次点击单次派发）；
//   c2) done/error 行无终止钮（仅 running 显示——demo L2788）；
//   c3) 定位钮：仅 flowId≠activeFlow 行显示（demo L2789）＋点击 → onGoto(runId) 恰一次
//       （脏闸语义归 T6-11 冻结——本卡只留注入位）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TaskActions } from './task-actions';
import type { RunRow } from './run-row';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function row(over: Partial<RunRow>): RunRow {
  return {
    runId: 'r1',
    flowId: 'f4',
    flowName: '监控 UP 主',
    status: 'running',
    currentNodes: [],
    progress: { done: 1, total: 3 },
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

describe('§6.1c 行内终止（仅 running→注入 abortRun 恰一次）', () => {
  it('running 行点终止 → onStop 恰一次且携带 runId', async () => {
    const onStop = vi.fn();
    const { container, root } = await mount(<TaskActions row={row({})} onStop={onStop} onGoto={() => {}} />);
    try {
      const btn = container.querySelector<HTMLButtonElement>('[data-task-act="stop"]');
      expect(btn).toBeTruthy();
      await act(async () => {
        btn?.click();
      });
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledWith('r1');
    } finally {
      await unmount(root);
    }
  });

  it('done/error/aborted/waiting 行无终止钮', async () => {
    for (const status of ['done', 'error', 'aborted', 'waiting'] as const) {
      const { container, root } = await mount(<TaskActions row={row({ status })} onStop={() => {}} onGoto={() => {}} />);
      try {
        expect(container.querySelector('[data-task-act="stop"]'), status).toBeNull();
      } finally {
        await unmount(root);
      }
    }
  });
});

describe('定位钮（注入位——编排/脏闸归 T6-11 与应用壳）', () => {
  it('flowId≠activeFlow 行显示，点击 → onGoto 恰一次', async () => {
    const onGoto = vi.fn();
    const { container, root } = await mount(
      <TaskActions row={row({ flowId: 'f4' })} activeFlowId="f1" onStop={() => {}} onGoto={onGoto} />,
    );
    try {
      const btn = container.querySelector<HTMLButtonElement>('[data-task-act="goto"]');
      expect(btn).toBeTruthy();
      await act(async () => {
        btn?.click();
      });
      expect(onGoto).toHaveBeenCalledTimes(1);
      expect(onGoto).toHaveBeenCalledWith('r1');
    } finally {
      await unmount(root);
    }
  });

  it('同流程行（flowId===activeFlow）无定位钮；activeFlowId 缺省 null=他流程恒显示', async () => {
    const same = await mount(<TaskActions row={row({ flowId: 'f1' })} activeFlowId="f1" onStop={() => {}} onGoto={() => {}} />);
    try {
      expect(same.container.querySelector('[data-task-act="goto"]')).toBeNull();
    } finally {
      await unmount(same.root);
    }
    const noActive = await mount(<TaskActions row={row({ flowId: 'f1' })} onStop={() => {}} onGoto={() => {}} />);
    try {
      expect(noActive.container.querySelector('[data-task-act="goto"]')).toBeTruthy();
    } finally {
      await unmount(noActive.root);
    }
  });
});
