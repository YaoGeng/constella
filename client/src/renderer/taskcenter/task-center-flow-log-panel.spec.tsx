// @vitest-environment jsdom
// FlowLogPanel 套件（T6-11；TDD-C-10 §6.1h「流程日志」——01 A-9.3/demo L2966-2980/L1289-1295）。
//   h1) 打开→重放 logs.list{flowId} 行序一致（注入 replayLogs——LogReplayService.replayLogs 面）；
//   h2) 实时行：logs$ 双路（全局 tab＋流程面板）各恰一次追加＋自动滚底；非当前流程行/无 flowId
//       行不追（demo L1293 flowId===activeFlow 判据）；
//   h3) 切流程→清空＋重放新流程（demo L1707 refreshFlowLog）；
//   h4) 形态：380×300（A-9.3/demo L543）＋空态文案（demo L2974 逐字）＋头部流程名/✕。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { LogLine } from '../run';
import { createLogsBus } from './runs-bus';
import { FLOW_LOG_EMPTY_TEXT, FlowLogPanel } from './flow-log-panel';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function line(over: Partial<LogLine> = {}): LogLine {
  return { ts: '2026-11-11T03:00:00.000Z', level: 'info', msg: '行', flowId: 'f4', ...over };
}

function makeReplay(byFlow: Record<string, LogLine[]>) {
  return vi.fn(async (flowId: string): Promise<LogLine[]> => byFlow[flowId] ?? []);
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
  bus: ReturnType<typeof createLogsBus>;
  replayLogs: Mock;
  onClose: Mock;
}

async function mountPanel(flowId: string, byFlow: Record<string, LogLine[]>): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const bus = createLogsBus();
  const replayLogs = makeReplay(byFlow);
  const onClose = vi.fn();
  await act(async () => {
    root.render(
      <FlowLogPanel flowId={flowId} flowName="监控 UP 主" replayLogs={replayLogs} subscribeLogs={(fn) => bus.subscribe(fn)} onClose={onClose} />,
    );
  });
  await act(async () => {}); // flush 重放 promise
  return { container, root, bus, replayLogs, onClose };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

/** jsdom scrollHeight 恒 0——覆写为可观测值断言「滚到底」 */
function stubScrollHeight(el: HTMLElement, value: number): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => value });
}

async function rerender(m: Mounted, flowId: string): Promise<void> {
  await act(async () => {
    m.root.render(
      <FlowLogPanel flowId={flowId} flowName="人工确认" replayLogs={m.replayLogs} subscribeLogs={(fn) => m.bus.subscribe(fn)} onClose={m.onClose} />,
    );
  });
  await act(async () => {});
}

