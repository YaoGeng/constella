// @vitest-environment jsdom
// NodeDraftCard 用例（T6-17 返工 MINOR-3——试跑运行态生命周期＋02 §12.2#2 脚本明示面）。
//   断言：试跑钮 spawn 受理后保持 disabled 至 exit 帧（防重复起跑）——exit 后恢复可再跑；
//   adopt 前脚本内容全文展示（12.2#2 脚本明示——装配级挂载面断言的组件侧补全）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ScriptEvent } from '@constella/shared/ipc';
import type { AdoptDraftResult, NodeDraft, TrialRunHandle } from './node-dev-agent';
import { NodeDraftCard } from './node-draft-card';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 最小合法草稿（含脚本资产——试跑面可达） */
function makeDraft(): NodeDraft {
  return {
    id: 'draft-1',
    type: 'xhs.search',
    name: '小红书搜索',
    definition: {
      type: 'xhs.search',
      kind: 'custom',
      meta: { name: '小红书搜索', icon: '✨', category: '社媒' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [],
      exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    manifest: { kind: 'node', name: '小红书搜索', version: '1.0.0' },
    zip: new Uint8Array([1, 2, 3]),
    script: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run', code: 'def run(ctx):\n    return {"ok": True}' },
    params: { kw: '星丛' },
  };
}

const ADOPTED: AdoptDraftResult = {
  nodeId: 'n-1',
  type: 'xhs.search',
  name: '小红书搜索',
  trial: {
    lang: 'py',
    entry: 'run',
    scriptPath: 'xhs.search/1.0.0/scripts/xhs_search.py',
    timeoutMs: 30_000,
    retries: 0,
    params: { kw: '星丛' },
  },
};

async function mountCard(
  draft: NodeDraft,
  onTrial: ReturnType<typeof vi.fn>,
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NodeDraftCard
        draft={draft}
        onAdopt={async () => ADOPTED}
        onDiscard={() => undefined}
        onTrial={onTrial as unknown as Parameters<typeof NodeDraftCard>[0]['onTrial']}
      />,
    );
  });
  return { container, root };
}

describe('NodeDraftCard 试跑运行态（MINOR-3：spawn 受理不复位——exit 帧复位）', () => {
  it('adopt→试跑：受理后按钮 disabled 保持至 exit 帧；exit 后恢复可再跑', async () => {
    const draft = makeDraft();
    let emitEvent: ((e: ScriptEvent) => void) | null = null;
    const onTrial = vi.fn(
      (_adopted: AdoptDraftResult, opts: { onEvent(e: ScriptEvent): void }): Promise<TrialRunHandle> => {
        emitEvent = opts.onEvent;
        return Promise.resolve({ res: { ok: true, pid: 7 }, dispose: () => undefined });
      },
    );
    const { container, root } = await mountCard(draft, onTrial);
    try {
      // adopt → adopted 段（试跑面板在场）
      await act(async () => {
        container.querySelector<HTMLElement>('[data-draft-action="adopt"]')?.click();
      });
      const runBtn = () => container.querySelector<HTMLButtonElement>('[data-draft-trial="run"]');
      expect(runBtn()).not.toBeNull();
      expect(runBtn()?.disabled).toBe(false);

      // 试跑：spawn 受理（promise resolve）——按钮保持 disabled（不因受理复位）
      await act(async () => {
        runBtn()?.click();
      });
      expect(onTrial).toHaveBeenCalledTimes(1);
      expect(runBtn()?.disabled).toBe(true); // ← MINOR-3 判别：受理即复位会使此断言失败

      // stdout 帧到达——运行态仍在
      await act(async () => {
        emitEvent?.({ nodeRunId: 'trial-x:n-1', kind: 'stdout', chunk: '第一行' });
      });
      expect(runBtn()?.disabled).toBe(true);

      // exit 帧——复位＋done 标记，恢复可再跑
      await act(async () => {
        emitEvent?.({ nodeRunId: 'trial-x:n-1', kind: 'exit', code: 0, ms: 5 });
      });
      expect(runBtn()?.disabled).toBe(false);
      expect(container.querySelector('[data-draft-trial="done"]')?.textContent).toBe('试跑结束');
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    }
  });

  it('02 §12.2#2 脚本明示：adopt 前脚本内容全文在卡（含「将执行本机脚本」警示）', async () => {
    const draft = makeDraft();
    const { container, root } = await mountCard(draft, vi.fn());
    try {
      const script = container.querySelector('[data-draft="script"]');
      expect(script?.textContent).toContain('def run(ctx):');
      expect(container.querySelector('[data-draft="run-script"]')?.textContent).toContain('将执行本机脚本');
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    }
  });
});
