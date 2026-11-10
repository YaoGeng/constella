// @vitest-environment jsdom
// StepSchema 验收（T6-07；TDD-C-13 §3 StepSchema 行＋§1 N6/N7「高级声明」分组冻结形；
// 01 §5.2 PRD-CUSTOM-N3/N6/N7 GWT＋§5.3 PATH1 环节 3）。
//
// 断言面（05 T6-07 验收＝C-13 §6.1b 三类违例逐条定位 StepSchema 字段）：
// ①N3 字段定义器：类型白名单八类/默认值/必填/校验/help/分组——增删改排序即时写草稿；
// ②三类违例行内回显（复用 T6-06 computeStepErrors 投影——validateDefinition 单一来源，
//   不自造规则）：N3 白名单外类型→paramsSchema[i].t／N6 failBranch exit∉N2 outs→
//   policy.onFailure.exit／N7 io.outputs 键⊄outs→io.outputs.<exit>；
// ③N6/N7 高级声明分组：policy 0 值语义（X-4：显式 0 与字段缺省区分）＋io input/output/
//   outputs 声明面＋§6.1a 往返保留（兄弟字段不丢）。
// ParamFormPreview 与 schema 实时同步＝param-form-preview.test.tsx（本文件只测定义器面）。
// 组件测试栈=仓库惯例（T3-01/T4-08/T6-06 先例）：jsdom docblock＋createRoot/act＋
// container.querySelector 断言（无 testing-library）；受控输入走原生 setter＋事件派发。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { EditorShell } from './editor-shell';
import { openNodeEditor, useDefinitionDraftStore } from './definition-draft';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** React 受控件原生赋值＋事件派发（input/textarea=input 事件、select=change 事件） */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
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

