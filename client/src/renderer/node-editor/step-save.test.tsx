// @vitest-environment jsdom
// StepSave 验收（T6-09；TDD-C-13 §1「StepSave（N8 version/packageVersion＋完整性校验汇总
// ＋source='manual'＋保存）」＋§6.1f；01 §5.3 PATH1 环节 6）。
//
// 断言面：N8 双 semver 字段写草稿；完整性校验汇总（六环节门错误汇总——computeStepErrors
// 全投影按环节分组展示）；source='manual' 语义位展示；保存按钮触发注入的 SavePipeline
// （assets 经 assetsFromScriptDraft 适配——M5 只打包当前 lang）；保存成功→dirty 复位
// （markSaved）；保存被拒→汇总定位错误环节；保存链异常→错误面。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorShell } from './editor-shell';
import { openNodeEditor, useDefinitionDraftStore } from './definition-draft';
import { assetsFromScriptDraft, createSavePipeline, type SaveReport } from './save-pipeline';
import type { SaveAssets, SavePipelineDeps } from './save-pipeline';

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

/** 直达环节 6（名称/type 填好——其余环节门对最小合法骨架净） */
async function atSave(m: { container: HTMLDivElement }): Promise<void> {
  await act(async () => {
    setNativeValue(field(m.container, 'name'), '保存节点');
    setNativeValue(field(m.container, 'type'), 'xhs.save');
    m.container.querySelector<HTMLButtonElement>('[data-step-nav="save"]')?.click();
  });
  expect(useDefinitionDraftStore.getState().step).toBe('save');
  expect(m.container.querySelector('[data-step-form="save"]')).toBeTruthy();
}

