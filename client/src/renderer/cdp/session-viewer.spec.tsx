// @vitest-environment jsdom
// SessionViewer 用例（T4-06；TDD-C-04 §6.3c/§6.3d——openViewer 恰一次·置顶/✕ 仅关窗；
// demo L2848-2868 行为源：已开=重挂 body 末尾置顶、✕ title「关闭窗口（分支会话继续运行）」）。
//
// 通道=注入面 mock；断言=openViewer 调用次数（恰一次=同会话再点不开新窗）＋
// 会话状态不变（model 投影快照不变＋destroyRun 零调用）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { ListSessionsRes } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';
import { createCdpSessionsModel } from './cdp-sessions-model';
import { createSessionViewer, type SessionViewer } from './SessionViewer';
import { SessionViewerPanel } from './SessionViewer';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const RUN = 'r1';

function sessions2(): ListSessionsRes {
  return [
    { laneKey: 'n1', label: '主流程', port: 9221, url: 'https://news.example.com/hot' },
    { laneKey: 'n7', label: '评论分支', port: 9222, url: 'http://comments.example.com/' },
  ];
}

function fakeChannels(sessions: ListSessionsRes): {
  channels: CdpManagerChannels;
  openViewerCalls: Array<{ runId: string; laneKey: string }>;
  destroyRunCalls: string[];
} {
  const openViewerCalls: Array<{ runId: string; laneKey: string }> = [];
  const destroyRunCalls: string[] = [];
  return {
    channels: {
      listSessions: async (req) => (req.runId === RUN ? sessions : []),
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
    openViewerCalls,
    destroyRunCalls,
  };
}

interface Rig {
  container: HTMLDivElement;
  root: Root;
  viewer: SessionViewer;
  model: ReturnType<typeof createCdpSessionsModel>;
  openViewerCalls: Array<{ runId: string; laneKey: string }>;
  destroyRunCalls: string[];
}

/** 组装：model（已 refresh）＋viewer 控制器＋面板挂载（P5 应用壳装配形的测试同构） */
async function rig(sessions: ListSessionsRes = sessions2()): Promise<Rig> {
  const { channels, openViewerCalls, destroyRunCalls } = fakeChannels(sessions);
  const model = createCdpSessionsModel(channels);
  await model.refresh(RUN);
  const viewer = createSessionViewer(channels);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SessionViewerPanel viewer={viewer} model={model} />);
  });
  return { container, root, viewer, model, openViewerCalls, destroyRunCalls };
}

async function teardown(r: Rig): Promise<void> {
  await act(async () => {
    r.root.unmount();
    r.container.remove();
  });
}

async function open(v: Rig, laneKey: string): Promise<void> {
  await act(async () => {
    v.viewer.open(RUN, laneKey);
    await Promise.resolve(); // flush openViewer microtask
  });
}

async function clickClose(r: Rig, laneKey: string): Promise<void> {
  await act(async () => {
    r.container
      .querySelector(`[data-viewer="${laneKey}"] [data-viewer-close]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('SessionViewer（§6.3c openViewer 恰一次·置顶）', () => {
  it('点会话 → openViewer 恰一次＋查看窗渲染（头部 label/:port、URL 条、页面区）', async () => {
    const r = await rig();
    await open(r, 'n1');
    expect(r.openViewerCalls).toEqual([{ runId: RUN, laneKey: 'n1' }]);
    const el = r.container.querySelector('[data-viewer="n1"]');
    expect(el).not.toBeNull();
    expect(el?.querySelector('[data-viewer-head] [data-lane="label"]')?.textContent).toBe('主流程');
    expect(el?.querySelector('[data-viewer-head]')?.textContent).toContain(':9221');
    expect(el?.querySelector('[data-viewer-url]')?.textContent).toBe('https://news.example.com/hot');
    expect(el?.querySelector('[data-viewer-page]')).not.toBeNull();
    await teardown(r);
  });

  it('同会话再点 → 不开新窗（openViewer 仍恰一次）＋置顶（DOM 序末尾）', async () => {
    const r = await rig();
    await open(r, 'n1');
    await open(r, 'n7');
    await open(r, 'n1'); // 再点同会话 → 置顶
    expect(r.openViewerCalls).toHaveLength(2); // n1 恰一次＋n7 一次（n1 第二次零调用）
    expect(r.openViewerCalls.filter((c) => c.laneKey === 'n1')).toHaveLength(1);
    const viewers = r.container.querySelectorAll('[data-viewer]');
    expect(viewers).toHaveLength(2); // 不开新窗：仍两枚
    expect(viewers[viewers.length - 1]?.getAttribute('data-viewer')).toBe('n1'); // 置顶=末尾
    await teardown(r);
  });

  it('不同会话各开各窗（两枚互不挤占）', async () => {
    const r = await rig();
    await open(r, 'n1');
    await open(r, 'n7');
    expect(r.openViewerCalls.map((c) => c.laneKey)).toEqual(['n1', 'n7']);
    expect(r.container.querySelectorAll('[data-viewer]')).toHaveLength(2);
    await teardown(r);
  });
});

describe('SessionViewer（§6.3d ✕ 仅关窗、会话状态不变）', () => {
  it('✕ → 查看窗关闭；openViewer/destroyRun 无新调用；model 投影快照不变', async () => {
    const r = await rig();
    await open(r, 'n1');
    expect(r.container.querySelectorAll('[data-viewer="n1"]')).toHaveLength(1);
    const snapshot = r.model.sessionsOf(RUN);
    await clickClose(r, 'n1');
    expect(r.container.querySelectorAll('[data-viewer]')).toHaveLength(0);
    expect(r.openViewerCalls).toHaveLength(1); // ✕ 不触发任何通道
    expect(r.destroyRunCalls).toHaveLength(0); // 不中断自动化（A-8.2）
    expect(r.model.sessionsOf(RUN)).toEqual(snapshot); // 会话状态不变（投影快照原样）
    await teardown(r);
  });

  it('✕ 后再 open → 重新走 openViewer（窗已关，新开语义）', async () => {
    const r = await rig();
    await open(r, 'n1');
    await clickClose(r, 'n1');
    await open(r, 'n1');
    expect(r.openViewerCalls.filter((c) => c.laneKey === 'n1')).toHaveLength(2);
    expect(r.container.querySelectorAll('[data-viewer="n1"]')).toHaveLength(1);
    await teardown(r);
  });

  it('✕ title 明示「关闭窗口（分支会话继续运行）」（demo L2859 文案）', async () => {
    const r = await rig();
    await open(r, 'n7');
    const btn = r.container.querySelector('[data-viewer="n7"] [data-viewer-close]');
    expect(btn?.getAttribute('title')).toBe('关闭窗口（分支会话继续运行）');
    await teardown(r);
  });
});
