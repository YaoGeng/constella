// @vitest-environment jsdom
// HitCardView 套件（T5-05；TDD-C-07 §3 HitCardView 行＋§1 resolveHitCard 接口段＋§6.8 验收；
// 01 A-7.1（PRD-A7-01 GWT）＋X-12（数据块列表分块）为语义锚；demo L1971-1989/L1992-2013=形态源）。
//
// 断言面（§6.8）：
//   hit 推送→数据块列表分块渲染（X-12：数组=逐项分行；非数组=整块 JSON）＋多选 chip；
//   确认→merge 调用（chatJson 携 input/picks/extra＋canonicalKeys 白名单——T5-01 交付面）→
//   resumeHit(confirm,merged)；跳过→resumeHit(skip) 原始 input 直发（01 A-7.1——chatJson 零调用）。
//   LLM 失败分支：锚未冻结兜底口径（§6.8/01 A-7.1/02 §10 均未提及）——本套件锁定「错误上卡、
//   卡保持可操作（跳过仍可放行）、不自动 resumeHit」的实现口径，待评审收口（⚠ 见任务报告⑥）。
//
// 组件测试栈=仓库惯例（T4-06 cdp-dock.spec 先例）：jsdom docblock 局部环境＋createRoot/act＋
// container.querySelector 断言（项目无 testing-library——不引新依赖红线）。
// 注入面 mock：llm=fake chatJson（记录 req/opts）；resumeHit=spy 数组——P-3 边界，组件零 run/ import。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { LlmChatRequest, LlmJsonOptions } from './llm-gateway';
import {
  HitCardView,
  resolveHitCard,
  type HitCardData,
  type HitResolverDeps,
} from './hit-card-view';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

const HIT: HitCardData = {
  hitId: 'hit-1',
  runId: 'run-9',
  runName: 'JD 筛选流程',
  nodeId: 'n4',
  nodeName: '人工确认 JD',
  icon: '🙋',
  question: '请勾选筛选项',
  options: ['985 院校', '硕士及以上', '3-5 年经验'],
  input: { 职位: '自动驾驶感知算法工程师', 薪资: '25-40K · 16薪' },
};

/** X-12 列表形态上游输出（MA-2 名单确认剧本形） */
const LIST_INPUT = [
  { name: '张三', match: true },
  { name: '李四', match: false },
  { name: '王五', match: true },
];

/** merge 产物样本（{jd,filters,notes} 形态——01 L418/demo L1881） */
const MERGED = { jd: HIT.input, filters: ['985 院校', '3-5 年经验'], notes: '不要外包' };

interface FakeLlm {
  calls: Array<{ req: LlmChatRequest; opts?: LlmJsonOptions }>;
  llm: HitResolverDeps['llm'];
}

/** fake chatJson（注入面 seam——T5-01 LlmGateway 接口，不建真网关；泛型签名经 cast——运行时恒返 result） */
function fakeLlm(result: unknown = MERGED): FakeLlm {
  const calls: FakeLlm['calls'] = [];
  const chatJson = vi.fn(async (req: LlmChatRequest, opts?: LlmJsonOptions) => {
    calls.push({ req, opts });
    return result;
  });
  return {
    calls,
    llm: { chatJson: chatJson as unknown as HitResolverDeps['llm']['chatJson'] },
  };
}