/** 直达环节 3（create 态填好名称/type——meta/ports 门净，前进跳步合法） */
async function atSchema(m: { container: HTMLDivElement }): Promise<void> {
  await act(async () => {
    setNativeValue(field(m.container, 'name'), 'Schema 节点');
    setNativeValue(field(m.container, 'type'), 'xhs.schema');
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('schema');
}

/** 回环节 2 改出口再返环节 3（N6/N7 交叉校验的违例制造路径——出口改名后声明键失配） */
async function renameFirstExit(m: { container: HTMLDivElement }, to: string): Promise<void> {
  await act(async () => {
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="ports"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('ports');
  await act(async () => {
    setNativeValue(
      m.container.querySelector<HTMLInputElement>('[data-ports-out-row="0"] [data-ports-field="id"]') as HTMLInputElement,
      to,
    );
  });
  await act(async () => {
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('schema');
}

function schemaRow(m: { container: HTMLDivElement }, row: number, name: string): HTMLInputElement | HTMLSelectElement {
  const el = m.container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-schema-row="${row}"] [data-schema-field="${name}"]`,
  );
  if (el === null) throw new Error(`missing schema field ${name} @row ${row}`);
  return el;
}

function policyField(m: { container: HTMLDivElement }, name: string): HTMLInputElement | HTMLSelectElement {
  const el = m.container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-advanced-group="policy"] [data-policy-field="${name}"]`,
  );
  if (el === null) throw new Error(`missing policy field ${name}`);
  return el;
}

/** 02 §8.1 示例全形（definition-draft.spec 同源——§6.1a 往返基线） */
function fullDef(): NodeDefinition {
  return {
    type: 'xhs.search',
    kind: 'custom',
    meta: { name: '搜索采集', icon: '🔎', category: '社媒', source: 'ai-forge' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
    paramsSchema: [
      { k: 'keywords', label: '关键词组', t: 'textarea', default: '装修避坑', required: true, group: '采集', help: '每行一个', validate: { minLines: 1 } },
      { k: 'apiKey', t: 'secret', storage: 'safeStorage' },
      { k: 'maxNotes', t: 'number', default: 40, validate: { min: 1, max: 500 } },
      { k: 'ratio', t: 'slider', min: 10, max: 100, step: 10, default: 100 },
    ],
    exec: {
      lang: 'python',
      file: 'scripts/xhs_search.py',
      entry: 'run',
      config: 'config/xhs_search.yaml',
      deps: 'deps/requirements.txt',
    },
    inner: ['会话判向 · 历史复放判新来信'],
    policy: { timeoutMs: 60000, retries: 2, backoffMs: 2000, onFailure: { type: 'abort' } },
    io: {
      input: { type: 'object', fields: [{ name: 'keywords', type: 'string[]' }] },
      output: { fields: [{ name: 'notes', type: 'object[]', example: '[{title,likes,url}]' }] },
    },
    version: '1.2.0',
    packageVersion: '1.1.0',
  };
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('环节 3 StepSchema · N3 字段定义器（增删改排序即时写草稿）', () => {
  it('add-field→缺省 param1/text；k/label/t/group/required/default/help/validate 全编辑面写草稿', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema).toEqual([{ k: 'param1', t: 'text' }]);

      await act(async () => {
        setNativeValue(schemaRow(m, 0, 'k'), 'keywords');
        setNativeValue(schemaRow(m, 0, 'label'), '关键词组（每行一个）');
        setNativeValue(schemaRow(m, 0, 't'), 'textarea');
        setNativeValue(schemaRow(m, 0, 'group'), '采集');
        schemaRow(m, 0, 'required').click(); // 必填
        setNativeValue(schemaRow(m, 0, 'default'), '装修避坑');
        setNativeValue(schemaRow(m, 0, 'help'), '每行一个关键词');
        setNativeValue(schemaRow(m, 0, 'validate.regex'), '^.+$');
        setNativeValue(schemaRow(m, 0, 'validate.minLines'), '1');
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[0]).toEqual({
        k: 'keywords',
        label: '关键词组（每行一个）',
        t: 'textarea',
        group: '采集',
        required: true,
        default: '装修避坑',
        help: '每行一个关键词',
        validate: { regex: '^.+$', minLines: 1 },
      });

      await act(async () => {
        schemaRow(m, 0, 'required').click(); // 取消必填 → required 键删除（round-trip 干净）
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[0]?.required).toBeUndefined();
    } finally {
      await unmount(m);
    }
  });

  it('类型化编辑面：slider min/max/step＋数字 default、select opts、boolean default true', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          m.container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
        });
      }
      // slider：范围/步进（顶层 min/max/step——02 §8.1 示例形）＋default 数字化
      await act(async () => {
        setNativeValue(schemaRow(m, 0, 't'), 'slider');
      });
      await act(async () => {
        setNativeValue(schemaRow(m, 0, 'min'), '10');
        setNativeValue(schemaRow(m, 0, 'max'), '100');
        setNativeValue(schemaRow(m, 0, 'step'), '10');
        setNativeValue(schemaRow(m, 0, 'default'), '100');
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[0]).toEqual({
        k: 'param1',
        t: 'slider',
        min: 10,
        max: 100,
        step: 10,
        default: 100,
      });

      // select：静态 opts（逗号分隔→数组；G-1 V1 静态面）
      await act(async () => {
        setNativeValue(schemaRow(m, 1, 't'), 'select');
      });
      await act(async () => {
        setNativeValue(schemaRow(m, 1, 'opts'), '最新,最热');
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[1]).toEqual({
        k: 'param2',
        t: 'select',
        opts: ['最新', '最热'],
      });

      // boolean：default 三态（未设/true/false）
      await act(async () => {
        setNativeValue(schemaRow(m, 2, 't'), 'boolean');
      });
      await act(async () => {
        setNativeValue(schemaRow(m, 2, 'default'), 'true');
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[2]).toEqual({
        k: 'param3',
        t: 'boolean',
        default: true,
      });

      // secret：选中即带 storage:'safeStorage'（02 §8.1 示例形）；切离类型时清 select 遗留键
      await act(async () => {
        setNativeValue(schemaRow(m, 1, 't'), 'secret');
      });
      const secretField = useDefinitionDraftStore.getState().draft.paramsSchema[1];
      expect(secretField).toStrictEqual({ k: 'param2', t: 'secret', storage: 'safeStorage' });
      expect(Object.hasOwn(secretField as object, 'opts')).toBe(false);
    } finally {
      await unmount(m);
    }
  });

  it('排序与删除：move-up 交换声明序、remove 移除行', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      for (let i = 0; i < 2; i++) {
        await act(async () => {
          m.container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
        });
      }
      expect(useDefinitionDraftStore.getState().draft.paramsSchema.map((p) => p.k)).toEqual(['param1', 'param2']);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-schema-move-up="1"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema.map((p) => p.k)).toEqual(['param2', 'param1']);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-schema-remove="0"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.paramsSchema.map((p) => p.k)).toEqual(['param1']);
    } finally {
      await unmount(m);
    }
  });

  it('k 输入逐字符编辑不丢焦点（行 key=index 稳定——评审 MAJOR 回归：k 每键变化不得卸载重挂整行）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
      });
      const k0 = m.container.querySelector<HTMLInputElement>('[data-schema-row="0"] [data-schema-field="k"]');
      if (k0 === null) throw new Error('missing k input');
      await act(async () => {
        k0.focus();
      });
      expect(document.activeElement).toBe(k0);

      // 逐字符输入（每键一个渲染周期——k 值变化即行 key 变化 → 卸载重挂/焦点丢失即本回归对象）
      for (const v of ['k', 'ke', 'key', 'keywords']) {
        await act(async () => {
          const el = m.container.querySelector<HTMLInputElement>('[data-schema-row="0"] [data-schema-field="k"]');
          if (el !== null) setNativeValue(el, v);
        });
      }
      expect(document.activeElement).toBe(k0); // 焦点仍为同一 DOM 节点（未卸载重挂）
      expect(useDefinitionDraftStore.getState().draft.paramsSchema[0]?.k).toBe('keywords');
    } finally {
      await unmount(m);
    }
  });
});

