// @vitest-environment jsdom
// ParamFormRenderer 验收（T4-08；C-02 §6.2＋§1 renderParamForm 行；02 §8.3 映射冻结表）。
//
// 组件测试栈=T3-01 惯例：jsdom docblock 局部环境＋createRoot/act（React 19 须 await act）＋
// container.querySelector 断言（项目无 testing-library 依赖——不引新依赖红线）。
// §6.2 三断言：①8 类型×shadcn 组件映射快照逐行一致（02 §8.3 表——控件行 inline snapshot
// ＋tagName/type/data-control 语义断言）；②group 分组渲染（Fieldset/legend）；③json 型提交
// JSON.parse 拦截非法。另覆盖 renderParamForm 模型面（默认值回填/掩码/分组模型/注册扩展）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ParamField } from '@constella/shared/dsl';
import type { SecretBridge } from './secret-param-binder';
import { createSecretParamBinder } from './secret-param-binder';
import type { ParamFormProps } from './ParamForm';
import { ParamForm } from './ParamForm';
import { renderParamForm, registerParamControl } from './param-form-model';
import { PARAM_TYPE_WHITELIST } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 02 §8.3 冻结映射表（t → shadcn 组件行；映射快照的期望源） */
const FROZEN_MAP: Record<string, string> = {
  text: 'input',
  number: 'input-number',
  select: 'select',
  textarea: 'textarea',
  boolean: 'switch',
  secret: 'input-password',
  json: 'textarea-json',
  slider: 'slider',
};

/** 8 类型齐备 schema（映射快照用；值/选项形取 02 §8.1 示例邻接形态） */
function schema8(): ParamField[] {
  return [
    { k: 'note', label: '备注', t: 'text', ph: '随手可跑' },
    { k: 'maxNotes', label: '上限', t: 'number', default: 40 },
    { k: 'sort', label: '排序', t: 'select', opts: ['综合', '最新', '最热'] },
    { k: 'keywords', label: '关键词组', t: 'textarea' },
    { k: 'withComments', label: '采评论', t: 'boolean', default: false },
    { k: 'apiKey', label: '密钥', t: 'secret', storage: 'safeStorage' },
    { k: 'config', label: '配置', t: 'json' },
    { k: 'ratio', label: '比例', t: 'slider', min: 10, max: 100, step: 10, default: 100 },
  ];
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

async function mountForm(props: ParamFormProps): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ParamForm {...props} />);
  });
  return { container, root };
}

async function unmountForm(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

/** React 受控件原生赋值＋事件派发（jsdom 不触发 React 合成 onChange，须走原生 setter） */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  eventName: 'input' | 'change' = 'input',
): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

/** secret:* mock 通道（真通道随 T4-15/C-M1 ⚠ 补跑） */
function mockSecretBridge(): SecretBridge & { vault: Map<string, string> } {
  const vault = new Map<string, string>();
  return {
    vault,
    set: vi.fn(async ({ key, value }: { key: string; value?: string }) => {
      vault.set(key, value ?? '');
      return { ok: true };
    }),
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: vault.get(key) ?? null,
    })),
    del: vi.fn(async (_req: unknown) => ({ ok: true })),
  } as unknown as SecretBridge & { vault: Map<string, string> };
}

