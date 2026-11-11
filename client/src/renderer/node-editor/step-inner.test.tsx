// @vitest-environment jsdom
// StepInner 验收（T6-09；TDD-C-13 §1 六环节组件面「StepInner（N5 步骤列表，非组合节点可
// 跳过——数据形复用 T4-09 InnerExpander）」；01 §5.3 PATH1 环节 5）。
//
// 断言面：inner 步骤列表增删改（数据形=InnerStep[]〔string〕——与 T4-09 InnerExpander.expand
// 消费形同源）；空态=非组合节点提示（可跳过——环节门对无 inner 定义不拦：inner null/[] 时
// goToStep('save') 可达）；步骤编辑写草稿 draft.inner。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorShell } from './editor-shell';
import { openNodeEditor, useDefinitionDraftStore } from './definition-draft';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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

/** 直达环节 5（meta 门净——名称/type 填好；中途环节门对最小合法骨架净） */
async function atInner(m: { container: HTMLDivElement }): Promise<void> {
  await act(async () => {
    setNativeValue(field(m.container, 'name'), '组合节点');
    setNativeValue(field(m.container, 'type'), 'xhs.compose');
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="inner"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('inner');
  expect(m.container.querySelector('[data-step-form="inner"]')).toBeTruthy();
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('环节 5 StepInner（N5 步骤列表——数据形 InnerStep[]）', () => {
  it('空态：非组合节点提示「可跳过」；门不拦——直接导航 save 可达（环节门对无 inner 定义不拦）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atInner(m);
      expect(m.container.querySelector('[data-inner-empty]')?.textContent).toContain('非组合节点');
      expect(m.container.querySelector('[data-inner-empty]')?.textContent).toContain('跳过');
      // 门不拦：save 导航可达（inner 环节可跳过）
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-step-nav="save"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('save');
      expect(useDefinitionDraftStore.getState().draft.inner ?? null).toBe(null); // 未声明
    } finally {
      await unmount(m);
    }
  });

  it('添加步骤→编辑文本写草稿（1 基序号展示）→删除末步骤回到非组合（null）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atInner(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-inner-add]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-inner-add]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.inner).toEqual(['', '']);
      expect(m.container.querySelectorAll('[data-inner-row]')).toHaveLength(2);
      expect(m.container.querySelector('[data-inner-seq="1"]')?.textContent).toBe('1.'); // 1 基（demo L2066 编号同源）

      await act(async () => {
        setNativeValue(m.container.querySelector<HTMLInputElement>('[data-inner-input="0"]')!, '打开搜索页');
        setNativeValue(m.container.querySelector<HTMLInputElement>('[data-inner-input="1"]')!, '提取列表');
      });
      expect(useDefinitionDraftStore.getState().draft.inner).toEqual(['打开搜索页', '提取列表']);

      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-inner-remove="1"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.inner).toEqual(['打开搜索页']);
      // 删尽→回到非组合声明（null——「可跳过」空态复原）
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-inner-remove="0"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.inner ?? null).toBe(null);
      expect(m.container.querySelector('[data-inner-empty]')).toBeTruthy();
    } finally {
      await unmount(m);
    }
  });

  it('步骤间删除中间步骤：后续行内容正确随位（受控 value=props——无错位残留）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atInner(m);
      await act(async () => {
        useDefinitionDraftStore.getState().setInner(['一', '二', '三']);
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-inner-remove="0"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().draft.inner).toEqual(['二', '三']);
      expect(
        Array.from(m.container.querySelectorAll<HTMLInputElement>('[data-inner-input]')).map((i) => i.value),
      ).toEqual(['二', '三']); // 受控同步——无幽灵行
    } finally {
      await unmount(m);
    }
  });
});
