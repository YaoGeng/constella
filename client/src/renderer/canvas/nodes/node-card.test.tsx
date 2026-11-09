// @vitest-environment jsdom
// NodeCard/PortGroup 用例（T3-02；C-01 §3 两行＋01 A-3.1/A-3.2 判据）——fake 定义注入驱动
// （不建 SQLite；registry 经 CanvasRegistryContext 注入，产品装载序=T1-10）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { NodeRegistry } from '../../node-registry';
import { NodeCard, STATUS_BADGE } from './NodeCard';
import {
  CanvasRegistryContext,
  CanvasStatusContext,
  type NodeRunStatus,
} from '../registry-context';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function defFactory(overrides?: Partial<NodeDefinition>): NodeDefinition {
  return {
    type: 'llm.chat',
    kind: 'builtin',
    meta: { name: '对话', icon: '💬', category: 'AI' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'model', t: 'text' },
      { k: 'prompt', t: 'textarea' },
    ],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...overrides,
  };
}

function fakeRegistry(defs: NodeDefinition[], broken: string[] = []): NodeRegistry {
  const map = new Map(defs.map((d) => [d.type, d]));
  return {
    get: (t: string) => map.get(t),
    has: (t: string) => map.has(t),
    isBroken: (t: string) => broken.includes(t),
    isBuiltin: (t: string) => map.get(t)?.kind === 'builtin',
    register: () => {},
    list: () => defs,
    listByCategory: () => ({}),
    derivePerms: () => [],
    estimateMs: () => 420,
    loadAll: async () => ({ loaded: 0, broken: [] }) as never,
    onChange: () => () => {},
  } as unknown as NodeRegistry;
}

interface MountOpts {
  def?: NodeDefinition | null;
  broken?: string[];
  status?: NodeRunStatus;
  params?: Record<string, unknown>;
}

async function mountCard({ def, broken = [], status = 'waiting', params = {} }: MountOpts) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const registry = def === null ? null : fakeRegistry([def ?? defFactory()], broken);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <CanvasRegistryContext.Provider value={registry}>
          <CanvasStatusContext.Provider value={() => status}>
            <NodeCard id="n1" selected={false} data={{ nodeId: 'n1', type: def?.type ?? 'llm.chat', params }} />
          </CanvasStatusContext.Provider>
        </CanvasRegistryContext.Provider>
      </ReactFlowProvider>,
    );
  });
  return { container, root };
}

describe('NodeCard 五态样式与徽标（01 A-3.1；demo L1761）', () => {
  const cases: Array<[NodeRunStatus, string]> = [
    ['waiting', '⏸'],
    ['running', '⋯'],
    ['done', '✓'],
    ['error', '✗'],
    ['skipped', '⊘'],
  ];
  for (const [status, badge] of cases) {
    it(`${status} 态 → cn-node--${status} class ＋徽标 ${badge}`, async () => {
      const { container, root } = await mountCard({ status });
      try {
        const el = container.querySelector('.cn-node');
        expect(el?.className).toContain(`cn-node--${status}`);
        expect(el?.querySelector('.cn-node__badge')?.textContent).toBe(badge);
      } finally {
        await act(async () => {
          root.unmount();
        });
      }
    });
  }
  it('STATUS_BADGE 全集与五态一一对应', () => {
    expect(STATUS_BADGE).toEqual({ waiting: '⏸', running: '⋯', done: '✓', error: '✗', skipped: '⊘' });
  });
});

describe('✨角标与 broken ⚠（C-05 isBuiltin/isBroken）', () => {
  it('custom kind → 类型行 ✨ 尾标；builtin 无', async () => {
    const custom = defFactory({ kind: 'custom', type: 'custom.mine' });
    const a = await mountCard({ def: custom, params: {} });
    expect(a.container.querySelector('.cn-node__type')?.textContent).toContain('✨');
    await act(async () => {
      a.root.unmount();
    });
    const builtin = defFactory();
    const b = await mountCard({ def: builtin });
    expect(b.container.querySelector('.cn-node__type')?.textContent).not.toContain('✨');
    await act(async () => {
      b.root.unmount();
    });
  });

  it('isBroken → ⚠ 标记 + broken class', async () => {
    const def = defFactory({ type: 'bad.node' });
    const { container, root } = await mountCard({ def, broken: ['bad.node'] });
    try {
      expect(container.querySelector('.cn-node__type')?.textContent).toContain('⚠');
      expect(container.querySelector('.cn-node')?.className).toContain('cn-node--broken');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('参数预览 26 字截断（demo L1354-1358）', () => {
  it('首参有值 → 「key: value」且 value ≤26 字；无值参数跳过', async () => {
    const long = 'x'.repeat(40);
    const { container, root } = await mountCard({
      params: { model: '', prompt: long }, // model 空值跳过 → 首个有值参数 prompt
    });
    try {
      const el = container.querySelector('.cn-node__params');
      expect(el?.textContent).toBe(`prompt: ${'x'.repeat(26)}`);
      expect((el?.textContent ?? '').length).toBeLessThan(`prompt: ${long}`.length);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('全部参数无值 → 预览区空', async () => {
    const { container, root } = await mountCard({ params: {} });
    try {
      expect(container.querySelector('.cn-node__params')?.textContent).toBe('');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe('PortGroup（A-3.2；demo L1379-1387）', () => {
  it('多出口：Handle 沿高度等分＋文字标签；单出口无标签', async () => {
    const def = defFactory({
      ports: { ins: ['in'], outs: [{ id: 'true', label: '真' }, { id: 'false', label: '假' }] },
    });
    const { container, root } = await mountCard({ def });
    try {
      const outs = container.querySelectorAll('.cn-port--out');
      expect(outs).toHaveLength(2);
      // 等分：top = (i+1)/(n+1) = 33.3% / 66.7%
      expect(outs[0]?.getAttribute('style')).toContain('33.3%');
      expect(outs[1]?.getAttribute('style')).toContain('66.7%');
      const labels = container.querySelectorAll('.cn-portlabel');
      expect(labels).toHaveLength(2);
      expect(labels[0]?.textContent).toBe('真');
      expect(labels[1]?.textContent).toBe('假');
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('ins=[] 触发节点无入口 Handle；常规节点单入口', async () => {
    const trigger = defFactory({ ports: { ins: [], outs: [{ id: 'out', label: '输出' }] } });
    const a = await mountCard({ def: trigger });
    expect(a.container.querySelectorAll('.cn-port--in')).toHaveLength(0);
    await act(async () => {
      a.root.unmount();
    });
    const normal = defFactory();
    const b = await mountCard({ def: normal });
    expect(b.container.querySelectorAll('.cn-port--in')).toHaveLength(1);
    await act(async () => {
      b.root.unmount();
    });
  });

  it('未装配 registry → fallback 卡（❓ 图标＋默认单入单出）', async () => {
    const { container, root } = await mountCard({ def: null });
    try {
      expect(container.querySelector('.cn-node__icon')?.textContent).toBe('❓');
      expect(container.querySelectorAll('.cn-port--in')).toHaveLength(1);
      expect(container.querySelectorAll('.cn-port--out')).toHaveLength(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
