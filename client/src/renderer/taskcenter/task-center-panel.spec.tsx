// @vitest-environment jsdom
// TaskCenterPanel 套件（T6-10 壳半段＋T6-11 后段：日志 tab/清空双语义/提示行/脏闸贯通）。
//   - 开合态=uiStore 任务中心位（02 §3.3）：open→抽屉+遮罩展开；close→收起；
//   - Esc 收起应答：开即应答；escGate()=false（上层浮层在场——A-1.4 层级序）→不应答；
//   - 任务/日志双 tab：任务=RunTable 行渲染；日志=GlobalLogTab（T6-11——级别行＋清空态）；
//   - 清空跟 tab（§6.1e——demo L2682-2688）：日志 tab=全局清；任务 tab=已结束移除 running 保留；
//   - 提示行（§8①②）：cron missed（notices store）＋lane 内存告警（mock 注入）；
//   - 定位脏闸贯通（§6.1d）：deps.locate 注入→onGoto 经 locateRun 编排（dirty=toast 拒绝）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneMemory } from '@constella/shared/ipc';
import { TaskCenterPanel } from './task-center-panel';
import { TaskCenterProvider, useTaskCenter, type TaskCenterDeps, type TaskCenterHandle } from './task-center-context';
import { useUiStore } from './ui-store';
import { createLogsBus } from './runs-bus';
import type { LogLine } from '../run';
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

async function mountPanel(deps: TaskCenterDeps): Promise<{ container: HTMLDivElement; root: Root; handle: TaskCenterHandle | null }> {
  let handle: TaskCenterHandle | null = null;
  function Probe(): null {
    handle = useTaskCenter(); // 上下文观测位（notices store 驱动）
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TaskCenterProvider deps={deps}>
        <Probe />
        <TaskCenterPanel />
      </TaskCenterProvider>,
    );
  });
  return { container, root, handle };
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

describe('任务/日志双 tab（日志=GlobalLogTab——T6-11 填充）', () => {
  function logLine(over: Partial<LogLine> = {}): LogLine {
    return { ts: '2026-11-11T03:00:00.000Z', level: 'ok', msg: 'CDP 会话 :9221 就绪', ...over };
  }

  it('默认任务 tab 渲染 RunTable 行；切日志 tab → GlobalLogTab 行（占位块已替换）', async () => {
    const bus = createLogsBus();
    bus.publish(logLine());
    const deps = fakeDeps({ logs: bus });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-row="r1"]')).toBeTruthy(); // 任务表行
      expect(container.querySelector('[data-task-center="log-list"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="logs"]')?.click();
      });
      expect(container.querySelector('[data-task-center="log-list"]')).toBeTruthy(); // GlobalLogTab 面板
      expect(container.querySelector('[data-log-msg]')?.textContent).toBe('CDP 会话 :9221 就绪');
      expect(container.querySelector('[data-task-row="r1"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="tasks"]')?.click();
      });
      expect(container.querySelector('[data-task-row="r1"]')).toBeTruthy();
    } finally {
      bus.dispose();
      await unmount(root);
    }
  });

  it('未注入 logs（装配缺位）→ 日志 tab 空态面不炸（初态文案）', async () => {
    const deps = fakeDeps();
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="logs"]')?.click();
      });
      expect(container.querySelector('[data-task-center="log-empty"]')?.textContent).toBe('暂无日志 — 跑一个任务试试');
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

