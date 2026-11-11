// @vitest-environment jsdom
// StepScript 验收（T6-08；TDD-C-13 §3 StepScript/ContractInjector/SyntaxChecker 行＋§6.1d
// 「ts 语法错误→保存拒绝并回指 StepScript 行号」；01 §5.3 PATH1 环节 4 脚本页）。
//
// 断言面（05 T6-08 验收＝「ts 语法错误拒绝+行号、py 语法错误拒绝+行号（T0-04 同构口径）」
// ＋lang 切换语义＋契约模板注入接线）：环节 4 经 EditorShell 全链（子页 tab=脚本页默认）；
// 语法门沿 T6-06 既有门形（next 禁用＋data-gate-blocked=step）＋错误列表逐条「L<行号>
// <message>」可定位。组件测试栈=仓库惯例（T6-06/07 先例）：jsdom docblock＋createRoot/act＋
// container.querySelector 断言；受控输入走原生 setter＋事件派发。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorShell } from './editor-shell';
import { useDefinitionDraftStore } from './definition-draft';

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

/** 直达环节 4 脚本页（create 态填好名称/type——meta/ports/schema 门净） */
async function atScript(m: { container: HTMLDivElement }): Promise<void> {
  await act(async () => {
    setNativeValue(m.container.querySelector<HTMLInputElement>('[data-meta-field="name"]')!, '脚本节点');
    setNativeValue(m.container.querySelector<HTMLInputElement>('[data-meta-field="type"]')!, 'xhs.script');
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="script"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('script');
}

function editor(m: { container: HTMLDivElement }): HTMLTextAreaElement {
  return m.container.querySelector<HTMLTextAreaElement>('[data-script-editor]')!;
}

function nextBtn(m: { container: HTMLDivElement }): HTMLButtonElement {
  return m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')!;
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('环节 4 脚本页结构（lang 切换＋等宽编辑器＋注入按钮）', () => {
  it('默认子页=脚本页：py|ts 切换钮＋等宽 textarea＋注入契约模板按钮', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      expect(m.container.querySelector('[data-step-form="script"]')).toBeTruthy();
      expect(m.container.querySelector<HTMLButtonElement>('[data-script-lang="python"]')?.textContent).toBe('py');
      expect(m.container.querySelector<HTMLButtonElement>('[data-script-lang="ts"]')?.textContent).toBe('ts');
      const ta = editor(m);
      expect(ta).toBeTruthy();
      expect(ta.className).toContain('font-mono'); // 等宽纯文本（X-8 V1——高亮=P2 扩展位）
      expect(m.container.querySelector<HTMLButtonElement>('[data-script-inject]')).toBeTruthy();
    } finally {
      await unmount(m);
    }
  });

  it('lang 切换保留各自文本（py 输入→切 ts 空→切回 py 原文在）', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      await act(async () => {
        setNativeValue(editor(m), 'x = 1');
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-lang="ts"]')?.click();
      });
      expect(useDefinitionDraftStore.getState().script.lang).toBe('ts');
      expect(editor(m).value).toBe(''); // ts 文本空起（各自存续）
      await act(async () => {
        setNativeValue(editor(m), 'const a = 1;');
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-lang="python"]')?.click();
      });
      expect(editor(m).value).toBe('x = 1'); // py 文本保留
      expect(useDefinitionDraftStore.getState().script.ts).toBe('const a = 1;'); // ts 侧亦存续
    } finally {
      await unmount(m);
    }
  });

  it('注入契约模板：以当前 lang+N3 默认值替换当前语言脚本文本（@constella/sdk 头）', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    useDefinitionDraftStore.getState().setParamsSchema([{ k: 'maxNotes', t: 'number', default: 40 }]);
    const m = await mountShell();
    try {
      await atScript(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-inject]')?.click();
      });
      const v = editor(m).value;
      expect(v.startsWith('# scripts/main.py · 星丛 Constella 节点脚本\n')).toBe(true); // lang=python 初始
      expect(v).toContain('"maxNotes": "40"');
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-lang="ts"]')?.click();
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-inject]')?.click();
      });
      expect(editor(m).value).toContain('from "@constella/sdk"'); // 02 §14 包名（@flowforge 作废）
    } finally {
      await unmount(m);
    }
  });
});

describe('语法校验保存门（§6.1d——ts/py 语法错误拒绝并回指行号）', () => {
  it('py 语法错误（T0-04 口径）：next 禁用＋data-gate-blocked=script＋错误列表「L1 Syntax error」', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      await act(async () => {
        setNativeValue(editor(m), 'def f(:');
      });
      expect(nextBtn(m).disabled).toBe(true);
      expect(nextBtn(m).getAttribute('data-gate-blocked')).toBe('script');
      const errs = Array.from(m.container.querySelectorAll('[data-script-error]')).map((e) => e.textContent ?? '');
      expect(errs.some((t) => t.includes('L1') && t.includes('Syntax error'))).toBe(true);
      await act(async () => {
        nextBtn(m).click(); // 门未过——点击无效
      });
      expect(useDefinitionDraftStore.getState().step).toBe('script');

      await act(async () => {
        setNativeValue(editor(m), 'x = 1\n'); // 修正→门过
      });
      expect(nextBtn(m).disabled).toBe(false);
      await act(async () => {
        nextBtn(m).click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('inner');
    } finally {
      await unmount(m);
    }
  });

  it('ts 语法错误：切 ts 输入违例→拦截＋「L1」行号回指（parser 原生 message）；合法后过门', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-lang="ts"]')?.click();
      });
      await act(async () => {
        setNativeValue(editor(m), 'const x: = 1');
      });
      expect(nextBtn(m).disabled).toBe(true);
      const errs = Array.from(m.container.querySelectorAll('[data-script-error]')).map((e) => e.textContent ?? '');
      expect(errs.some((t) => t.includes('L1'))).toBe(true);
      expect(errs.some((t) => t.includes('Type expected'))).toBe(true);
      await act(async () => {
        setNativeValue(editor(m), 'const x: number = 1;');
      });
      expect(nextBtn(m).disabled).toBe(false);
    } finally {
      await unmount(m);
    }
  });

  it('多行违例回指对应行号（第 2 行）＋多错误逐条列出', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-script-lang="ts"]')?.click();
      });
      await act(async () => {
        setNativeValue(editor(m), 'const a = 1;\nbad(((');
      });
      const errs = Array.from(m.container.querySelectorAll('[data-script-error]')).map((e) => e.textContent ?? '');
      expect(errs.some((t) => t.includes('L2'))).toBe(true); // 行定位=第 2 行
    } finally {
      await unmount(m);
    }
  });

  it('空脚本文本零诊断不拦门（noScript 语义归 T6-09 保存链）', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atScript(m);
      expect(nextBtn(m).disabled).toBe(false); // 初始空文本——门净
    } finally {
      await unmount(m);
    }
  });
});
