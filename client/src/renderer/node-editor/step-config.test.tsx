// @vitest-environment jsdom
// StepConfig 验收（T6-08；TDD-C-13 §3 ConfigYamlEditor 行＋§6.1e「config 键与 schema 键
// 不一致→警告」；01 §5.3 PATH1 环节 4 config 页——两页合一环节）。
//
// 断言面（05 T6-08 验收＝「config 键不一致警告」「覆盖顺序提示存在性」）：页头固定提示
// 覆盖顺序「脚本 PARAMS ← config/*.yaml ← 节点实例 params（抽屉）」（02 §14 冻结）；键失配
// =警告不拦截（§6.1e——next 不禁用）；按 N3 生成默认配置＋编辑写草稿。组件测试栈=仓库惯例。
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

/** 直达环节 4 config 子页（create 态填好名称/type，script 前置门净——空脚本文本零诊断） */
async function atConfig(m: { container: HTMLDivElement }): Promise<void> {
  await act(async () => {
    setNativeValue(m.container.querySelector<HTMLInputElement>('[data-meta-field="name"]')!, '配置节点');
    setNativeValue(m.container.querySelector<HTMLInputElement>('[data-meta-field="type"]')!, 'xhs.config');
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="script"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('script');
  await act(async () => {
    m.container.querySelector<HTMLButtonElement>('[data-script-page-tab="config"]')?.click();
  });
  expect(m.container.querySelector('[data-step-form="config"]')).toBeTruthy();
}

function configEditor(m: { container: HTMLDivElement }): HTMLTextAreaElement {
  return m.container.querySelector<HTMLTextAreaElement>('[data-config-editor]')!;
}

function nextBtn(m: { container: HTMLDivElement }): HTMLButtonElement {
  return m.container.querySelector<HTMLButtonElement>('[data-testid="ne-next"]')!;
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('环节 4 config 页结构（覆盖顺序提示——02 §14 冻结）', () => {
  it('页头固定提示覆盖顺序「脚本 PARAMS ← config/*.yaml ← 节点实例 params（抽屉）」', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atConfig(m);
      const tip = m.container.querySelector('[data-testid="ne-config-overlay-order"]');
      expect(tip?.textContent).toContain('脚本 PARAMS ← config/*.yaml ← 节点实例 params（抽屉）');
    } finally {
      await unmount(m);
    }
  });

  it('编辑 config yaml 文本写草稿（script.configYaml——内存不落盘）', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atConfig(m);
      await act(async () => {
        setNativeValue(configEditor(m), 'node: xhs.config\nparams:\n  a: 1\n');
      });
      expect(useDefinitionDraftStore.getState().script.configYaml).toBe('node: xhs.config\nparams:\n  a: 1\n');
    } finally {
      await unmount(m);
    }
  });

  it('「按 N3 生成默认配置」按钮：以当前 type＋N3 schema 生成 demo 形默认 yaml', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    useDefinitionDraftStore.getState().setParamsSchema([{ k: 'maxNotes', t: 'number', default: 40 }]);
    const m = await mountShell();
    try {
      await atConfig(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-config-generate]')?.click();
      });
      expect(configEditor(m).value).toBe(
        '# config/xhs.config.yaml · 节点默认配置（抽屉参数可覆盖）\nnode: xhs.config\nparams:\n  maxNotes: 40\n',
      );
    } finally {
      await unmount(m);
    }
  });
});

describe('与 N3 键一致性（§6.1e——警告不拦截）', () => {
  it('键失配：警告列出缺失/多余键＋明示「不拦截」；next 不禁用', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    useDefinitionDraftStore.getState().setParamsSchema([
      { k: 'keywords', t: 'textarea' },
      { k: 'maxNotes', t: 'number', default: 40 },
    ]);
    const m = await mountShell();
    try {
      await atConfig(m);
      await act(async () => {
        setNativeValue(configEditor(m), 'node: xhs.config\nparams:\n  maxNotes: 40\n  ghost: 1\n');
      });
      const warn = m.container.querySelector('[data-config-warn]');
      expect(warn?.textContent).toContain('keywords'); // N3 已定义、yaml 缺失
      expect(warn?.textContent).toContain('ghost'); // yaml 有、N3 未定义
      expect(warn?.textContent).toContain('不拦截'); // §6.1e 警告语义明示
      expect(nextBtn(m).disabled).toBe(false); // 警告不影响门
    } finally {
      await unmount(m);
    }
  });

  it('键一致 → 无警告；yaml 形不符（无 params: 段）→ 形不符警告（亦不拦截）', async () => {
    await act(async () => {
      useDefinitionDraftStore.getState().openNodeEditor();
    });
    useDefinitionDraftStore.getState().setParamsSchema([{ k: 'maxNotes', t: 'number', default: 40 }]);
    const m = await mountShell();
    try {
      await atConfig(m);
      await act(async () => {
        setNativeValue(configEditor(m), 'node: xhs.config\nparams:\n  maxNotes: 40\n');
      });
      expect(m.container.querySelector('[data-config-warn]')).toBe(null); // 一致=零警告
      await act(async () => {
        setNativeValue(configEditor(m), '# 随手写\nnode: x\n');
      });
      const warn = m.container.querySelector('[data-config-warn]');
      expect(warn?.textContent).toContain('params'); // 形不符提示（缺 params: 段）
      expect(nextBtn(m).disabled).toBe(false);
    } finally {
      await unmount(m);
    }
  });
});
