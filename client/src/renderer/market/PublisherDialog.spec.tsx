// @vitest-environment jsdom
// PublisherDialog 用例（T5-11 / TDD-C-09 §3 Publisher 行——demo L826-841/L2902-2913 参照非权威）。
//
// 覆盖：二选一类型切换；类型勾选（1=node/≥2=pack kind 推导经 publish 断言）；整条预览
// （流程名·N 节点·M 连线）；perms 实时推导（仅内置勾选→「无特殊权限」§6.4）；名称建议
// 未聚焦才覆盖（聚焦输入不被抢）；name>24/summary>40/空勾选前端拦截（零 publish 外发）；
// 提交成功关弹窗（toast 在编排内——publisher.spec 断言）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { FlowDoc, FlowListItem } from '@constella/shared/ipc';
import type { PermLabel } from '@constella/shared/dto';
import { PublisherDialog, type PublisherTypeOption } from './PublisherDialog';
import type { PublishOutcome, PublishSource } from './publisher';

const TYPES: PublisherTypeOption[] = [
  { type: 'trigger.manual', name: '手动触发', category: '触发', kind: 'builtin' },
  { type: 'xhs.search', name: '小红书搜索', category: '社媒', kind: 'custom' },
  { type: 'file.write', name: '写文件', category: '数据', kind: 'custom' },
];

const FLOWS: FlowListItem[] = [
  { id: 'f1', name: '采集流程', orderIdx: 0, createdAt: 1, updatedAt: 2 },
  { id: 'f2', name: '空流程', orderIdx: 1, createdAt: 1, updatedAt: 2 },
];

const FLOW_DOC: FlowDoc = {
  id: 'f1',
  name: '采集流程',
  nodes: [
    { id: 'n1', type: 'trigger.manual', name: '手动触发', position: { x: 0, y: 0 }, params: {} },
    { id: 'n2', type: 'xhs.search', name: '小红书搜索', position: { x: 1, y: 0 }, params: {} },
  ],
  edges: [{ id: 'e1', from: ['n1', 'out'], to: ['n2', 'in'] }],
};

/** C-05 PermDeriver 同源 stub（builtin 不计/类目映射/首现序——perm-deriver.ts 同表） */
const derivePerms = (types: readonly string[]): PermLabel[] => {
  const CAT: Record<string, PermLabel> = { CDP: 'CDP', 网络: '网络', 数据: '文件', AI: 'AI', 交互: '交互', 社媒: '社媒' };
  const out: PermLabel[] = [];
  for (const t of types) {
    const opt = TYPES.find((x) => x.type === t);
    if (opt === undefined || opt.kind === 'builtin') continue;
    const label = CAT[opt.category];
    if (label !== undefined && !out.includes(label)) out.push(label);
  }
  return out;
};

interface Mounted {
  container: HTMLDivElement;
  root: Root;
  publish: ReturnType<typeof vi.fn>;
}

