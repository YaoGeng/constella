// @vitest-environment jsdom
// TaskCenterPanel 套件（T6-10；TDD-C-10 §1 交互语义「抽屉开合/Esc 层级序」——壳半段）。
//   - 开合态=uiStore 任务中心位（02 §3.3）：open→抽屉+毛玻璃遮罩展开；close→收起；
//   - Esc 收起应答：开即应答；escGate()=false（上层浮层在场——A-1.4 层级序）→不应答；
//   - 点遮罩/✕ 收起；
//   - 任务/日志双 tab：任务=RunTable 行渲染（数据经 Provider 注入装配）；日志=占位（T6-11 填充）；
//   - 抽屉 480px（01 §13 TC-2 裁定）＋右侧全高形态。
//   - 行内动作经 Provider 注入位贯通：终止钮→abortRun（恰一次——c 例贯通）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCenterPanel } from './task-center-panel';
import { TaskCenterProvider, type TaskCenterDeps } from './task-center-context';
import { useUiStore } from './ui-store';
import type { TaskRunRecord } from './run-row';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_700_000_000_000;

/** C-03 runStore 结构子集 fake */
function fakeRunStore() {
  let state = { lastRunOfFlow: {} as Record<string, { runId: string; statuses: Record<string, string> }> };
  const listeners = new Set<(s: unknown) => void>();
  return {
    getState: () => state,
    subscribe: (fn: (s: unknown) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    push: (m: typeof state.lastRunOfFlow) => {
      state = { lastRunOfFlow: m };
      for (const l of [...listeners]) l(state);
    },
  };
}

function fakeDeps(over: Partial<TaskCenterDeps> = {}): TaskCenterDeps {
  return {
    listRuns: (): TaskRunRecord[] => [
      { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'running', t0: T0, t1: null, total: 7 },
    ],
    runStore: fakeRunStore() as unknown as TaskCenterDeps['runStore'],
    portsOf: () => [9221],
    nodeName: (_f: string, id: string) => `节点${id}`,
    abortRun: vi.fn(),
    onGoto: vi.fn(),
    ...over,
  };
}

async function mountPanel(deps: TaskCenterDeps): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TaskCenterProvider deps={deps}>
        <TaskCenterPanel />
      </TaskCenterProvider>,
    );
  });
  return { container, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function pressEsc(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

beforeEach(() => {
  useUiStore.getState().reset();
});

describe('抽屉开合（开合态=uiStore 任务中心位）', () => {
  it('uiStore open → 面板+遮罩展开；close → 收起（data-open 位）', async () => {
    const deps = fakeDeps();
    const { container, root } = await mountPanel(deps);
    try {
      expect(container.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('false');
      expect(container.querySelector('[data-task-center="shade"]')).toBeNull();

      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('true');
      expect(container.querySelector('[data-task-center="shade"]')).toBeTruthy();

      await act(async () => {
        useUiStore.getState().closeTaskCenter();
      });
      expect(container.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('false');
    } finally {
      await unmount(root);
    }
  });

  it('右侧全高 480px（01 §13 TC-2 裁定）', async () => {
    const { container, root } = await mountPanel(fakeDeps());
    try {
      const panel = container.querySelector<HTMLElement>('[data-task-center="panel"]');
      expect(panel?.style.width).toBe('480px');
      expect(panel?.className).toContain('right-0');
      expect(panel?.className).toContain('h-full');
    } finally {
      await unmount(root);
    }
  });
});

describe('Esc 层级序应答（A-1.4「CDP 查看窗→抽屉→任务中心→弹窗」——本层=抽屉级收起）', () => {
  it('开态按 Esc → 收起', async () => {
    const { container, root } = await mountPanel(fakeDeps());
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        pressEsc();
      });
      expect(useUiStore.getState().taskCenterOpen).toBe(false);
      expect(container.querySelector('[data-task-center="panel"]')?.getAttribute('data-open')).toBe('false');
    } finally {
      await unmount(root);
    }
  });

  it('escGate()=false（上层浮层在场）→ 本层不应答（层级序仲裁注入位）', async () => {
    const { root } = await mountPanel(fakeDeps({ escGate: () => false }));
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        pressEsc();
      });
      expect(useUiStore.getState().taskCenterOpen).toBe(true); // 上层消费，任务中心不动
    } finally {
      await unmount(root);
    }
  });

  it('闭态按 Esc → 无动作（不误开）', async () => {
    const { root } = await mountPanel(fakeDeps());
    try {
      await act(async () => {
        pressEsc();
      });
      expect(useUiStore.getState().taskCenterOpen).toBe(false);
    } finally {
      await unmount(root);
    }
  });
});

describe('遮罩/✕ 收起（demo L2666-2680：Esc/点遮罩均可关）', () => {
  it('点遮罩收起；点 ✕ 收起', async () => {
    const { container, root } = await mountPanel(fakeDeps());
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-task-center="shade"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(useUiStore.getState().taskCenterOpen).toBe(false);

      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center="close"]')?.click();
      });
      expect(useUiStore.getState().taskCenterOpen).toBe(false);
    } finally {
      await unmount(root);
    }
  });
});

describe('任务/日志双 tab（日志=占位，T6-11 GlobalLogTab 填充）', () => {
  it('默认任务 tab 渲染 RunTable 行；切日志 tab → 占位面', async () => {
    const { container, root } = await mountPanel(fakeDeps());
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-row="r1"]')).toBeTruthy(); // 任务表行
      expect(container.querySelector('[data-task-center="log-placeholder"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="logs"]')?.click();
      });
      expect(container.querySelector('[data-task-center="log-placeholder"]')).toBeTruthy();
      expect(container.querySelector('[data-task-row="r1"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="tasks"]')?.click();
      });
      expect(container.querySelector('[data-task-row="r1"]')).toBeTruthy();
    } finally {
      await unmount(root);
    }
  });

  it('行内终止经注入位贯通：点终止 → abortRun 恰一次（§6.1c 贯通例）', async () => {
    const deps = fakeDeps();
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-act="stop"]')?.click();
      });
      expect(deps.abortRun).toHaveBeenCalledTimes(1);
      expect(deps.abortRun).toHaveBeenCalledWith('r1');
    } finally {
      await unmount(root);
    }
  });

  it('未装配 Provider（应用壳缺位防御）→ 空任务表面不炸', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TaskCenterPanel />);
    });
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-center="empty"]')?.textContent).toContain('暂无任务');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