describe('§6.2① renderParamForm 模型面——t→shadcn 映射（02 §8.3 冻结表）', () => {
  it('白名单 8 类逐类映射（PARAM_TYPE_WHITELIST=T4-07 单一来源驱动）', () => {
    const model = renderParamForm(schema8(), {});
    expect(model.fields.map((f) => f.k)).toEqual([
      'note', 'maxNotes', 'sort', 'keywords', 'withComments', 'apiKey', 'config', 'ratio',
    ]);
    for (const t of PARAM_TYPE_WHITELIST) {
      const field = model.fields.find((f) => f.k === schema8().find((p) => p.t === t)?.k);
      expect(field?.control, `t=${t}`).toBe(FROZEN_MAP[t]);
    }
  });

  it('默认值回填：值缺省取 default、在场值优先', () => {
    const model = renderParamForm(schema8(), { maxNotes: 7, ratio: 30 });
    expect(model.fields.find((f) => f.k === 'maxNotes')?.value).toBe(7); // 在场值优先
    expect(model.fields.find((f) => f.k === 'ratio')?.value).toBe(30);
    expect(model.fields.find((f) => f.k === 'note')?.value).toBeUndefined(); // 无默认无值
    const fresh = renderParamForm(schema8(), {});
    expect(fresh.fields.find((f) => f.k === 'maxNotes')?.value).toBe(40); // default 回填
  });

  it('secret 型：masked=sk-***（值非空引用键时）、model.value 保持引用键（零明文）', () => {
    const model = renderParamForm(
      [{ k: 'apiKey', t: 'secret', storage: 'safeStorage' }],
      { apiKey: 'secret.param.n1.apiKey' },
    );
    expect(model.fields[0]?.masked).toBe('sk-***');
    expect(model.fields[0]?.value).toBe('secret.param.n1.apiKey');
    const empty = renderParamForm([{ k: 'apiKey', t: 'secret' }], {});
    expect(empty.fields[0]?.masked).toBe('');
  });

  it('label 回退 k＋help 透传＋分组模型（ungrouped 平铺＋具名组首现序）', () => {
    const model = renderParamForm(
      [
        { k: 'note', t: 'text', help: '随手记' },
        { k: 'keywords', t: 'textarea', group: '采集' },
        { k: 'maxNotes', t: 'number', group: '采集' },
        { k: 'ratio', t: 'slider', group: '输出' },
      ],
      {},
    );
    expect(model.fields[0]?.label).toBe('note'); // label 缺省回退 k
    expect(model.fields[0]?.help).toBe('随手记');
    expect(model.ungrouped.map((f) => f.k)).toEqual(['note']);
    expect(model.groups.map((g) => g.name)).toEqual(['采集', '输出']);
    expect(model.groups[0]?.fields.map((f) => f.k)).toEqual(['keywords', 'maxNotes']);
  });

  it('组件注册面（§8 替换点①）：新类型注册映射生效；未注册类型回退 input', () => {
    registerParamControl('date', 'input');
    const model = renderParamForm([{ k: 'when', t: 'date' }, { k: 'x', t: 'unknown-t' }], {});
    expect(model.fields[0]?.control).toBe('input');
    expect(model.fields[1]?.control).toBe('input'); // 回退 text 基线（定义侧白名单另拦）
  });
});

describe('§6.2① ParamForm 组件面——8 类型×shadcn 控件映射快照逐行一致', () => {
  it('每类型控件行快照＋tagName/type/data-control 语义断言', async () => {
    const onChange = vi.fn();
    const m = await mountForm({
      schema: schema8(),
      value: { note: 'n', sort: '最新', keywords: 'a\nb', config: '{"x":1}' },
      onChange,
    });
    try {
      const q = <T extends HTMLElement>(sel: string): T => {
        const el = m.container.querySelector<T>(sel);
        expect(el, sel).toBeTruthy();
        return el as T;
      };
      // text → Input（02 §8.3）
      const text = q<HTMLInputElement>('[data-param-k="note"] input');
      expect(text.getAttribute('data-control')).toBe('input');
      expect(text.value).toBe('n');
      expect(text.outerHTML).toMatchInlineSnapshot(`"<input id="cn-param-note" data-control="input" class="h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 py-1 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)]" placeholder="随手可跑" value="n">"`);

      // number → Input[type=number]
      const num = q<HTMLInputElement>('[data-param-k="maxNotes"] input');
      expect(num.type).toBe('number');
      expect(num.getAttribute('data-control')).toBe('input-number');
      expect(num.outerHTML).toMatchInlineSnapshot(`"<input id="cn-param-maxNotes" data-control="input-number" class="h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 py-1 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)]" type="number" value="40">"`);

      // select → Select（选项投影＋选中态）
      const sel = q<HTMLSelectElement>('[data-param-k="sort"] select');
      expect(sel.getAttribute('data-control')).toBe('select');
      expect(Array.from(sel.options).map((o) => o.value)).toEqual(['综合', '最新', '最热']);
      expect(sel.value).toBe('最新');
      expect(sel.outerHTML).toMatchInlineSnapshot(`"<select id="cn-param-sort" data-control="select" class="h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 py-1 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] appearance-none"><option value="综合">综合</option><option value="最新">最新</option><option value="最热">最热</option></select>"`);

      // textarea → Textarea
      const ta = q<HTMLTextAreaElement>('[data-param-k="keywords"] textarea');
      expect(ta.getAttribute('data-control')).toBe('textarea');
      expect(ta.value).toBe('a\nb');
      expect(ta.outerHTML).toMatchInlineSnapshot(`
        "<textarea id="cn-param-keywords" data-control="textarea" rows="3" class="w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] h-auto py-2">a
        b</textarea>"
      `);

      // boolean → Switch（role=switch＋aria-checked）
      const sw = q<HTMLButtonElement>('[data-param-k="withComments"] button');
      expect(sw.getAttribute('data-control')).toBe('switch');
      expect(sw.getAttribute('role')).toBe('switch');
      expect(sw.getAttribute('aria-checked')).toBe('false');
      expect(sw.outerHTML).toMatchInlineSnapshot(`"<button type="button" id="cn-param-withComments" role="switch" aria-checked="false" data-control="switch" class="inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors border-[var(--line-2)] bg-transparent"><span aria-hidden="true" class="ml-0.5 block h-3.5 w-3.5 rounded-full transition-transform translate-x-0 bg-[var(--tx-3)]"></span></button>"`);

      // secret → Input(type=password 掩码；显示=sk-*** 非 refKey/明文)
      const pw = q<HTMLInputElement>('[data-param-k="apiKey"] input');
      expect(pw.type).toBe('password');
      expect(pw.getAttribute('data-control')).toBe('input-password');
      expect(pw.value).toBe('');
      expect(pw.outerHTML).toMatchInlineSnapshot(`"<input id="cn-param-apiKey" autocomplete="off" data-control="input-password" class="h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 py-1 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)]" placeholder="输入新密钥，保存后掩码回显" type="password" value="">"`);

      // json → Textarea＋提交 JSON.parse 校验
      const js = q<HTMLTextAreaElement>('[data-param-k="config"] textarea');
      expect(js.getAttribute('data-control')).toBe('textarea-json');
      expect(js.outerHTML).toMatchInlineSnapshot(`"<textarea id="cn-param-config" data-control="textarea-json" rows="3" class="w-full rounded-md border border-[var(--line-2)] bg-[rgba(7,12,25,0.84)] px-3 text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] h-auto py-2 font-mono">{"x":1}</textarea>"`);

      // slider → Slider（min/max/step 投影）
      const sl = q<HTMLInputElement>('[data-param-k="ratio"] input');
      expect(sl.type).toBe('range');
      expect(sl.getAttribute('data-control')).toBe('slider');
      expect(sl.getAttribute('min')).toBe('10');
      expect(sl.getAttribute('max')).toBe('100');
      expect(sl.getAttribute('step')).toBe('10');
      expect(sl.outerHTML).toMatchInlineSnapshot(`"<input id="cn-param-ratio" data-control="slider" class="w-full accent-[var(--accent)]" min="10" max="100" step="10" type="range" value="100">"`);
    } finally {
      await unmountForm(m);
    }
  });
});