async function mountDialog(): Promise<Mounted> {
  const publish = vi.fn(
    async (): Promise<PublishOutcome> => ({
      packageId: 'p',
      status: 'pending',
      perms: [],
      checksum: 'c',
    }),
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <PublisherDialog
        listTypes={async () => TYPES}
        listFlows={async () => ({ items: FLOWS })}
        getFlow={async (id) => (id === 'f1' ? FLOW_DOC : { ...FLOW_DOC, id, name: '空流程', nodes: [], edges: [] })}
        derivePerms={derivePerms}
        publish={publish}
        onClose={() => {}}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { container, root, publish };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

async function click(el: Element | null): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 勾选框交互（受控 checkbox——jsdom 下 React onChange 经 click 激活行为触发：toggle＋冒泡） */
async function check(el: HTMLInputElement | null | undefined): Promise<void> {
  await act(async () => {
    el?.click();
  });
}

function setInput(el: HTMLInputElement | null, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el?.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PublisherDialog——类型/勾选/整条预览（demo L826-841）', () => {
  it('node 模式勾选清单渲染；单勾选→kind=node（名称建议=类型名）', async () => {
    const m = await mountDialog();
    const boxes = [...m.container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]')];
    expect(boxes).toHaveLength(3);
    await check(boxes[1]); // xhs.search
    await click(m.container.querySelector('[data-publisher="submit"]'));
    expect(m.publish).toHaveBeenCalledTimes(1);
    expect(m.publish.mock.calls[0]![1]).toEqual({ types: ['xhs.search'] });
    expect((m.publish.mock.calls[0]![0] as { name: string }).name).toBe('小红书搜索'); // 名称建议=类型名
    await unmount(m);
  });

  it('多勾选→pack（建议「N 个精选节点」——X-01 manifest kind 规则）', async () => {
    const m = await mountDialog();
    const boxes = m.container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]');
    await check(boxes[1]);
    await check(boxes[2]);
    await click(m.container.querySelector('[data-publisher="submit"]'));
    const call = m.publish.mock.calls[0]!;
    expect(call[1]).toEqual({ types: ['xhs.search', 'file.write'] });
    expect((call[0] as { name: string }).name).toBe('2 个精选节点');
    expect(call[0]).toMatchObject({ summary: '' });
    await unmount(m);
  });

  it('flow 模式：整条预览（N 节点·M 连线）；publish source={flowId}', async () => {
    const m = await mountDialog();
    await click(m.container.querySelector('[data-publisher="type-flow"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.container.querySelector('[data-publisher="flow-preview"]')?.textContent).toContain('2 节点 · 1 连线');
    await click(m.container.querySelector('[data-publisher="submit"]'));
    expect(m.publish.mock.calls[0]![1]).toEqual({ flowId: 'f1' });
    expect((m.publish.mock.calls[0]![0] as { name: string }).name).toBe('采集流程'); // 建议=流程名
    await unmount(m);
  });

  it('空流程提交拦截（零 publish 外发）', async () => {
    const m = await mountDialog();
    await click(m.container.querySelector('[data-publisher="type-flow"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const select = m.container.querySelector<HTMLSelectElement>('[data-publisher="flow-select"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, 'f2');
    select?.dispatchEvent(new Event('change', { bubbles: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await click(m.container.querySelector('[data-publisher="submit"]'));
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.container.querySelector('[data-publisher="error"]')?.textContent).toContain('当前流程没有节点可发布');
    await unmount(m);
  });
});

describe('PublisherDialog——perms 实时推导＋名称建议（demo L2875-2880/L2902-2913）', () => {
  it('仅内置类型勾选→「无特殊权限」；自研勾选→类目标签实时呈现', async () => {
    const m = await mountDialog();
    const boxes = m.container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]');
    await check(boxes[0]); // trigger.manual（builtin）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.container.querySelector('[data-publisher="perm-none"]')?.textContent).toBe('无特殊权限');
    await check(boxes[1]); // xhs.search（社媒）
    await check(boxes[2]); // file.write（数据→文件）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const perms = [...m.container.querySelectorAll('[data-publisher="perm"]')].map((e) => e.textContent);
    expect(perms).toEqual(['社媒', '文件']);
    await unmount(m);
  });

  it('名称建议未聚焦才覆盖：聚焦自定义输入后改勾选不抢输入；未聚焦时勾选变化即覆盖', async () => {
    const m = await mountDialog();
    const nameEl = m.container.querySelector<HTMLInputElement>('[data-publisher="name"]');
    const boxes = m.container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]');

    // 聚焦＋自定义输入（jsdom 原生 focus——触发 focusin，React onFocus 对端）
    await act(async () => {
      nameEl?.focus();
    });
    setInput(nameEl, '我的定制包名');
    await check(boxes[1]); // 勾选变化——不覆盖（聚焦中）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(nameEl?.value).toBe('我的定制包名');

    // 失焦后新的勾选变化→覆盖为建议值（jsdom 原生 blur）
    await act(async () => {
      nameEl?.blur();
    });
    await check(boxes[2]); // 2 类型→「2 个精选节点」
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(nameEl?.value).toBe('2 个精选节点');
    await unmount(m);
  });
});

describe('PublisherDialog——前端拦截（§6.4：零外发）', () => {
  it('空勾选提交→错误提示、publish 零调用', async () => {
    const m = await mountDialog();
    // 有名无勾选——命中勾选拦截（空名时名称错误先报，名称校验在 publisher.spec 纯逻辑段覆盖）
    const nameEl = m.container.querySelector<HTMLInputElement>('[data-publisher="name"]');
    await act(async () => {
      nameEl?.focus();
    });
    setInput(nameEl, '未勾选包');
    await click(m.container.querySelector('[data-publisher="submit"]'));
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.container.querySelector('[data-publisher="error"]')?.textContent).toBe('先勾选要发布的节点类型');
    await unmount(m);
  });

  it('name 超限（input maxLength 物理拦截＋校验兜底）——summary 超 40 由校验兜底', async () => {
    const m = await mountDialog();
    expect(m.container.querySelector<HTMLInputElement>('[data-publisher="name"]')?.maxLength).toBe(24);
    expect(m.container.querySelector<HTMLInputElement>('[data-publisher="summary"]')?.maxLength).toBe(40);
    // 兜底路径：直接绕过 maxLength 设值（校验层拦截——validatePublishForm）
    const nameEl = m.container.querySelector<HTMLInputElement>('[data-publisher="name"]');
    await act(async () => {
      nameEl?.focus();
    });
    setInput(nameEl, 'x'.repeat(25)); // IDL setter 不走用户输入约束——模拟底层超限值
    const boxes = m.container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]');
    await check(boxes[1]);
    await click(m.container.querySelector('[data-publisher="submit"]'));
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.container.querySelector('[data-publisher="error"]')?.textContent).toBe('名称不能超过 24 字');
    await unmount(m);
  });

  it('提交成功→onClose 关弹窗', async () => {
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <PublisherDialog
          listTypes={async () => TYPES}
          listFlows={async () => ({ items: FLOWS })}
          getFlow={async () => FLOW_DOC}
          derivePerms={derivePerms}
          publish={async () => ({ packageId: 'p', status: 'pending' as const, perms: [], checksum: 'c' })}
          onClose={onClose}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const boxes = container.querySelectorAll<HTMLInputElement>('[data-publisher="type-check"]');
    await check(boxes[1]);
    await click(container.querySelector('[data-publisher="submit"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});