describe('§6.1b 三类违例逐条定位 StepSchema 字段（computeStepErrors 投影复用）', () => {
  it('N3 白名单外类型：edit 载入脏 t（AI/zip 来源）→行内 paramsSchema[0].t＋rule=N3-type＋门拦；改选白名单类型即修复', async () => {
    const dirty: NodeDefinition = {
      ...fullDef(),
      paramsSchema: [{ k: 'x', t: 'colorful' }], // 白名单外（脏数据入口在类型系统外构造——validator 注释）
      policy: null,
      io: null,
    };
    await act(async () => {
      openNodeEditor({ type: 'xhs.search' }, { getDefinition: () => dirty });
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      const tSelect = schemaRow(m, 0, 't');
      expect((tSelect as HTMLSelectElement).value).toBe('colorful');
      expect(
        m.container.querySelector<HTMLSelectElement>('[data-schema-row="0"] [data-schema-field="t"] option[value="colorful"]'),
      ).toBeTruthy(); // 脏值占位显示（供修正——不静默丢弃）

      const err = m.container.querySelector('[data-field-error="paramsSchema[0].t"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N3-type');
      expect(err?.textContent).toContain('colorful');
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(true); // 门拦

      await act(async () => {
        setNativeValue(schemaRow(m, 0, 't'), 'text');
      });
      expect(m.container.querySelector('[data-field-error="paramsSchema[0].t"]')).toBe(null); // 修复即清
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(false);
    } finally {
      await unmount(m);
    }
  });

  it('N3-validate：regex 非法正则→行内 paramsSchema[0].validate.regex＋rule=N3-validate', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
      });
      await act(async () => {
        setNativeValue(schemaRow(m, 0, 'validate.regex'), '[');
      });
      const err = m.container.querySelector('[data-field-error="paramsSchema[0].validate.regex"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N3-validate');
      await act(async () => {
        setNativeValue(schemaRow(m, 0, 'validate.regex'), '^.+$');
      });
      expect(m.container.querySelector('[data-field-error="paramsSchema[0].validate.regex"]')).toBe(null);
    } finally {
      await unmount(m);
    }
  });

  it('N6 failBranch exit∉N2 outs：出口改名→行内 policy.onFailure.exit＋rule=N6-failBranch＋门拦；改选合法出口修复', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        setNativeValue(policyField(m, 'onFailure.type'), 'failBranch');
      });
      expect(useDefinitionDraftStore.getState().draft.policy).toEqual({
        onFailure: { type: 'failBranch', exit: 'out' }, // 选项面=N2 outs，缺省取首出口
      });
      expect(m.container.querySelector('[data-field-error="policy.onFailure.exit"]')).toBe(null);

      await renameFirstExit(m, 'done'); // 回端口把 out 改名 → 声明失配（02 §8.1 #5 交叉校验）
      const err = m.container.querySelector('[data-field-error="policy.onFailure.exit"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N6-failBranch');
      expect(err?.textContent).toContain('out');
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(true);

      await act(async () => {
        setNativeValue(policyField(m, 'onFailure.exit'), 'done');
      });
      expect(m.container.querySelector('[data-field-error="policy.onFailure.exit"]')).toBe(null);
      expect(useDefinitionDraftStore.getState().draft.policy).toEqual({ onFailure: { type: 'failBranch', exit: 'done' } });
      expect(m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.disabled).toBe(false);
    } finally {
      await unmount(m);
    }
  });

  it('N7 io.outputs 键⊄outs→行内 io.outputs.out＋rule=N7-outputs-keys；空字段行 name 缺失回显（N7-outputs-fields）；换键修复', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-action="add-outputs"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({ outputs: { out: { fields: [] } } });

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-fields="outputs.out"] [data-io-add-field]')?.click();
      });
      // 空字段行：name/type 缺失 → N7 每项 name＋type 回显（02 §8.1 #7）
      const nameErr = m.container.querySelector('[data-field-error="io.outputs.out.fields[0].name"]');
      expect(nameErr?.getAttribute('data-error-rule')).toBe('N7-outputs-fields');

      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="outputs.out"] [data-io-row="0"] [data-io-field="name"]') as HTMLInputElement,
          'notes',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="outputs.out"] [data-io-row="0"] [data-io-field="type"]') as HTMLInputElement,
          'object[]',
        );
      });
      expect(m.container.querySelector('[data-field-error="io.outputs.out.fields[0].name"]')).toBe(null);

      await renameFirstExit(m, 'done'); // 出口改名 → outputs 键⊄outs（02 §8.1 #7）
      const err = m.container.querySelector('[data-field-error="io.outputs.out"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N7-outputs-keys');
      expect(err?.textContent).toContain('out');
      expect(m.container.querySelectorAll('[data-field-error="io.outputs.out"]').length).toBe(1); // 同块不重复渲染（评审 MINOR2——精确命中只在出口行级出现一次）

      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLSelectElement>('[data-io-outputs-row="0"] [data-io-outputs-field="exit"]') as HTMLSelectElement,
          'done',
        );
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({
        outputs: { done: { fields: [{ name: 'notes', type: 'object[]' }] } },
      });
      expect(m.container.querySelector('[data-field-error="io.outputs.out"]')).toBe(null);
    } finally {
      await unmount(m);
    }
  });

  it('outputs 换键选项排除他行已占用出口 id（评审 MINOR1——改名为占用键不静默覆盖另一份 spec）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      // ports 增第二出口 done（换键撞占用场景需两个出口两行声明）
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-step-nav="ports"]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-ports-action="add-out"]')?.click();
      });
      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-ports-out-row="1"] [data-ports-field="id"]') as HTMLInputElement,
          'done',
        );
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-action="add-outputs"]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-action="add-outputs"]')?.click();
      });
      expect(Object.keys(useDefinitionDraftStore.getState().draft.io?.outputs ?? {})).toEqual(['out', 'done']);

      // 行 1（exit='done'）换键选项：不含 'out'（行 0 已占用）；自身键可选
      const sel = m.container.querySelector<HTMLSelectElement>('[data-io-outputs-row="1"] [data-io-outputs-field="exit"]');
      expect(sel?.querySelector('option[value="out"]')).toBe(null);
      expect(sel?.querySelector('option[value="done"]')).toBeTruthy();
    } finally {
      await unmount(m);
    }
  });
});

