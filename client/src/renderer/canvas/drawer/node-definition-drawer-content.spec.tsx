// @vitest-environment jsdom
// DrawerShell 内容区接线验收（T4-09 自拟；C-01 §3 DrawerShell 行内容区项——T3-08 注入位收口）。
//
// 组件测试栈=T3-01 惯例：jsdom docblock＋createRoot/act（React 19 须 await act）＋
// container.querySelector 断言（项目无 testing-library 依赖——不引新依赖红线；卡文
// 「testing-library」按本惯例落地，留痕）。覆盖：①内容区四块渲染（ParamForm/io 区 per-exit
// 分列〔X-5/MA-4〕/脚本预览/inner 区〔N5〕）；②未声明回退 `out → {data}` 契约文案〔B-13〕；
// ③保存编排（validateParams→错误定位 k/通过→patchNode 写回＋关抽屉）；④节点切换草稿重置
// （T4-08 移交项：JsonControl 非受控初值经宿主 key 重挂收口）；⑤children 显式注入优先
// （T3-08 注入位兼容）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { NodeRegistry } from '../../node-registry';
import { DrawerShell } from './DrawerShell';
import { CanvasRegistryContext } from '../registry-context';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 节点实例 params 直读（flowStore nodes 投影） */
function nodeParams(nodeId: string): Record<string, unknown> | undefined {
  const n = useFlowStore.getState().nodes.find((x) => x.id === nodeId);
  return (n?.data as { params?: Record<string, unknown> } | undefined)?.params;
}

/** MA-4 ✨xhs-auto-reply 形（01a §2.c 规格表逐项：三出口/inner 六步/per-exit io/persona regex） */
const MA4_DEF: NodeDefinition = {
  type: 'custom.xhs-auto-reply',
  kind: 'custom',
  meta: { name: '即时回复一体机', icon: '🤖', category: '社媒', source: 'ai-forge' },
  ports: {
    ins: ['in'],
    outs: [
      { id: 'replied', label: '已回复' },
      { id: 'escalated', label: '升级人工' },
      { id: 'skipped', label: '主动拒答' },
    ],
  },
  paramsSchema: [
    { k: 'persona', label: '角色卡', t: 'text', required: true, validate: { regex: '.{5,}' } },
    { k: 'userRules', label: '用户规则', t: 'textarea' },
    { k: 'cooldownMin', label: '同会话冷却 (min)', t: 'number', default: 3, validate: { min: 1, max: 500 } },
  ],
  exec: { lang: 'ts', file: 'scripts/auto_reply.ts', entry: 'run' },
  inner: [
    '取材 · 列表复放与新鲜度判据',
    '会话判向（末条非我方才算新来信+冷却窗+回声锚）',
    '意图识别与风险 skip',
    '四层装配生成（recentSent 反模板+句末截断 reply_chat 120 / reply_comment 80）',
    '发送 · 私信/评论两路',
    '登记回声缓存并路由三出口',
  ],
  policy: { timeoutMs: 600000, retries: 0, onFailure: { type: 'failBranch', exit: 'escalated' } },
  io: {
    outputs: {
      replied: { fields: [{ name: 'handled', type: 'object[]', example: '[{convId,kind,text}]' }] },
      escalated: { fields: [{ name: 'pending', type: 'object[]', example: '[{convId,reason}]' }] },
      skipped: { fields: [{ name: 'skipped', type: 'object[]', example: '[{convId,intent}]' }] },
    },
  },
  version: '1.0.0',
  packageVersion: '1.0.0',
};

/** 未声明节点（io/inner 缺省——B-13 契约文案兜底验收形） */
const PLAIN_DEF: NodeDefinition = {
  type: 'llm.chat',
  kind: 'builtin',
  meta: { name: '对话', icon: '💬', category: 'AI' },
  ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
  paramsSchema: [{ k: 'prompt', label: '提示词', t: 'textarea', required: true }],
  exec: { lang: 'python', file: 'scripts/chat.py', entry: 'run' },
  version: '1.0.0',
  packageVersion: '1.0.0',
};

/** json 草稿重置回归形（T4-08 移交项——节点 a/b 同 schema 不同初值） */
const JSON_DEF: NodeDefinition = {
  ...PLAIN_DEF,
  type: 'data.config',
  meta: { name: '配置', icon: '⚙️', category: '数据' },
  paramsSchema: [{ k: 'config', label: '配置', t: 'json' }],
};

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