describe('§6.2② group 分组渲染（Fieldset/legend）', () => {
  it('具名组入 fieldset＋legend；散字段在组外且在前', async () => {
    const m = await mountForm({
      schema: [
        { k: 'note', label: '备注', t: 'text' },
        { k: 'keywords', label: '关键词组', t: 'textarea', group: '采集' },
        { k: 'maxNotes', label: '上限', t: 'number', group: '采集' },
        { k: 'ratio', label: '比例', t: 'slider', group: '输出' },
      ],
      value: {},
    });
    try {
      const groups = m.container.querySelectorAll('fieldset[data-param-group]');
      expect(Array.from(groups).map((g) => g.getAttribute('data-param-group'))).toEqual(['采集', '输出']);
      expect(groups[0]?.querySelector('legend')?.textContent).toBe('采集');
      expect(Array.from(groups[0]?.querySelectorAll('[data-param-k]') ?? []).map((f) => f.getAttribute('data-param-k'))).toEqual(['keywords', 'maxNotes']);
      // 散字段不进任何 fieldset
      const outside = m.container.querySelector('[data-param-k="note"]');
      expect(outside?.closest('fieldset')).toBeNull();
      expect(m.container.querySelector('[data-param-form]')?.firstElementChild?.getAttribute('data-param-k')).toBe('note');
    } finally {
      await unmountForm(m);
    }
  });
});

describe('§6.2③ json 型提交 JSON.parse 拦截非法', () => {
  it('非法 JSON → 错误展示且 onChange 不触发；合法 → 提交解析后的对象', async () => {
    const onChange = vi.fn();
    const m = await mountForm({
      schema: [{ k: 'config', label: '配置', t: 'json' }],
      value: { config: '{"x":1}' },
      onChange,
    });
    try {
      const ta = m.container.querySelector<HTMLTextAreaElement>('textarea[data-control="textarea-json"]');
      expect(ta).toBeTruthy();

      await act(async () => {
        setNativeValue(ta as HTMLTextAreaElement, '{"a":');
      });
      expect(onChange).not.toHaveBeenCalled(); // 拦截：非法不提交
      expect(m.container.querySelector('[data-param-error-k="config"]')?.textContent).toContain('JSON');

      await act(async () => {
        setNativeValue(ta as HTMLTextAreaElement, '{"a":1}');
      });
      expect(onChange).toHaveBeenCalledWith('config', { a: 1 }); // 合法：提交解析后对象
      expect(m.container.querySelector('[data-param-error-k="config"]')).toBeNull(); // 错误清除
    } finally {
      await unmountForm(m);
    }
  });
});

