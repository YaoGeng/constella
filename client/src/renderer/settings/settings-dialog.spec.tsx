// @vitest-environment jsdom
// SettingsDialog 组件用例（T6-12；TDD-C-11 §6.1a/b/c/f＋§3 八组件行）——三开关切换即
// setSetting 即生效（settings.set op 恰一次＋分发正确）、bg=纯黑→pause+隐藏语义、dens 滑杆
// change（非 input）才 dens 重建+toast、危险区二次确认（未确认零调用/确认恰一次）＋分区导航
// 五节（V1.1 场景路由占位、V1.0 不渲染）。组件测试栈=仓库惯例（jsdom docblock＋createRoot/act）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { createStorageClient, type StorageBridge } from '../storage';
import { DEFAULT_SETTINGS, attachSettingsStorage, useSettingsStore } from './settings-store';
import { SettingsDialog } from './SettingsDialog';
import type { SettingsDispatcherDeps } from './settings-dispatcher';
import type { SkyCtlChannel } from './control-channel';
import { SKY_DENS_KEYS, SKY_LAYER_KEYS } from './settings-store';

interface SkyCall {
  kind: 'layer' | 'dens' | 'pause';
  k?: string;
  v: boolean | number;
}

function mockSky() {
  const calls: SkyCall[] = [];
  const ctl: SkyCtlChannel = {
    layer: (k, v) => calls.push({ kind: 'layer', k, v }),
    dens: (k, p) => calls.push({ kind: 'dens', k, v: p }),
    pause: (v) => calls.push({ kind: 'pause', v }),
  };
  return { calls, ctl };
}

function fakeStorage() {
  const calls: StorageInvokeReq[] = [];
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      if (req.op === 'settings.getAll') return { snap: true, edgeAnim: true, autoSave: false };
      return undefined;
    },
  };
  return { calls, client: createStorageClient(bridge) };
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

async function mountDialog(deps: Deps): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsDialog open onClose={() => {}} deps={toDispatcherDeps(deps)} />);
  });
  return { container, root };
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

function setSelect(el: HTMLSelectElement | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el?.dispatchEvent(new Event('change', { bubbles: true }));
}

async function changeSelect(el: HTMLSelectElement | null, value: string): Promise<void> {
  await act(async () => {
    setSelect(el, value);
  });
}

function setRange(el: HTMLInputElement | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
}