const REGISTRY = fakeRegistry([MA4_DEF, PLAIN_DEF, JSON_DEF]);

async function mountDrawer(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CanvasRegistryContext.Provider value={REGISTRY}>
        <DrawerShell />
      </CanvasRegistryContext.Provider>,
    );
  });
  return { container, root };
}

async function unmount(m: { container: HTMLDivElement; root: Root }): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

/** React 受控件原生赋值＋事件派发（jsdom 不触发 React 合成 onChange，须走原生 setter） */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  eventName: 'input' | 'change' = 'input',
): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

beforeEach(() => {
  useCanvasStore.setState({ drawer: null, editMode: true });
  useFlowStore.getState().loadFlow('f1', {
    id: 'f1', name: 't',
    nodes: [
      { id: 'a', type: 'custom.xhs-auto-reply', name: '回复一体机', position: { x: 0, y: 0 }, params: { persona: '家居定制顾问小雅' } },
      { id: 'b', type: 'llm.chat', name: '对话节点', position: { x: 1, y: 0 }, params: {} },
    ],
    edges: [],
  });
});

describe('内容区收口：四块渲染（ParamForm＋io 区＋脚本预览＋inner 区）', () => {
  it('MA-4 节点 → 参数表单＋io 三出口分列（X-5）＋脚本预览＋inner 六步（N5）', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    const m = await mountDrawer();
    try {
      // ① ParamForm（C-02）——schema 字段渲染＋实例值回显
      const form = m.container.querySelector('[data-param-form]');
      expect(form).toBeTruthy();
      expect(m.container.querySelector<HTMLInputElement>('[data-param-k="persona"] input')?.value).toContain('家居定制顾问小雅');

      // ② io 区 per-exit 三出口分列（MA-4 replied/escalated/skipped——§6.1d 验收源）
      expect(m.container.querySelector('[data-io-exit="replied"]')?.textContent).toContain('handled');
      expect(m.container.querySelector('[data-io-exit="escalated"]')?.textContent).toContain('pending');
      expect(m.container.querySelector('[data-io-exit="skipped"]')?.textContent).toContain('skipped');
      // 输入侧未声明回退文案（demo L2064 形态）
      expect(m.container.querySelector('[data-io-input]')?.textContent).toContain('in ← 上游 data');

      // ③ 脚本预览（exec 声明面——demo L2068 形态正式化）
      const exec = m.container.querySelector('[data-exec-preview]')?.textContent ?? '';
      expect(exec).toContain('TypeScript');
      expect(exec).toContain('scripts/auto_reply.ts');
      expect(exec).toContain('run');

      // ④ inner 区六步（demo L2066 形态）
      const inner = m.container.querySelector('[data-inner-steps]');
      expect(inner?.textContent).toContain('组合节点 · 内部 6 步');
      const steps = m.container.querySelectorAll('[data-inner-step]');
      expect(steps).toHaveLength(6);
      expect(steps[0]?.textContent).toContain('1. 取材 · 列表复放与新鲜度判据');
      expect(steps[5]?.textContent).toContain('6. 登记回声缓存并路由三出口');
    } finally {
      await unmount(m);
    }
  });

  it('未声明节点（io/inner 缺省）→ io 区回退 `out → {data}` 契约文案（B-13）＋无 inner 区', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'b' });
    const m = await mountDrawer();
    try {
      const exit = m.container.querySelector('[data-io-exit="out"]');
      expect(exit?.textContent).toContain('out → {data}');
      expect(m.container.querySelector('[data-inner-steps]')).toBeFalsy();
      expect(m.container.querySelector('[data-exec-preview]')?.textContent).toContain('scripts/chat.py');
    } finally {
      await unmount(m);
    }
  });
});