describe('N6/N7 高级声明分组（03 §1 冻结形——挂 StepSchema）', () => {
  it('policy 编辑＋0 值语义（X-4）：0=显式有效值、空=字段缺省；全清→policy=null', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      expect(useDefinitionDraftStore.getState().draft.policy).toBe(null); // create 骨架=未声明
      await act(async () => {
        setNativeValue(policyField(m, 'timeoutMs'), '0');
      });
      expect(useDefinitionDraftStore.getState().draft.policy).toEqual({ timeoutMs: 0 }); // 显式 0≠缺省（X-4）
      await act(async () => {
        setNativeValue(policyField(m, 'retries'), '2');
        setNativeValue(policyField(m, 'backoffMs'), '2000');
      });
      expect(useDefinitionDraftStore.getState().draft.policy).toEqual({ timeoutMs: 0, retries: 2, backoffMs: 2000 });
      await act(async () => {
        setNativeValue(policyField(m, 'timeoutMs'), ''); // 清空=字段缺省（缺省 30s，02 §8.6）
        setNativeValue(policyField(m, 'retries'), '');
        setNativeValue(policyField(m, 'backoffMs'), '');
      });
      expect(useDefinitionDraftStore.getState().draft.policy).toBe(null); // 未声明位回 null
    } finally {
      await unmount(m);
    }
  });

  it('io input/output 声明开关＋字段（name/type/example）写草稿；关 input→input 删除、output 保留', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSchema(m);
      await act(async () => {
        (m.container.querySelector<HTMLInputElement>('[data-io-toggle="input"]') as HTMLInputElement).click();
        (m.container.querySelector<HTMLInputElement>('[data-io-toggle="output"]') as HTMLInputElement).click();
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({ input: { fields: [] }, output: { fields: [] } });

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-fields="input"] [data-io-add-field]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-io-fields="output"] [data-io-add-field]')?.click();
      });
      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="input"] [data-io-row="0"] [data-io-field="name"]') as HTMLInputElement,
          'keywords',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="input"] [data-io-row="0"] [data-io-field="type"]') as HTMLInputElement,
          'string[]',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="output"] [data-io-row="0"] [data-io-field="name"]') as HTMLInputElement,
          'notes',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="output"] [data-io-row="0"] [data-io-field="type"]') as HTMLInputElement,
          'object[]',
        );
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="output"] [data-io-row="0"] [data-io-field="example"]') as HTMLInputElement,
          '[{title,likes,url}]',
        );
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({
        input: { fields: [{ name: 'keywords', type: 'string[]' }] },
        output: { fields: [{ name: 'notes', type: 'object[]', example: '[{title,likes,url}]' }] },
      });

      await act(async () => {
        (m.container.querySelector<HTMLInputElement>('[data-io-toggle="input"]') as HTMLInputElement).click(); // 关输入声明
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({
        output: { fields: [{ name: 'notes', type: 'object[]', example: '[{title,likes,url}]' }] },
      });
    } finally {
      await unmount(m);
    }
  });

  it('§6.1a 往返保留：edit 全形走到底 N3/N6/N7 逐字段等值；环节内改 retries/output 字段名→兄弟字段保留', async () => {
    const seed = fullDef();
    await act(async () => {
      openNodeEditor({ type: 'xhs.search' }, { getDefinition: () => seed });
    });
    const m = await mountShell();
    try {
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')?.click();
        });
      }
      expect(useDefinitionDraftStore.getState().step).toBe('save');
      const walked = useDefinitionDraftStore.getState().draft;
      expect(walked.paramsSchema).toEqual(seed.paramsSchema);
      expect(walked.policy).toEqual(seed.policy);
      expect(walked.io).toEqual(seed.io); // 走过实环节页零改动（编辑面不隐式改写草稿）

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]')?.click();
      });
      await act(async () => {
        setNativeValue(policyField(m, 'retries'), '5');
      });
      expect(useDefinitionDraftStore.getState().draft.policy).toEqual({ ...seed.policy, retries: 5 }); // 兄弟字段保留

      await act(async () => {
        setNativeValue(
          m.container.querySelector<HTMLInputElement>('[data-io-fields="output"] [data-io-row="0"] [data-io-field="name"]') as HTMLInputElement,
          'items',
        );
      });
      expect(useDefinitionDraftStore.getState().draft.io).toEqual({
        ...seed.io,
        output: { fields: [{ name: 'items', type: 'object[]', example: '[{title,likes,url}]' }] },
      });
    } finally {
      await unmount(m);
    }
  });
});