/** resumeHit spy（C-03 RunEngine.resumeHit 注入形——hitId＋决策） */
function fakeResume(): { resumeHit: HitResolverDeps['resumeHit']; calls: Array<{ hitId: string; d: unknown }> } {
  const calls: Array<{ hitId: string; d: unknown }> = [];
  return {
    calls,
    resumeHit: (hitId, d) => {
      calls.push({ hitId, d });
    },
  };
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

/** 挂载（onResolve=resolveHitCard 编排——装配点同形接线） */
async function mountCard(hit: HitCardData = HIT, llmResult: unknown = MERGED): Promise<{
  m: Mounted;
  llm: FakeLlm;
  resume: ReturnType<typeof fakeResume>;
}> {
  const llm = fakeLlm(llmResult);
  const resume = fakeResume();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HitCardView hit={hit} onResolve={(h, action) => resolveHitCard({ llm: llm.llm, resumeHit: resume.resumeHit }, h, action)} />,
    );
  });
  return { m: { container, root }, llm, resume };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function setInput(el: HTMLInputElement | null | undefined, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 微任务冲刷（confirm 异步链：chatJson await→resumeHit→setResult） */
async function flush(): Promise<void> {
  await act(async () => {});
}

// ————————————————————————————————————————————
// §6.8 hit 推送 → 渲染
// ————————————————————————————————————————————

describe('HitCardView hit 推送渲染（§6.8 分块/多选 chip 形态）', () => {
  it('hit 数组输入 → 数据块 X-12 列表分块逐项分行；头/问题/chip/补充输入/跳过·确认动作齐全', async () => {
    const { m } = await mountCard({ ...HIT, input: LIST_INPUT });
    const c = m.container;
    // 头：icon/节点名/run 名 · #hitId（demo L1980）
    expect(c.querySelector('[data-hit="icon"]')?.textContent).toBe('🙋');
    expect(c.querySelector('[data-hit="name"]')?.textContent).toBe('人工确认 JD');
    expect(c.querySelector('[data-hit="hid"]')?.textContent).toBe('JD 筛选流程 · #hit-1');
    // 问题（demo L1981）
    expect(c.querySelector('[data-hit="q"]')?.textContent).toBe('请勾选筛选项');
    // X-12：数组 → 逐项分行（3 行，各行含该项内容）
    const rows = c.querySelectorAll('[data-hit-data-row]');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('张三');
    expect(rows[1]?.textContent).toContain('李四');
    expect(rows[2]?.textContent).toContain('王五');
    // 选项 chip 3 枚＋补充输入＋两动作（demo L1983-1987）
    expect(c.querySelectorAll('[data-hit-chip]')).toHaveLength(3);
    expect(c.querySelector<HTMLInputElement>('[data-hit="extra"]')?.placeholder).toBe('补充要求…（可选）');
    expect(c.querySelector('[data-hit-action="skip"]')?.textContent).toBe('跳过');
    expect(c.querySelector('[data-hit-action="send"]')?.textContent).toBe('确认并发送');
    expect(c.querySelector('[data-hit-card="hit-1"]')?.getAttribute('data-hit-state')).toBe('open');
    await unmount(m);
  });

  it('hit 非数组输入 → 数据块整块 JSON（无分行）', async () => {
    const { m } = await mountCard();
    expect(m.container.querySelectorAll('[data-hit-data-row]')).toHaveLength(0);
    expect(m.container.querySelector('[data-hit="data"]')?.textContent).toContain('自动驾驶感知算法工程师');
    await unmount(m);
  });

  it('hit 多选 chip：两项可同时选中，再点其一取消（demo L2006 toggle）', async () => {
    const { m } = await mountCard();
    const chips = m.container.querySelectorAll('[data-hit-chip]');
    await click(chips[0]);
    await click(chips[2]);
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false');
    await click(chips[0]);
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(chips[2]?.getAttribute('aria-pressed')).toBe('true');
    await unmount(m);
  });
});

// ————————————————————————————————————————————
// §6.8 确认 → merge → resumeHit(confirm, merged)
// ————————————————————————————————————————————

describe('HitCardView hit 确认→merge→resumeHit(confirm,merged)（§6.8）', () => {
  it('勾 2 项＋补充 → chatJson 一次（input/picks/extra＋canonicalKeys 白名单）→ resumeHit(confirm,merged)→卡 done＋禁用', async () => {
    const { m, llm, resume } = await mountCard();
    const chips = m.container.querySelectorAll('[data-hit-chip]');
    await click(chips[0]);
    await click(chips[2]);
    await setInput(m.container.querySelector<HTMLInputElement>('[data-hit="extra"]'), '不要外包');
    await click(m.container.querySelector('[data-hit-action="send"]'));
    await flush();
    // merge 走 chatJson 恰一次：user 消息携 input/picks（选项序=DOM 序）/extra；system 消息声明三键形态
    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call.req.messages[1]?.content).toBe(JSON.stringify({ input: HIT.input, picks: ['985 院校', '3-5 年经验'], extra: '不要外包' }));
    const sys = call.req.messages[0]?.content ?? '';
    for (const key of ['jd', 'filters', 'notes']) expect(sys).toContain(key);
    // canonicalKeys 白名单（T5-01 交付面要求）
    expect(call.opts?.canonicalKeys).toEqual(['jd', 'filters', 'notes']);
    // resumeHit(confirm, merged)
    expect(resume.calls).toEqual([{ hitId: 'hit-1', d: { kind: 'confirm', merged: MERGED } }]);
    // 卡 done＋结果标签（demo L2000 形）＋控件禁用（demo L1996）
    expect(m.container.querySelector('[data-hit-card="hit-1"]')?.getAttribute('data-hit-state')).toBe('done');
    expect(m.container.querySelector('[data-hit="result"]')?.textContent).toBe('已选 2 项 + 补充');
    expect((m.container.querySelector('[data-hit-action="send"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((m.container.querySelector('[data-hit-action="skip"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(m.container.querySelector<HTMLInputElement>('[data-hit="extra"]')?.disabled).toBe(true);
    await unmount(m);
  });

  it('hit 无补充 → 结果标签「已选 1 项」（无「+ 补充」尾缀；demo L2000）', async () => {
    const { m } = await mountCard();
    await click(m.container.querySelectorAll('[data-hit-chip]')[1]);
    await click(m.container.querySelector('[data-hit-action="send"]'));
    await flush();
    expect(m.container.querySelector('[data-hit="result"]')?.textContent).toBe('已选 1 项');
    await unmount(m);
  });
});

// ————————————————————————————————————————————
// §6.8/01 A-7.1 跳过 → resumeHit(skip)
// ————————————————————————————————————————————

describe('HitCardView hit 跳过→resumeHit(skip) 原始 input 直发（01 A-7.1）', () => {
  it('跳过 → chatJson 零调用＋resumeHit(skip)＋卡 done「已跳过 — 原始数据直接下发」＋禁用', async () => {
    const { m, llm, resume } = await mountCard();
    await click(m.container.querySelector('[data-hit-action="skip"]'));
    await flush();
    // 跳过不经 LLM（01 A-7.1：原始 input 直发）
    expect(llm.calls).toHaveLength(0);
    expect(resume.calls).toEqual([{ hitId: 'hit-1', d: { kind: 'skip' } }]);
    expect(m.container.querySelector('[data-hit-card="hit-1"]')?.getAttribute('data-hit-state')).toBe('done');
    expect(m.container.querySelector('[data-hit="result"]')?.textContent).toBe('已跳过 — 原始数据直接下发');
    expect((m.container.querySelector('[data-hit-action="send"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    await unmount(m);
  });
});

// ————————————————————————————————————————————
// LLM 失败分支（⚠ 兜底口径未冻结——锁定实现口径，待评审）
// ————————————————————————————————————————————

describe('HitCardView hit LLM 失败（⚠ 口径：错误上卡、保持可操作、不自动 resumeHit）', () => {
  it('chatJson 抛错 → resumeHit 零调用＋错误上卡＋卡保持 open → 跳过仍可放行', async () => {
    const llm = fakeLlm();
    llm.llm.chatJson = vi.fn(async () => {
      throw new Error('LLM 端点不可达：mock');
    });
    const resume = fakeResume();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onResolve = (h: HitCardData, action: Parameters<typeof resolveHitCard>[2]) =>
      resolveHitCard({ llm: llm.llm, resumeHit: resume.resumeHit }, h, action);
    await act(async () => {
      root.render(<HitCardView hit={HIT} onResolve={onResolve} />);
    });
    const m = { container, root };
    await click(m.container.querySelector('[data-hit-action="send"]'));
    await flush();
    // 失败：不自动 resumeHit、错误上卡、卡保持可操作
    expect(resume.calls).toHaveLength(0);
    expect(m.container.querySelector('[data-hit="error"]')?.textContent).toContain('LLM 端点不可达');
    expect(m.container.querySelector('[data-hit-card="hit-1"]')?.getAttribute('data-hit-state')).toBe('open');
    expect((m.container.querySelector('[data-hit-action="send"]') as HTMLButtonElement | null)?.disabled).toBe(false);
    // 跳过=逃生通道：仍可 resumeHit(skip) 收口
    await click(m.container.querySelector('[data-hit-action="skip"]'));
    await flush();
    expect(resume.calls).toEqual([{ hitId: 'hit-1', d: { kind: 'skip' } }]);
    expect(m.container.querySelector('[data-hit-card="hit-1"]')?.getAttribute('data-hit-state')).toBe('done');
    await unmount(m);
  });
});