describe('§6.1h 流程日志（A-9.3：打开重放＋实时追加＋自动滚底）', () => {
  it('h1) 打开→重放 logs.list{flowId} 行序一致（清空后装载——demo L2966-2980）', async () => {
    const replayed = [line({ msg: '第一行' }), line({ ts: '2026-11-11T03:00:01.000Z', level: 'ok', msg: '第二行' })];
    const m = await mountPanel('f4', { f4: replayed });
    try {
      expect(m.replayLogs).toHaveBeenCalledWith('f4');
      const rows = m.container.querySelectorAll('[data-log-line]');
      expect(rows.length).toBe(2);
      expect([...rows].map((r) => r.querySelector('[data-log-msg]')?.textContent)).toEqual(['第一行', '第二行']); // 行序=持久序
    } finally {
      await unmount(m.root);
    }
  });

  it('h2) 实时行双路各恰一次追加＋自动滚底；异流程/无 flowId 行不追（demo L1289-1295）', async () => {
    const m = await mountPanel('f4', { f4: [line({ msg: '历史行' })] });
    try {
      const list = m.container.querySelector<HTMLElement>('[data-flow-log="list"]');
      expect(list).toBeTruthy();
      stubScrollHeight(list as HTMLElement, 420);
      expect(list?.querySelectorAll('[data-log-line]').length).toBe(1);

      // 双路：全局 tab 订阅（bus 直订）＋流程面板（过滤键 flowId）各恰一次
      const globalSeen: string[] = [];
      m.bus.subscribe((l) => globalSeen.push(l.msg));

      await act(async () => {
        m.bus.publish(line({ msg: '实时行', flowId: 'f4' })); // 当前流程——双路各恰一次
      });
      expect(globalSeen).toEqual(['实时行']); // 全局 tab 路恰一次
      expect([...(list?.querySelectorAll('[data-log-msg]') ?? [])].map((e) => e.textContent)).toEqual(['历史行', '实时行']); // 面板路恰一次
      expect(list?.scrollTop).toBe(420); // 自动滚底（demo L1295）

      await act(async () => {
        m.bus.publish(line({ msg: '他流程行', flowId: 'f9' })); // 异流程——面板不追
        m.bus.publish({ ts: '2026-11-11T03:00:02.000Z', level: 'info', msg: '无流程行' }); // 无 flowId——面板不追（demo L1293 判据）
      });
      expect(globalSeen.length).toBe(3); // 全局路全收（A-9.2 全局面）
      expect(list?.querySelectorAll('[data-log-line]').length).toBe(2); // 面板仅当前流程
    } finally {
      await unmount(m.root);
    }
  });

  it('h3) 切流程→清空＋重放新流程（demo L1707）；旧流程行不残留', async () => {
    const m = await mountPanel('f4', { f4: [line({ msg: 'f4 行' })], f9: [line({ flowId: 'f9', msg: 'f9 行' })] });
    try {
      expect(m.container.querySelectorAll('[data-log-line]').length).toBe(1);
      await rerender(m, 'f9');
      expect(m.replayLogs).toHaveBeenLastCalledWith('f9');
      const msgs = [...m.container.querySelectorAll('[data-log-msg]')].map((e) => e.textContent);
      expect(msgs).toEqual(['f9 行']); // 清空旧流程＋重放新流程
    } finally {
      await unmount(m.root);
    }
  });

  it('h5) 重放失败（logs.list reject）不丢重放在途缓冲的实时行——catch flush pending（T6-16 收口，batch-2 登记②）', async () => {
    // 重放在途（replaying=true）到达的实时行进 pending 缓冲；重放 reject 时须 flush 保留，不静默丢弃。
    let rejectReplay: ((e: Error) => void) | undefined;
    const replayLogs = vi.fn(
      (_flowId: string) =>
        new Promise<LogLine[]>((_res, rej) => {
          rejectReplay = rej;
        }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const bus = createLogsBus();
    await act(async () => {
      root.render(
        <FlowLogPanel flowId="f4" flowName="监控 UP 主" replayLogs={replayLogs} subscribeLogs={(fn) => bus.subscribe(fn)} onClose={vi.fn()} />,
      );
    });
    try {
      // 重放在途：实时行两行进 pending 缓冲（面板不即时显示=正常在途行为）
      await act(async () => {
        bus.publish(line({ msg: '在途行一' }));
        bus.publish(line({ ts: '2026-11-11T03:00:01.000Z', msg: '在途行二' }));
      });
      expect(container.querySelectorAll('[data-log-line]').length).toBe(0); // 在途缓冲（重放未装载）

      // 重放失败：catch 须 flush 缓冲行（不静默丢弃）
      await act(async () => {
        (rejectReplay as (e: Error) => void)(new Error('logs.list 不可达'));
      });
      const msgs = [...container.querySelectorAll('[data-log-msg]')].map((e) => e.textContent);
      expect(msgs).toEqual(['在途行一', '在途行二']); // 缓冲行保留

      // 失败后实时追加恢复正常（恰一次，接在保留行之后）
      await act(async () => {
        bus.publish(line({ ts: '2026-11-11T03:00:02.000Z', msg: '恢复行' }));
      });
      const msgsAfter = [...container.querySelectorAll('[data-log-msg]')].map((e) => e.textContent);
      expect(msgsAfter).toEqual(['在途行一', '在途行二', '恢复行']);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('h4) 形态：380×300（demo L543）＋空态文案（demo L2974 逐字）＋头部流程名＋✕ 关闭', async () => {
    const m = await mountPanel('f4', {}); // 无历史行
    try {
      const panel = m.container.querySelector<HTMLElement>('[data-flow-log="panel"]');
      expect(panel?.style.width).toBe('380px');
      expect(panel?.style.height).toBe('300px');
      expect(panel?.className).toContain('bottom-0');
      expect(panel?.className).toContain('right-0');
      expect(m.container.querySelector('[data-flow-log="empty"]')?.textContent).toBe(FLOW_LOG_EMPTY_TEXT);
      expect(FLOW_LOG_EMPTY_TEXT).toBe('该流程还没有日志 — 点「▶ 运行」'); // demo L2974 逐字
      expect(m.container.querySelector('[data-flow-log="flow-name"]')?.textContent).toBe('监控 UP 主');
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-flow-log="close"]')?.click();
      });
      expect(m.onClose).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(m.root);
    }
  });
});