async function dragRange(el: HTMLInputElement | null, value: string): Promise<void> {
  // 拖动中（input 事件）：只更新数字显示，不重建（demo L2740 oninput）
  await act(async () => {
    setRange(el, value);
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function commitRange(el: HTMLInputElement | null, value: string): Promise<void> {
  // 松手提交（原生 change 事件——demo L2741 onchange）：dens 重建+toast+落盘
  await act(async () => {
    setRange(el, value);
    el?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 手写调用记录器（dispatcher spec 同款——vi.fn 泛型面仓库无先例） */
interface Recorder<A extends unknown[]> {
  calls: A[];
  fn(...args: A): void;
}

function rec<A extends unknown[]>(): Recorder<A> {
  const calls: A[] = [];
  return { calls, fn: (...args: A) => { calls.push(args); } };
}

interface Deps {
  scheduler: { schedule: Recorder<[]>; cancel: Recorder<[]> };
  toast: Recorder<[string]>;
  onAutoSaveChange: Recorder<[boolean]>;
  onBgChange: Recorder<[boolean]>;
  readDirty(): boolean;
}

function fakeDeps(): Deps {
  return {
    scheduler: { schedule: rec<[]>(), cancel: rec<[]>() },
    toast: rec<[string]>(),
    onAutoSaveChange: rec<[boolean]>(),
    onBgChange: rec<[boolean]>(),
    // T6-17 装配形：() => useFlowStore.getState().dirty——测试按「有 pending 脏」注入
    readDirty: () => true,
  };
}

/** 测试 recorder 容器 → SettingsDispatcherDeps 函数面映射 */
function toDispatcherDeps(deps: Deps): SettingsDispatcherDeps {
  return {
    scheduler: { schedule: deps.scheduler.schedule.fn, cancel: deps.scheduler.cancel.fn },
    readDirty: deps.readDirty,
    toast: deps.toast.fn,
    onAutoSaveChange: deps.onAutoSaveChange.fn,
    onBgChange: deps.onBgChange.fn,
  };
}

beforeEach(async () => {
  const { client } = fakeStorage();
  attachSettingsStorage(client);
  await useSettingsStore.getState().load();
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__skyCtl;
  delete (globalThis as unknown as Record<string, unknown>).__skyReady;
});

describe('SettingsDialog：分区导航五节（§3 SettingsDialog 行）', () => {
  it('导航五项＝交互/背景与渲染/星野元素/场景路由(V1.1)/危险区；默认展示交互节', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    const nav = m.container.querySelectorAll('[data-settings-nav]');
    expect(nav).toHaveLength(5);
    expect(Array.from(nav).map((n) => n.getAttribute('data-settings-nav'))).toEqual([
      'interaction',
      'background',
      'skyfield',
      'route',
      'danger',
    ]);
    // V1.1 占位：场景路由导航项在场但禁用（V1.0 不渲染该节）
    const route = m.container.querySelector('[data-settings-nav="route"]') as HTMLButtonElement | null;
    expect(route?.disabled).toBe(true);
    // 默认交互节在场（三开关）
    expect(m.container.querySelectorAll('[data-set]').length).toBeGreaterThanOrEqual(3);
    await unmount(m);
  });

  it('切节：星野元素节（11 开关+7 滑杆）/危险区节按需呈现', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    await click(m.container.querySelector('[data-settings-nav="skyfield"]'));
    expect(m.container.querySelectorAll(`[data-set]`).length).toBe(SKY_LAYER_KEYS.length - 1); // 11 星野开关（parallax 在背景节）
    expect(m.container.querySelectorAll('[data-dens]').length).toBe(SKY_DENS_KEYS.length);
    await click(m.container.querySelector('[data-settings-nav="danger"]'));
    expect(m.container.querySelector('[data-danger="open"]')).not.toBeNull();
    await unmount(m);
  });
});

describe('InteractionSection：三开关切换即 setSetting 即生效（§6.1a）', () => {
  it('点 snap 开关 → settings.set 恰一次（key=snap value=false）＋snap 值翻转', async () => {
    const { calls, client } = fakeStorage();
    attachSettingsStorage(client);
    await useSettingsStore.getState().load();
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    expect((m.container.querySelector('[data-set="snap"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    await click(m.container.querySelector('[data-set="snap"]'));
    const setOps = calls.filter((c) => c.op === 'settings.set');
    expect(setOps).toHaveLength(1);
    expect(setOps[0]?.op === 'settings.set' && setOps[0].args).toEqual({ key: 'snap', value: false });
    expect((m.container.querySelector('[data-set="snap"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    // snap/edgeAnim 非 sky 通道键
    expect(sky.calls).toHaveLength(0);
    await unmount(m);
  });

  it('点 autoSave 开关 → settings.set 恰一次＋徽标联动＋AutoSaveScheduler 门控（schedule）', async () => {
    const { calls, client } = fakeStorage();
    attachSettingsStorage(client);
    await useSettingsStore.getState().load();
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const deps = fakeDeps();
    const m = await mountDialog(deps);
    await click(m.container.querySelector('[data-set="autoSave"]'));
    const setOps = calls.filter((c) => c.op === 'settings.set');
    expect(setOps).toHaveLength(1);
    expect(setOps[0]?.op === 'settings.set' && setOps[0].args).toEqual({ key: 'autoSave', value: true });
    expect(deps.onAutoSaveChange.calls).toEqual([[true]]);
    expect(deps.scheduler.schedule.calls).toHaveLength(1);
    // 再点关 → cancel
    await click(m.container.querySelector('[data-set="autoSave"]'));
    expect(deps.onAutoSaveChange.calls).toEqual([[true],[false]]);
    expect(deps.scheduler.cancel.calls).toHaveLength(1);
    await unmount(m);
  });
});

describe('BackgroundSection：bg 双值＋视差（§6.1b）', () => {
  it('bg 切纯黑 → pause(true)+onBgChange(true)；切回星空 → pause(false)+onBgChange(false)', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const deps = fakeDeps();
    const m = await mountDialog(deps);
    await click(m.container.querySelector('[data-settings-nav="background"]'));
    await changeSelect(m.container.querySelector<HTMLSelectElement>('[data-bg="select"]'), 'black');
    expect(sky.calls.filter((c) => c.kind === 'pause').map((c) => c.v)).toEqual([true]);
    expect(deps.onBgChange.calls).toEqual([[true]]);
    await changeSelect(m.container.querySelector<HTMLSelectElement>('[data-bg="select"]'), 'sky');
    expect(sky.calls.filter((c) => c.kind === 'pause').map((c) => c.v)).toEqual([true, false]);
    expect(deps.onBgChange.calls).toEqual([[true],[false]]);
    await unmount(m);
  });

  it('视差开关 → layer("parallax", v)', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    await click(m.container.querySelector('[data-settings-nav="background"]'));
    await click(m.container.querySelector('[data-set="parallax"]'));
    expect(sky.calls).toContainEqual({ kind: 'layer', k: 'parallax', v: false });
    await unmount(m);
  });
});

describe('SkyFieldSection：11 开关＋7 密度滑杆（§6.1c）', () => {
  it('星野开关 → layer(k,v)；dens 滑杆 input 只显数、change 才 dens(k,v/100)+toast', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const deps = fakeDeps();
    const m = await mountDialog(deps);
    await click(m.container.querySelector('[data-settings-nav="skyfield"]'));
    await click(m.container.querySelector('[data-set="meteor"]'));
    expect(sky.calls).toContainEqual({ kind: 'layer', k: 'meteor', v: false });
    const range = m.container.querySelector<HTMLInputElement>('[data-dens="dens_stars"]');
    await dragRange(range, '40');
    expect(sky.calls.filter((c) => c.kind === 'dens')).toHaveLength(0); // 拖动中不重建
    expect(m.container.querySelector('[data-dens-value="dens_stars"]')?.textContent).toBe('40%');
    await commitRange(range, '40');
    expect(sky.calls.filter((c) => c.kind === 'dens')).toEqual([{ kind: 'dens', k: 'stars', v: 0.4 }]);
    expect(deps.toast.calls).toEqual([['星野重建中 — stars 40%']]);
    await unmount(m);
  });

  it('滑杆步进=10、区间 10–100（demo L780 属性）', async () => {
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    await click(m.container.querySelector('[data-settings-nav="skyfield"]'));
    const range = m.container.querySelector<HTMLInputElement>('[data-dens="dens_stars"]');
    expect(range?.min).toBe('10');
    expect(range?.max).toBe('100');
    expect(range?.step).toBe('10');
    await unmount(m);
  });
});

describe('DangerZoneSection：应用内二次确认（§6.2/02 §13.3 v1.0b 勘误）', () => {
  it('f) 未确认 → factoryReset op 零调用；确认 → op 恰一次', async () => {
    const { calls, client } = fakeStorage();
    attachSettingsStorage(client);
    await useSettingsStore.getState().load();
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    await click(m.container.querySelector('[data-settings-nav="danger"]'));
    // 打开确认弹窗 → 取消：零调用
    await click(m.container.querySelector('[data-danger="open"]'));
    expect(m.container.querySelector('[data-danger="confirm-dialog"]')).not.toBeNull();
    await click(m.container.querySelector('[data-danger="cancel"]'));
    expect(calls.filter((c) => c.op === 'settings.factoryReset')).toHaveLength(0);
    // 打开 → 确认：恰一次
    await click(m.container.querySelector('[data-danger="open"]'));
    await click(m.container.querySelector('[data-danger="confirm"]'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.filter((c) => c.op === 'settings.factoryReset')).toHaveLength(1);
    await unmount(m);
  });

  it('f) 确认按钮 busy 期间禁用（防双击双发）', async () => {
    let release: (() => void) | null = null;
    const calls: StorageInvokeReq[] = [];
    const bridge: StorageBridge = {
      invoke: async (req) => {
        calls.push(req);
        if (req.op === 'settings.getAll') return {};
        if (req.op === 'settings.factoryReset') {
          await new Promise<void>((r) => {
            release = r;
          });
          return undefined;
        }
        return undefined;
      },
    };
    attachSettingsStorage(createStorageClient(bridge));
    await useSettingsStore.getState().load();
    const sky = mockSky();
    (globalThis as unknown as Record<string, unknown>).__skyCtl = sky.ctl;
    const m = await mountDialog(fakeDeps());
    await click(m.container.querySelector('[data-settings-nav="danger"]'));
    await click(m.container.querySelector('[data-danger="open"]'));
    const confirm = m.container.querySelector<HTMLButtonElement>('[data-danger="confirm"]');
    await click(confirm);
    expect(confirm?.disabled).toBe(true);
    await click(confirm); // busy 双击
    // release 经 bridge 闭包赋值（TS 流分析不可见）——as 断言还原声明类型
    (release as (() => void) | null)?.();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls.filter((c) => c.op === 'settings.factoryReset')).toHaveLength(1);
    await unmount(m);
  });
});

describe('open=false → 不渲染（应用壳 navSettings 入口受控）', () => {
  it('open=false 时零 DOM', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsDialog open={false} onClose={() => {}} deps={toDispatcherDeps(fakeDeps())} />);
    });
    expect(container.querySelector('[data-settings="dialog"]')).toBeNull();
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});
