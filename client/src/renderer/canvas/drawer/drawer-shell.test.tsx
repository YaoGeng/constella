// @vitest-environment jsdom
// DrawerShell 用例（T3-08；C-01 §3 DrawerShell 行——三态/类型网格/动作区注入位）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { NodeRegistry } from '../../node-registry';
import { useDefinitionDraftStore } from '../../node-editor';
import { DrawerShell } from './DrawerShell';
import { CanvasRegistryContext } from '../registry-context';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function defs(): NodeDefinition[] {
  return [
    {
      type: 'llm.chat', kind: 'builtin',
      meta: { name: '对话', icon: '💬', category: 'AI' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [], exec: null, version: '1.0.0', packageVersion: '1.0.0',
    },
    {
      type: 'trigger.manual', kind: 'builtin',
      meta: { name: '手动', icon: '⚡', category: '触发' },
      ports: { ins: [], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [], exec: null, version: '1.0.0', packageVersion: '1.0.0',
    },
    {
      type: 'custom.mine', kind: 'custom',
      meta: { name: '我的', icon: '🧩', category: 'AI' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [], exec: null, version: '1.0.0', packageVersion: '1.0.0',
    },
  ];
}

function fakeRegistry(list: NodeDefinition[]): NodeRegistry {
  const map = new Map(list.map((d) => [d.type, d]));
  return {
    get: (t: string) => map.get(t),
    has: (t: string) => map.has(t),
    isBroken: () => false,
    isBuiltin: (t: string) => map.get(t)?.kind === 'builtin',
    register: () => {},
    list: () => list,
    listByCategory: () => {
      const byCat: Record<string, NodeDefinition[]> = {};
      for (const d of list) (byCat[d.meta.category] ??= []).push(d);
      return byCat;
    },
    derivePerms: () => [],
    estimateMs: () => 420,
    loadAll: async () => ({}) as never,
    onChange: () => () => {},
  } as unknown as NodeRegistry;
}

async function mountDrawer(props: Parameters<typeof DrawerShell>[0]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CanvasRegistryContext.Provider value={fakeRegistry(defs())}>
        <DrawerShell {...props} />
      </CanvasRegistryContext.Provider>,
    );
  });
  return { container, root };
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset(); // node-editor 草稿隔离（手动定义分支接线用例）
  useCanvasStore.setState({ drawer: null, editMode: true });
  useFlowStore.getState().loadFlow('f1', {
    id: 'f1', name: 't',
    nodes: [{ id: 'a', type: 'llm.chat', name: '对话节点', position: { x: 0, y: 0 }, params: {} }],
    edges: [],
  });
});

describe('create 态：类型网格（C-05 listByCategory＋✨自定义 PATH1）', () => {
  it('按类目分组渲染＋custom 类型带 ✨＋「✨自定义」双分支入口（让 AI 开发/手动定义）', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'create' });
    const { container, root } = await mountDrawer({});
    try {
      const groups = container.querySelectorAll('.cn-drawer__group-title');
      expect(Array.from(groups).map((g) => g.textContent)).toEqual(expect.arrayContaining(['AI', '触发', '自定义']));
      const types = container.querySelectorAll('.cn-drawer__type');
      expect(types).toHaveLength(5); // 3 定义 + 双分支（让 AI 开发/手动定义——01 §5.3 PATH1）
      expect(container.querySelector('[data-node-type="custom.mine"] .cn-drawer__type-spark')?.textContent).toBe('✨');
      expect(container.querySelector('[data-testid="drawer-custom-entry"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="drawer-custom-manual"]')).toBeTruthy();
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('PATH1 手动定义分支：点击 → openNodeEditor 打开节点编辑器（create 态）；「让 AI 开发」支已接线（T6-17——constella:workshop:open 事件锚抛应用壳，见下一用例）', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'create' });
    const { container, root } = await mountDrawer({});
    try {
      await act(async () => {
        container.querySelector<HTMLElement>('[data-testid="drawer-custom-manual"]')?.click();
      });
      const editor = useDefinitionDraftStore.getState();
      expect(editor.open).toBe(true);
      expect(editor.mode).toBe('create');
      expect(useDefinitionDraftStore.getState().draft.meta.source).toBe('manual');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('PATH1「让 AI 开发」支（T6-17 接线）：点击 → closeDrawer＋dispatch constella:workshop:open{prefill}（demo L2094-2100 冻结跳工坊行为）', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'create' });
    const { container, root } = await mountDrawer({});
    const opened: Array<{ prefill?: string } | undefined> = [];
    const onOpen = (ev: Event): void => {
      opened.push((ev as CustomEvent<{ prefill?: string }>).detail);
    };
    document.addEventListener('constella:workshop:open', onOpen);
    try {
      await act(async () => {
        container.querySelector<HTMLElement>('[data-testid="drawer-custom-entry"]')?.click();
      });
      expect(opened).toEqual([{ prefill: '帮我开发一个自定义节点（带脚本资产包）：' }]); // demo L2097 逐字
      expect(useCanvasStore.getState().drawer).toBeNull(); // closeDrawer（demo L2096）
    } finally {
      document.removeEventListener('constella:workshop:open', onOpen);
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('点击类型 → onCreate 回调（注入位；缺省=落图由 CanvasChrome 装配）', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'create' });
    const picked: string[] = [];
    const { container, root } = await mountDrawer({ onCreate: (t) => picked.push(t) });
    try {
      await act(async () => {
        container.querySelector<HTMLElement>('[data-node-type="trigger.manual"]')?.click();
      });
      expect(picked).toEqual(['trigger.manual']);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('edit 态：动作区＋内容区注入位', () => {
  it('标题/类型行/五动作按钮/children 内容区', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    const { container, root } = await mountDrawer({ children: <div data-testid="param-form-slot">表单注入位</div> });
    try {
      expect(container.querySelector('.cn-drawer__title')?.textContent).toBe('对话节点');
      expect(container.querySelector('.cn-drawer__meta')?.textContent).toBe('llm.chat');
      expect(container.querySelector('[data-testid="param-form-slot"]')).toBeTruthy();
      for (const id of ['drawer-save', 'drawer-cancel', 'drawer-delete', 'drawer-lib', 'drawer-tryrun']) {
        expect(container.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('删除动作：removeNodeCascade＋关抽屉＋onDelete 回调', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    let deleted = '';
    const { container, root } = await mountDrawer({ onDelete: (id) => (deleted = id) });
    try {
      await act(async () => {
        container.querySelector<HTMLElement>('[data-testid="drawer-delete"]')?.click();
      });
      expect(useFlowStore.getState().nodes).toHaveLength(0);
      expect(useCanvasStore.getState().drawer).toBe(null);
      expect(deleted).toBe('a');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('readonly 态（运行中 edit 也降级只读提示）', async () => {
    useFlowStore.getState().setRunning(true);
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    const { container, root } = await mountDrawer({});
    try {
      expect(container.querySelector('.cn-drawer__readonly')?.textContent).toContain('只读');
      expect(container.querySelector('[data-testid="drawer-save"]')).toBeFalsy();
    } finally {
      await act(async () => {
        root.unmount();
      });
      useFlowStore.getState().setRunning(false);
    }
  });

  it('无 drawer 态不渲染（组件整体 null）', async () => {
    const { container, root } = await mountDrawer({});
    try {
      expect(container.querySelector('.cn-drawer')).toBeFalsy();
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