describe('保存编排（动作区默认=validateParams→patchNode 写回）', () => {
  it('必填缺失 → 错误定位字段 k 展示、不关抽屉、params 不写回', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    const m = await mountDrawer();
    try {
      const input = m.container.querySelector<HTMLInputElement>('[data-param-k="persona"] input');
      expect(input).toBeTruthy();
      await act(async () => {
        setNativeValue(input as HTMLInputElement, '');
      });
      await act(async () => {
        m.container.querySelector<HTMLElement>('[data-testid="drawer-save"]')?.click();
      });
      expect(m.container.querySelector('[data-param-error-k="persona"]')?.textContent).toContain('必填');
      expect(useCanvasStore.getState().drawer?.mode).toBe('edit'); // 未关
      expect(nodeParams('a')?.persona).toBe('家居定制顾问小雅'); // 未写回
    } finally {
      await unmount(m);
    }
  });

  it('合法草稿 → patchNode 写回＋关抽屉＋onSave 回调（T3-08 注入位语义保持）', async () => {
    let saved = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    await act(async () => {
      root.render(
        <CanvasRegistryContext.Provider value={REGISTRY}>
          <DrawerShell onSave={(id) => (saved = id)} />
        </CanvasRegistryContext.Provider>,
      );
    });
    try {
      const input = container.querySelector<HTMLInputElement>('[data-param-k="persona"] input');
      await act(async () => {
        setNativeValue(input as HTMLInputElement, '家居定制顾问小雅二代');
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-testid="drawer-save"]')?.click();
      });
      expect(nodeParams('a')?.persona).toBe('家居定制顾问小雅二代');
      expect(useCanvasStore.getState().drawer).toBe(null); // 关抽屉
      expect(saved).toBe('a');
    } finally {
      await act(async () => {
        root.unmount();
        container.remove();
      });
    }
  });
});

describe('节点切换草稿重置（T4-08 移交项：JsonControl 非受控初值）', () => {
  it('a→b 切换后 json 控件初值=新节点值（宿主 key 重挂收口）', async () => {
    useFlowStore.getState().loadFlow('f1', {
      id: 'f1', name: 't',
      nodes: [
        { id: 'ja', type: 'data.config', name: '配置A', position: { x: 0, y: 0 }, params: { config: '{"seed":1}' } },
        { id: 'jb', type: 'data.config', name: '配置B', position: { x: 1, y: 0 }, params: { config: '{"seed":2}' } },
      ],
      edges: [],
    });
    const m = await mountDrawer();
    try {
      await act(async () => {
        useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'ja' });
      });
      const first = m.container.querySelector<HTMLTextAreaElement>('[data-param-k="config"] textarea');
      expect(first?.value).toBe('{"seed":1}');

      await act(async () => {
        useCanvasStore.getState().closeDrawer();
        useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'jb' });
      });
      const second = m.container.querySelector<HTMLTextAreaElement>('[data-param-k="config"] textarea');
      expect(second?.value).toBe('{"seed":2}'); // 无重挂=残留 {"seed":1}（移交项回归）
    } finally {
      await unmount(m);
    }
  });
});

describe('T3-08 注入位兼容', () => {
  it('显式 children 优先——默认内容区不渲染', async () => {
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'a' });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CanvasRegistryContext.Provider value={REGISTRY}>
          <DrawerShell>
            <div data-testid="custom-slot">外部内容</div>
          </DrawerShell>
        </CanvasRegistryContext.Provider>,
      );
    });
    try {
      expect(container.querySelector('[data-testid="custom-slot"]')).toBeTruthy();
      expect(container.querySelector('[data-param-form]')).toBeFalsy();
    } finally {
      await act(async () => {
        root.unmount();
        container.remove();
      });
    }
  });

  it('定义不可用（registry 无该类型）→ 占位提示、保存零写回', async () => {
    useFlowStore.getState().loadFlow('f1', {
      id: 'f1', name: 't',
      nodes: [{ id: 'x', type: 'ghost.type', name: '幽灵', position: { x: 0, y: 0 }, params: { keep: 1 } }],
      edges: [],
    });
    useCanvasStore.getState().openDrawer({ mode: 'edit', nodeId: 'x' });
    const m = await mountDrawer();
    try {
      expect(m.container.querySelector('[data-drawer-missing-def]')?.textContent).toContain('定义不可用');
      await act(async () => {
        m.container.querySelector<HTMLElement>('[data-testid="drawer-save"]')?.click();
      });
      expect(nodeParams('x')).toEqual({ keep: 1 }); // 零写回
      expect(useCanvasStore.getState().drawer).toBe(null); // 保存=关闭（无校验面）
    } finally {
      await unmount(m);
    }
  });
});
