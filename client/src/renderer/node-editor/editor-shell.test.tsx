// @vitest-environment jsdom
// EditorShell 六环节 stepper 验收（T6-06；TDD-C-13 §3 EditorShell/StepMeta/StepPorts/
// NodeCardPreview 行；01 §5.3 PATH1 六环节 GWT）。
//
// 组件测试栈=仓库惯例（T3-01/T4-08 先例）：jsdom docblock＋createRoot/act＋
// container.querySelector 断言（无 testing-library——不引新依赖红线）；受控输入走
// 原生 setter＋input 事件派发（jsdom 不触发 React 合成 onChange）。
// 断言面：stepper 六环节往返＋环节门（未过门 next 禁用/跳步被拒）＋StepMeta N1 全字段
// （source 固定 manual）＋StepPorts 增删/出口命名＋NodeCardPreview 实时反映（端口布局/
// ✨/参数预览——demo L1360-1387 锚）＋环节 3~6 占位页（随 T6-07/08/09）＋create/edit 路由 UI。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { EditorShell } from './editor-shell';
import { NodeCardPreview } from './node-card-preview';
import { openNodeEditor, useDefinitionDraftStore } from './definition-draft';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** React 受控件原生赋值＋事件派发（ParamForm spec 同法） */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mountShell(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<EditorShell />);
  });
  return { container, root };
}

async function unmount(m: { root: Root }): Promise<void> {
  await act(async () => {
    m.root.unmount();
  });
}

