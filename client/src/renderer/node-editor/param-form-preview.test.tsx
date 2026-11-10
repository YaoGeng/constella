// @vitest-environment jsdom
// ParamFormPreview 验收（T6-07；TDD-C-13 §3 ParamFormPreview 行「复用 C-02 ParamFormRenderer
// 做 schema 预览（=未来抽屉表单渲染结果，X-8）| {schema: ParamField[]} | 复用处=StepSchema」）。
//
// 断言面：①直接渲染=C-02 ParamForm 同源（[data-param-form] 根＋02 §8.3 t→控件映射＋group
// 分组/help/default 回填——非自绘表单）；②经 EditorShell 挂 StepSchema 右栏与草稿 schema
// 实时同步（PATH1 环节 3「schema 预览即未来抽屉表单的渲染结果」——01 §5.3 环节 3 GWT）。
// 组件测试栈=仓库惯例（jsdom docblock＋createRoot/act＋querySelector；无 testing-library）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import type { ParamField } from '@constella/shared/dsl';
import { EditorShell } from './editor-shell';
import { ParamFormPreview } from './param-form-preview';
import { openNodeEditor, useDefinitionDraftStore } from './definition-draft';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('ParamFormPreview＝C-02 ParamFormRenderer 同源渲染（X-8）', () => {
  it('直接渲染：[data-param-form] 根＋分组 fieldset＋help＋default 回填＋slider/secret 控件映射', async () => {
    const schema: ParamField[] = [
      { k: 'keywords', label: '关键词组', t: 'textarea', default: '装修避坑', group: '采集', help: '每行一个' },
      { k: 'ratio', label: '比例', t: 'slider', min: 10, max: 100, step: 10, default: 100 },
      { k: 'apiKey', label: '密钥', t: 'secret' },
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ParamFormPreview schema={schema} />);
    });
    try {
      // 同源标记：预览根内是 C-02 ParamForm 根（非自绘表单——两路径共用同一渲染器）
      expect(container.querySelector('[data-param-form-preview] [data-param-form]')).toBeTruthy();

      // 分组渲染（02 §8.3 Fieldset/Group）＋字段定位
      const group = container.querySelector('[data-param-group="采集"]');
      expect(group?.querySelector('[data-param-k="keywords"]')).toBeTruthy();

      // default 回填（编辑期无实例 params——value={} 由模型层回填 default）＋help
      const keywordsArea = group?.querySelector<HTMLTextAreaElement>('[data-param-k="keywords"] textarea');
      expect(keywordsArea?.value).toBe('装修避坑');
      expect(container.querySelector('[data-param-help-k="keywords"]')?.textContent).toBe('每行一个');

      // t→控件映射（02 §8.3 冻结表）：slider→range、secret→password 掩码
      expect(container.querySelector<HTMLInputElement>('[data-param-k="ratio"] [data-control="slider"]')?.value).toBe('100');
      expect(container.querySelector('[data-param-k="apiKey"] [data-control="input-password"]')).toBeTruthy();
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('经 EditorShell：schema 环节右栏实时同步——加字段即现、改 label/t/group 即时反映', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<EditorShell />);
    });
    try {
      await act(async () => {
        const q = container.querySelector<HTMLInputElement>('[data-meta-field="name"]');
        if (q) setNativeValue(q, '预览节点');
        const t = container.querySelector<HTMLInputElement>('[data-meta-field="type"]');
        if (t) setNativeValue(t, 'xhs.preview');
        container.querySelector<HTMLButtonElement>('[data-step-nav="schema"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('schema');
      expect(container.querySelector('[data-param-form-preview]')).toBeTruthy();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-schema-action="add-field"]')?.click();
      });
      const row1 = container.querySelector('[data-param-form-preview] [data-param-k="param1"]');
      expect(row1).toBeTruthy(); // 加字段即现（默认 text→Input）
      expect(row1?.querySelector('[data-control="input"]')).toBeTruthy();

      await act(async () => {
        const k = container.querySelector<HTMLInputElement>('[data-schema-row="0"] [data-schema-field="label"]');
        if (k) setNativeValue(k, '关键词');
      });
      expect(
        container.querySelector('[data-param-form-preview] [data-param-k="param1"] label')?.textContent,
      ).toBe('关键词'); // label 缺省回退 k→改 label 即时反映

      await act(async () => {
        const t = container.querySelector<HTMLSelectElement>('[data-schema-row="0"] [data-schema-field="t"]');
        if (t) setNativeValue(t, 'textarea');
      });
      expect(
        container.querySelector('[data-param-form-preview] [data-param-k="param1"] [data-control="textarea"]'),
      ).toBeTruthy(); // 换类型=换控件（同一映射表）

      await act(async () => {
        const g = container.querySelector<HTMLInputElement>('[data-schema-row="0"] [data-schema-field="group"]');
        if (g) setNativeValue(g, '采集');
      });
      const group = container.querySelector('[data-param-form-preview] [data-param-group="采集"]');
      expect(group?.querySelector('[data-param-k="param1"]')).toBeTruthy(); // 分组即时生效
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