/** 注入保存链的入口 deps（mock 五口——saveToLibrary 记录入参） */
function pipelineFace(result: SaveReport | Error = { ok: true }) {
  const calls: Array<{ doc: { type: string; meta: { source?: string } }; assets: SaveAssets }> = [];
  const deps: SavePipelineDeps = {
    assemble: () => ({ bytes: new Uint8Array([1]) }),
    register: () => undefined,
    upsertDefinition: async () => undefined,
    libraryUpsert: async () => undefined,
    importer: { importArchiveBytes: async () => ({ nodes: [], noScript: [] }) },
  };
  const pipeline = createSavePipeline(deps);
  const stub = {
    saveToLibrary: async (doc: Parameters<typeof pipeline.saveToLibrary>[0], assets: SaveAssets): Promise<SaveReport> => {
      calls.push({ doc: { type: doc.type, meta: { source: doc.meta.source } }, assets });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { stub, calls };
}

beforeEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('环节 6 StepSave（N8＋完整性汇总＋保存链触发）', () => {
  it('version/packageVersion 双字段写草稿＋N8-semver 坏→本环节错误回显', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSave(m);
      await act(async () => {
        setNativeValue(m.container.querySelector<HTMLInputElement>('[data-save-field="version"]')!, '2.1.0');
        setNativeValue(m.container.querySelector<HTMLInputElement>('[data-save-field="packageVersion"]')!, '1.2.3');
      });
      expect(useDefinitionDraftStore.getState().draft.version).toBe('2.1.0');
      expect(useDefinitionDraftStore.getState().draft.packageVersion).toBe('1.2.3');

      await act(async () => {
        setNativeValue(m.container.querySelector<HTMLInputElement>('[data-save-field="version"]')!, 'v2');
      });
      const err = m.container.querySelector('[data-step-error][data-error-field="version"]');
      expect(err?.getAttribute('data-error-rule')).toBe('N8-semver');
    } finally {
      await unmount(m);
    }
  });

  it('完整性校验汇总：六环节各一行（✓/!＋计数）；source=manual 语义位展示', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSave(m);
      const rows = Array.from(m.container.querySelectorAll('[data-save-summary-step]')).map(
        (r) => r.getAttribute('data-save-summary-step'),
      );
      expect(rows).toEqual(['meta', 'ports', 'schema', 'script', 'inner', 'save']); // 六环节全覆盖
      expect(m.container.querySelector('[data-save-summary-step="meta"]')?.getAttribute('data-ok')).toBe('true');
      expect(m.container.querySelector('[data-save-summary-step="ports"]')?.getAttribute('data-ok')).toBe('true');
      expect(m.container.querySelector('[data-save-source]')?.getAttribute('data-save-source')).toBe('manual');
      expect(m.container.querySelector('[data-save-source]')?.textContent).toContain('manual');
    } finally {
      await unmount(m);
    }
  });

  it('汇总错误环节：名称清空→meta 行 !＋计数 1；点击错误行跳转该环节', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSave(m);
      await act(async () => {
        useDefinitionDraftStore.getState().patchMeta({ name: '' }); // 清空名称（store 面——save 页汇总实时反映）
      });
      const metaRow = m.container.querySelector('[data-save-summary-step="meta"]');
      expect(metaRow?.getAttribute('data-ok')).toBe('false');
      expect(metaRow?.textContent).toMatch(/1/); // 错误计数
      await act(async () => {
        metaRow?.querySelector<HTMLButtonElement>('[data-save-summary-goto]')?.click();
      });
      expect(useDefinitionDraftStore.getState().step).toBe('meta'); // 定位跳转
    } finally {
      await unmount(m);
    }
  });

  it('保存链未注入（生产接线随 T6-16）→保存钮 disabled＋说明；注入→点击触发 saveToLibrary（assets=当前 lang 适配）＋成功 dirty 复位', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      await atSave(m);
      const save = () => m.container.querySelector<HTMLButtonElement>('[data-testid="ne-save"]')!;
      expect(save().disabled).toBe(true); // 未装配

      // 注入保存链（mock 桩）后重开
      const { stub, calls } = pipelineFace();
      await act(async () => {
        openNodeEditor(undefined, { savePipeline: stub });
      });
      await atSave(m);
      await act(async () => {
        useDefinitionDraftStore.getState().patchScript({ lang: 'ts', ts: 'export async function run(ctx) { return {}; }' });
      });
      expect(m.container.querySelector('[data-testid="ne-dirty"]')).toBeTruthy(); // 未保存徽标在场
      await act(async () => {
        save().click();
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.doc.type).toBe('xhs.save');
      expect(calls[0]!.doc.meta.source).toBe('manual'); // §6.1f——草稿语义位（保存链再防御改写）
      expect(calls[0]!.assets).toEqual(assetsFromScriptDraft('xhs.save', useDefinitionDraftStore.getState().script));
      expect(calls[0]!.assets.scripts).toEqual({ 'scripts/xhs_save.ts': 'export async function run(ctx) { return {}; }' }); // M5 适配
      expect(m.container.querySelector('[data-testid="ne-dirty"]')).toBe(null); // markSaved——dirty 复位
      expect(m.container.querySelector('[data-save-ok]')?.textContent).toContain('已入库');
    } finally {
      await unmount(m);
    }
  });

  it('保存被拒（stepErrors）→「保存被拒」面＋不复位 dirty；保存链异常→错误面显示 message', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      const rejected = pipelineFace({ ok: false, stepErrors: { meta: [{ field: 'type', message: '撞内置', rule: 'N1-namespace' }] } });
      await act(async () => {
        openNodeEditor(undefined, { savePipeline: rejected.stub });
      });
      await atSave(m);
      await act(async () => {
        useDefinitionDraftStore.getState().patchScript({ py: 'x=1' });
      });
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-testid="ne-save"]')!.click();
      });
      expect(m.container.querySelector('[data-save-rejected]')?.textContent).toContain('保存被拒');
      expect(m.container.querySelector('[data-testid="ne-dirty"]')).toBeTruthy(); // 未保存仍在

      const failing = pipelineFace(new Error('ZIP-UNSAFE-ENTRY'));
      await act(async () => {
        openNodeEditor(undefined, { savePipeline: failing.stub });
      });
      await atSave(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-testid="ne-save"]')!.click();
      });
      expect(m.container.querySelector('[data-save-error]')?.textContent).toContain('ZIP-UNSAFE-ENTRY');
    } finally {
      await unmount(m);
    }
  });

  it('保存动作在保存中重复点击不重复触发（saving 门）', async () => {
    await act(async () => {
      openNodeEditor();
    });
    const m = await mountShell();
    try {
      let resolveSave: (r: SaveReport) => void = () => undefined;
      const calls: unknown[] = [];
      const stub = {
        saveToLibrary: () =>
          new Promise<SaveReport>((resolve) => {
            calls.push(1);
            resolveSave = resolve;
          }),
      };
      await act(async () => {
        openNodeEditor(undefined, { savePipeline: stub });
      });
      await atSave(m);
      await act(async () => {
        m.container.querySelector<HTMLButtonElement>('[data-testid="ne-save"]')!.click();
      });
      const btn = m.container.querySelector<HTMLButtonElement>('[data-testid="ne-save"]')!;
      expect(btn.disabled).toBe(true); // saving 中
      btn.click();
      btn.click();
      expect(calls).toHaveLength(1); // 不重复触发
      await act(async () => {
        resolveSave({ ok: true });
      });
      expect(m.container.querySelector('[data-save-ok]')).toBeTruthy();
      void resolveSave;
    } finally {
      await unmount(m);
    }
  });
});
