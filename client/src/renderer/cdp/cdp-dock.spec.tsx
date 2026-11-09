// @vitest-environment jsdom
// CdpDock 用例（T4-06；TDD-C-04 §6.3a/§6.3b——徽标/隐藏＋列表投影形；demo L2822-2838 行为源）。
//
// 组件测试栈=仓库惯例（T3-08/T4-08 先例）：jsdom docblock 局部环境＋createRoot/act＋
// container.querySelector 断言（项目无 testing-library 依赖——不引新依赖红线）。
// 通道=注入面 mock（manager-channels.CdpManagerChannels）——真通道冒烟归
// manager-channels.smoke.spec.ts（T4-18 备注「mock 解除」半段）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { LaneSessionInfo, ListSessionsRes } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';
import { createCdpSessionsModel, stripUrlProtocol } from './cdp-sessions-model';
import { CdpDock } from './CdpDock';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 通道 mock（注入面）：listSessions 可变应答；openViewer/destroyRun/probe 计数 */
function fakeChannels(sessions: ListSessionsRes): {
  channels: CdpManagerChannels;
  setSessions(v: ListSessionsRes): void;
  openViewerCalls: Array<{ runId: string; laneKey: string }>;
  destroyRunCalls: string[];
} {
  let current = sessions;
  const openViewerCalls: Array<{ runId: string; laneKey: string }> = [];
  const destroyRunCalls: string[] = [];
  return {
    channels: {
      listSessions: async (req) => (req.runId === 'r1' ? current : []),
      openViewer: async (req) => {
        openViewerCalls.push({ runId: req.runId, laneKey: req.laneKey });
        return { ok: true };
      },
      destroyRun: async (req) => {
        destroyRunCalls.push(req.runId);
        return { ok: true };
      },
      probe: async () => ({ ok: true }),
    },
    setSessions: (v) => {
      current = v;
    },
    openViewerCalls,
    destroyRunCalls,
  };
}

function sessions3(): LaneSessionInfo[] {
  return [
    { laneKey: 'n1', label: '主流程', port: 9221, url: 'https://news.example.com/hot' },
    { laneKey: 'n7', label: '评论分支', port: 9222, url: 'http://comments.example.com/?p=2' },
    { laneKey: 'n12', label: '视频分支', port: 9223, url: 'https://video.example.com/watch?v=x' },
  ];
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

async function mountDock(model: ReturnType<typeof createCdpSessionsModel>, runId = 'r1'): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CdpDock model={model} runId={runId} onOpenSession={() => {}} />);
  });
  return { container, root };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

async function click(el: Element | null): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('CdpDock（§6.3a 徽标=会话数、无会话隐藏）', () => {
  it('3 会话 → 徽标 3', async () => {
    const { channels } = fakeChannels(sessions3());
    const model = createCdpSessionsModel(channels);
    const m = await mountDock(model);
    const badge = m.container.querySelector('[data-dock="badge"]');
    expect(badge?.textContent).toBe('3');
    expect(m.container.querySelector('[data-dock="toggle"]')).not.toBeNull();
    await unmount(m);
  });

  it('无会话 → dock 隐藏（不渲染）', async () => {
    const { channels } = fakeChannels([]);
    const model = createCdpSessionsModel(channels);
    const m = await mountDock(model);
    expect(m.container.innerHTML).toBe('');
    await unmount(m);
  });

  it('会话数变化经 model.refresh 反映到徽标（3→1）', async () => {
    const { channels, setSessions } = fakeChannels(sessions3());
    const model = createCdpSessionsModel(channels);
    const m = await mountDock(model);
    expect(m.container.querySelector('[data-dock="badge"]')?.textContent).toBe('3');
    setSessions([sessions3()[0]!]);
    await act(async () => {
      await model.refresh('r1');
    });
    expect(m.container.querySelector('[data-dock="badge"]')?.textContent).toBe('1');
    await unmount(m);
  });
});

describe('CdpDock（§6.3b 列表项投影形）', () => {
  async function mountExpanded(): Promise<{ m: Mounted; model: ReturnType<typeof createCdpSessionsModel> }> {
    const { channels } = fakeChannels(sessions3());
    const model = createCdpSessionsModel(channels);
    const m = await mountDock(model);
    await click(m.container.querySelector('[data-dock="toggle"]'));
    return { m, model };
  }

  it('列表项 = laneKey（data-dock-item）/label/去协议头 URL/:port', async () => {
    const { m } = await mountExpanded();
    const items = m.container.querySelectorAll('[data-dock-item]');
    expect(items).toHaveLength(3);
    const first = items[0]!;
    expect(first.getAttribute('data-dock-item')).toBe('n1');
    expect(first.querySelector('[data-lane="label"]')?.textContent).toBe('主流程');
    expect(first.querySelector('[data-lane="url"]')?.textContent).toBe(stripUrlProtocol('https://news.example.com/hot'));
    expect(first.textContent).toContain(':9221');
    const second = items[1]!;
    expect(second.querySelector('[data-lane="url"]')?.textContent).toBe('comments.example.com/?p=2');
    await unmount(m);
  });

  it('列表项 title = 打开 CDP 窗口 — <label> :<port>（demo L2834 文案）', async () => {
    const { m } = await mountExpanded();
    const first = m.container.querySelector('[data-dock-item="n7"]');
    expect(first?.getAttribute('title')).toBe('打开 CDP 窗口 — 评论分支 :9222');
    await unmount(m);
  });

  it('收起态不渲染列表（只刷计数，demo L2832）', async () => {
    const { channels } = fakeChannels(sessions3());
    const model = createCdpSessionsModel(channels);
    const m = await mountDock(model);
    expect(m.container.querySelector('[data-dock="list"]')).toBeNull();
    expect(m.container.querySelector('[data-dock="badge"]')?.textContent).toBe('3');
    await unmount(m);
  });

  it('点列表项 → onOpenSession(laneKey)', async () => {
    const { channels } = fakeChannels(sessions3());
    const model = createCdpSessionsModel(channels);
    const opened: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<CdpDock model={model} runId="r1" onOpenSession={(laneKey) => opened.push(laneKey)} />);
    });
    await click(container.querySelector('[data-dock="toggle"]'));
    await click(container.querySelector('[data-dock-item="n7"]'));
    expect(opened).toEqual(['n7']);
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });

  it('dock 通道异常（listSessions reject）不崩——保持隐藏态', async () => {
    const broken: CdpManagerChannels = {
      listSessions: async () => {
        throw { code: 'INTERNAL', message: 'boom' };
      },
      openViewer: async () => ({ ok: true }),
      destroyRun: async () => ({ ok: true }),
      probe: async () => ({ ok: true }),
    };
    const model = createCdpSessionsModel(broken);
    const m = await mountDock(model);
    expect(m.container.innerHTML).toBe('');
    await unmount(m);
  });
});

describe('stripUrlProtocol（去协议头，demo L2836 同源）', () => {
  it('https/http 前缀剥除；其余原样', () => {
    expect(stripUrlProtocol('https://a.example/x')).toBe('a.example/x');
    expect(stripUrlProtocol('http://b.example')).toBe('b.example');
    expect(stripUrlProtocol('about:blank')).toBe('about:blank');
    expect(stripUrlProtocol('')).toBe('');
  });
});