function field(container: HTMLDivElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-meta-field="${name}"]`);
  if (el === null) throw new Error(`missing meta field ${name}`);
  return el;
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('EditorShell 开合与路由', () => {
  it('open=false 渲染 null；openNodeEditor() 后挂载 create 态六环节 stepper', async () => {
    const m = await mountShell();
    try {
      expect(m.container.querySelector('[data-testid="node-editor-shell"]')).toBe(null);
      await act(async () => {
        openNodeEditor();
      });
      const shell = m.container.querySelector('[data-testid="node-editor-shell"]');
      expect(shell?.getAttribute('data-mode')).toBe('create');
      expect(shell?.getAttribute('data-step')).toBe('meta');
      const nav = Array.from(m.container.querySelectorAll('[data-step-nav]')).map((b) => b.getAttribute('data-step-nav'));
      expect(nav).toEqual(['meta', 'ports', 'schema', 'script', 'inner', 'save']); // 六环节就位
    } finally {
      await unmount(m);
    }
  });

  it('edit 路由：data-mode=edit、type 输入只读（PK 不可变——A-11.1）', async () => {
    const seed: NodeDefinition = {
      type: 'xhs.search',
      kind: 'custom',
      meta: { name: '搜索采集', icon: '🔎', category: '社媒', source: 'zip' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [],
      exec: null,
      version: '1.0.0',
      packageVersion: '1.0.0',
    };
    await act(async () => {
      openNodeEditor({ type: 'xhs.search' }, { getDefinition: () => seed });
    });
    const m = await mountShell();
    try {
      expect(m.container.querySelector('[data-testid="node-editor-shell"]')?.getAttribute('data-mode')).toBe('edit');
      expect(field(m.container, 'type').readOnly).toBe(true);
      expect(field(m.container, 'name').value).toBe('搜索采集');
    } finally {
      await unmount(m);
    }
  });

  it('edit 载入 miss：seedError 面替代表单（不静默降级 create）', async () => {
    await act(async () => {
      openNodeEditor({ type: 'custom.none' }, { getDefinition: () => undefined });
    });
    const m = await mountShell();
    try {
      expect(m.container.querySelector('[data-testid="node-editor-seed-error"]')?.textContent).toContain('custom.none');
      expect(m.container.querySelector('[data-meta-field="name"]')).toBe(null);
    } finally {
      await unmount(m);
    }
  });
});

describe('环节 1 StepMeta（N1 全字段，名称必填，source 固定 manual）', () => {
  it('七字段表单：名称/类型/图标/类目/颜色/描述/作者＋source 只读展示 manual', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      for (const f of ['name', 'type', 'icon', 'category', 'color', 'description', 'author']) {
        expect(m.container.querySelector(`[data-meta-field="${f}"]`), f).toBeTruthy();
      }
      expect(m.container.querySelector('[data-meta-field="source"]')?.getAttribute('data-meta-source')).toBe('manual');
    } finally {
      await unmount(m);
    }
  });

  it('输入接线：名称/类型写入草稿；名称空=门未过（next 禁用），补齐后可前进', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      const next = m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]');
      expect(next?.disabled).toBe(true); // 名称/type 空 → meta 门未过
      expect(m.container.querySelector('[data-testid="ne-next"]')?.getAttribute('data-gate-blocked')).toBe('meta');

      await act(async () => {
        setNativeValue(field(m.container, 'name'), '我的采集节点');
        setNativeValue(field(m.container, 'type'), 'xhs.mine');
      });
      expect(useDefinitionDraftStore.getState().draft.meta.name).toBe('我的采集节点');
      expect(useDefinitionDraftStore.getState().draft.type).toBe('xhs.mine');
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(false);

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('ports');
    } finally {
      await unmount(m);
    }
  });

  it('type 撞内置（ai.llm）→ 错误定位到环节 meta＋字段 type（§6.1b UI 回显）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await act(async () => {
        setNativeValue(field(m.container, 'name'), '伪装');
        setNativeValue(field(m.container, 'type'), 'ai.llm');
      });
      const err = m.container.querySelector('[data-step-error][data-error-field="type"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N1-namespace');
      expect(err?.textContent).toContain('ai.llm');
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(true);
    } finally {
      await unmount(m);
    }
  });
});

describe('环节 2 StepPorts（ins/outs 增删＋出口命名＋卡片预览实时反映）', () => {
  async function atPorts(m: { container: HTMLDivElement }): Promise<void> {
    await act(async () => {
      setNativeValue(field(m.container, 'name'), '分支节点');
      setNativeValue(field(m.container, 'type'), 'xhs.branch');
      m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.click();
    });
    expect(useDefinitionDraftStore.getState().step).toBe('ports');
  }

  it('添加出口→出口命名可编辑→预览多出口标签等分；outs 重复 id→门拦＋错误定位 ports.outs[1].id', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atPorts(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-ports-action="add-out"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.ports.outs).toHaveLength(2);

      // 出口命名（第二出口 id/label 可编辑——出口命名即分支语义，N2）
      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-ports-out-row="1"] [data-ports-field="id"]') as HTMLInputElement,
          'hit',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-ports-out-row="1"] [data-ports-field="label"]') as HTMLInputElement,
          '命中',
        );
      });
      expect(useDefinitionDraftStore.getState().draft.ports.outs[1]).toEqual({ id: 'hit', label: '命中' });

      // 预览实时反映：双出口→两标签、等分高度（demo L1379-1387）
      expect(m.container.querySelectorAll('[data-preview-portlabel]').length).toBe(2);
      expect(m.container.querySelector('[data-preview-portlabel="hit"]')?.getAttribute('style')).toContain('66.7%');

      // 制造重复 id：把第一出口改成 hit → §6.1b outs id 重复
      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-ports-out-row="0"] [data-ports-field="id"]') as HTMLInputElement,
          'hit',
        );
      });
      const err = m.container.querySelector('[data-step-error][data-error-field="ports.outs[1].id"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N2-outs-duplicate');
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(true); // 未过门不得前进
    } finally {
      await unmount(m);
    }
  });

  it('ins 删除→触发节点（ins=[]）＋预览入口点消失；outs 删除被门拦（outs ≥1）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atPorts(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-ports-remove-in="0"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.ports.ins).toEqual([]); // ins 0~N（01 PRD-CUSTOM-N2）
      expect(m.container.querySelector('[data-preview-port-in]')).toBe(null);

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-ports-remove-out="0"]')?.click();
      });
      const err = m.container.querySelector('[data-step-error][data-error-field="ports.outs"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N2-outs-empty'); // outs ≥1（02 §8.1）
    } finally {
      await unmount(m);
    }
  });
});

describe('环节 3~6 占位页（stepper 结构就位、能走全流程——内容随 T6-07/08/09）', () => {
  it('四占位页各标承接卡号；六环节走全流程到 save', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await act(async () => {
        setNativeValue(field(m.container, 'name'), '全流程');
        setNativeValue(field(m.container, 'type'), 'xhs.walk');
      });
      const expects: Array<[string, string]> = [
        ['schema', 'T6-07'],
        ['script', 'T6-08'],
        ['inner', 'T6-09'],
        ['save', 'T6-09'],
      ];
      for (const [step, card] of expects) {
        await act(async () => {
          m.container.querySelector<HTMLButtonElement>(`[data-step-nav="${step}"]`)?.click();
        });
        expect(useDefinitionDraftStore.getState().step).toBe(step); // 门净可跳
        const ph = m.container.querySelector('[data-step-placeholder]');
        expect(ph?.getAttribute('data-step')).toBe(step);
        expect(ph?.textContent).toContain(card);
      }
      expect(m.container.querySelector('[data-testid="node-editor-shell"]')?.getAttribute('data-step')).toBe('save');
    } finally {
      await unmount(m);
    }
  });

  it('门未过跳步被拒：ports outs 清空后 schema 导航禁用', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await act(async () => {
        setNativeValue(field(m.container, 'name'), '拦门');
        setNativeValue(field(m.container, 'type'), 'xhs.gate');
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('ports');
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-ports-remove-out="0"]')?.click();
      });
      const nav = m.container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]');
      expect(nav?.disabled).toBe(true);
      await act(async () => {
        nav?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('ports');
    } finally {
      await unmount(m);
    }
  });
});

describe('NodeCardPreview（自持只读卡片预览——demo L1360-1387 锚，不 import C-01）', () => {
  function def(partial?: Partial<NodeDefinition>): NodeDefinition {
    return {
      type: 'xhs.search',
      kind: 'custom',
      meta: { name: '搜索采集', icon: '🔎', category: '社媒', source: 'manual' },
      ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
      paramsSchema: [],
      exec: null,
      version: '1.0.0',
      packageVersion: '1.0.0',
      ...partial,
    };
  }

  it('custom 卡：图标/名称/「类目·类型 · ✨」行＋参数预览首参 26 字截断', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NodeCardPreview
          def={def({
            paramsSchema: [{ k: 'keywords', t: 'textarea', default: '装修避坑全屋定制避坑全屋定制避坑全屋定制避坑全屋定制尾' }],
          })}
        />,
      );
    });
    try {
      expect(container.querySelector('[data-preview="icon"]')?.textContent).toBe('🔎');
      expect(container.querySelector('[data-preview="name"]')?.textContent).toBe('搜索采集');
      const typeLine = container.querySelector('[data-preview="type-line"]')?.textContent ?? '';
      expect(typeLine).toContain('社媒 · xhs.search');
      expect(typeLine).toContain('✨'); // kind=custom → ✨（demo L1377）
      const params = container.querySelector('[data-preview="params"]')?.textContent ?? '';
      expect(params.startsWith('keywords: ')).toBe(true);
      expect(params.length).toBe('keywords: '.length + 26); // value 26 字截断（demo L1354-1358）
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('多出口：出口沿卡片高度等分 top=(i+1)/(n+1)＋文字标签；单出口无标签；builtin 无 ✨', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const multi = def({
      kind: 'builtin',
      type: 'logic.branch',
      ports: {
        ins: ['in'],
        outs: [
          { id: 'true', label: '是' },
          { id: 'false', label: '否' },
        ],
      },
    });
    await act(async () => {
      root.render(<NodeCardPreview def={multi} />);
    });
    try {
      const outTrue = container.querySelector('[data-preview-port-out="true"]');
      const outFalse = container.querySelector('[data-preview-port-out="false"]');
      expect(outTrue?.getAttribute('style')).toContain('33.3%'); // (1)/(2+1)
      expect(outFalse?.getAttribute('style')).toContain('66.7%'); // (2)/(2+1)
      expect(container.querySelector('[data-preview-portlabel="true"]')?.textContent).toBe('是');
      expect(container.querySelector('[data-preview="type-line"]')?.textContent).not.toContain('✨'); // builtin
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    await act(async () => {
      root2.render(<NodeCardPreview def={def()} />);
    });
    try {
      expect(container2.querySelector('[data-preview-portlabel]')).toBe(null); // 单出口不画标签
      expect(container2.querySelector('[data-preview-port-in="in"]')).toBeTruthy();
    } finally {
      await act(async () => {
        root2.unmount();
      });
    }
  });
});