describe('组件交互接线（onChange/掩码绑定/错误注入）', () => {
  it('text/number/select/switch/slider 变更 → onChange(k, 值)', async () => {
    const onChange = vi.fn();
    const m = await mountForm({
      schema: [
        { k: 'note', t: 'text' },
        { k: 'maxNotes', t: 'number' },
        { k: 'sort', t: 'select', opts: ['a', 'b'] },
        { k: 'flag', t: 'boolean', default: false },
        { k: 'ratio', t: 'slider', min: 0, max: 10, step: 1 },
      ],
      value: { note: '', maxNotes: 1, sort: 'a', flag: false, ratio: 5 },
      onChange,
    });
    try {
      await act(async () => {
        setNativeValue(m.container.querySelector('[data-param-k="note"] input') as HTMLInputElement, '新值');
      });
      expect(onChange).toHaveBeenLastCalledWith('note', '新值');

      await act(async () => {
        setNativeValue(m.container.querySelector('[data-param-k="maxNotes"] input') as HTMLInputElement, '50');
      });
      expect(onChange).toHaveBeenLastCalledWith('maxNotes', 50); // number 型提交数字

      await act(async () => {
        setNativeValue(m.container.querySelector('[data-param-k="sort"] select') as HTMLSelectElement, 'b', 'change');
      });
      expect(onChange).toHaveBeenLastCalledWith('sort', 'b');

      await act(async () => {
        (m.container.querySelector('[data-param-k="flag"] button') as HTMLButtonElement).click();
      });
      expect(onChange).toHaveBeenLastCalledWith('flag', true); // switch 翻转

      await act(async () => {
        const sl = m.container.querySelector('[data-param-k="ratio"] input') as HTMLInputElement;
        setNativeValue(sl, '7', 'change');
      });
      expect(onChange).toHaveBeenLastCalledWith('ratio', 7);
    } finally {
      await unmountForm(m);
    }
  });

  it('secret：输入明文→失焦经 binder 写通道，onChange 只收引用键、输入回显掩码', async () => {
    const bridge = mockSecretBridge();
    const binder = createSecretParamBinder(bridge, { scope: 'n1' });
    const onChange = vi.fn();
    const m = await mountForm({
      schema: [{ k: 'apiKey', label: '密钥', t: 'secret', storage: 'safeStorage' }],
      value: { apiKey: 'secret.param.n1.apiKey' },
      onChange,
      secretBinder: binder,
    });
    try {
      const pw = m.container.querySelector('[data-param-k="apiKey"] input') as HTMLInputElement;
      expect(pw.value).toBe('sk-***'); // 已绑定 → 掩码回显（§3 bindSecret 展示语义）

      await act(async () => {
        setNativeValue(pw, 'sk-live-NEW-plain'); // 输入明文（password 掩显）
      });
      expect(onChange).not.toHaveBeenCalled(); // 明文不进 onChange/params

      await act(async () => {
        pw.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // 失焦提交
      });
      expect(bridge.set).toHaveBeenCalledWith({ key: 'secret.param.n1.apiKey', value: 'sk-live-NEW-plain' });
      expect(onChange).toHaveBeenCalledWith('apiKey', 'secret.param.n1.apiKey'); // 只收引用键
      expect(pw.value).toBe('sk-***'); // 回显掩码——表单值零明文
    } finally {
      await unmountForm(m);
    }
  });

  it('validateParams 错误注入 → 错误定位字段 k 展示', async () => {
    const m = await mountForm({
      schema: [{ k: 'keywords', label: '关键词组', t: 'textarea', required: true }],
      value: {},
      errors: [{ field: 'keywords', message: '「关键词组」为必填项', rule: 'required' }],
    });
    try {
      expect(m.container.querySelector('[data-param-error-k="keywords"]')?.textContent).toBe('「关键词组」为必填项');
      expect(m.container.querySelector('[data-param-k="keywords"] label')?.textContent).toBe('关键词组');
    } finally {
      await unmountForm(m);
    }
  });
});