describe('清空跟 tab（§6.1e——demo L2682-2688：日志 tab=全局清；任务 tab=已结束移除 running 保留）', () => {
  it('日志 tab 点清空 → 全局缓冲清＋「已清空」空态（A-9.2）', async () => {
    const bus = createLogsBus();
    bus.publish({ ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '一行' });
    const deps = fakeDeps({ logs: bus });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
        container.querySelector<HTMLButtonElement>('[data-task-center-tab="logs"]')?.click();
      });
      expect(container.querySelector('[data-task-center="log-count"]')?.textContent).toBe('1 条'); // 计数（demo L1288）
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center="clear"]')?.click();
      });
      expect(bus.snapshot()).toEqual([]);
      expect(container.querySelector('[data-task-center="log-empty"]')?.textContent).toBe('已清空'); // demo L2684
      expect(container.querySelector('[data-task-center="log-count"]')?.textContent).toBe('0 条');
    } finally {
      bus.dispose();
      await unmount(root);
    }
  });

  it('任务 tab 点清空 → 已结束行移除、running 保留（03 §1「仅清已结束 run、运行中保留」）', async () => {
    const deps = fakeDeps({
      listRuns: (): TaskRunRecord[] => [
        { runId: 'r1', flowId: 'f4', flowName: '监控 UP 主', status: 'running', t0: T0, t1: null, total: 7 },
        { runId: 'r9', flowId: 'f2', flowName: '旧任务', status: 'done', t0: T0, t1: T0 + 9, total: 7 },
      ],
    });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-row="r9"]')).toBeTruthy();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-center="clear"]')?.click(); // 任务 tab（默认）
      });
      expect(container.querySelector('[data-task-row="r9"]')).toBeNull(); // 已结束移除
      expect(container.querySelector('[data-task-row="r1"]')).toBeTruthy(); // running 保留
    } finally {
      await unmount(root);
    }
  });
});

describe('提示行（§8① lane 内存告警 mock＋§8② cron missed——任务 tab 顶部）', () => {
  it('laneMemories 注入超预算 → 告警行（mock 先行——数据面随 C-M1 事件）', async () => {
    const lanes: LaneMemory[] = [{ laneKey: 'c', label: '分支C', workingSetBytes: 200 * 1024 * 1024 }];
    const deps = fakeDeps({ laneMemories: () => lanes });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      expect(container.querySelector('[data-task-notice="lane-memory"]')?.textContent).toBe('「分支C」内存 200MB 超预算（150MB）');
    } finally {
      await unmount(root);
    }
  });

  it('notices store 注入 missedFires（restoreRunState 产出装配位）→ cron missed 提示行', async () => {
    const deps = fakeDeps();
    const { container, root, handle } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
        handle?.notices.setMissed([{ flowId: 'f4', flowName: '监控 UP 主', lastFireAt: Date.UTC(2026, 10, 11, 3, 0), count: 2, truncated: false }]);
      });
      expect(container.querySelector('[data-task-notice="cron-missed"]')?.textContent).toContain('上次计划触发');
      expect(container.querySelector('[data-task-notice="cron-missed"]')?.textContent).toContain('未执行，可手动运行');
    } finally {
      await unmount(root);
    }
  });
});

describe('定位脏闸贯通（§6.1d——deps.locate 注入 → onGoto 经 locateRun 编排）', () => {
  function locateDeps(over: Partial<NonNullable<TaskCenterDeps['locate']>> = {}) {
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

  it('非 dirty：点定位 → 切流程原语恰一次（runStore 镜像 statuses 焦点）', async () => {
    const loc = locateDeps();
    const deps = fakeDeps({ locate: loc });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-act="goto"]')?.click();
      });
      expect(loc.switchFlow).toHaveBeenCalledTimes(1);
      expect(loc.switchFlow).toHaveBeenCalledWith('f4');
      expect(loc.fitView).toHaveBeenCalledTimes(1); // r1 无镜像 statuses → 无焦点 → fitView 回退
    } finally {
      await unmount(root);
    }
  });

  it('dirty：toast 拒绝（demo L2796 逐字）＋切流程零调用', async () => {
    const loc = locateDeps({ isDirty: () => true });
    const deps = fakeDeps({ locate: loc });
    const { container, root } = await mountPanel(deps);
    try {
      await act(async () => {
        useUiStore.getState().openTaskCenter();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-task-act="goto"]')?.click();
      });
      expect(loc.toast).toHaveBeenCalledWith('err', '有未保存改动 — 先保存或取消');
      expect(loc.switchFlow).not.toHaveBeenCalled();
    } finally {
      await unmount(root);
    }
  });
});
