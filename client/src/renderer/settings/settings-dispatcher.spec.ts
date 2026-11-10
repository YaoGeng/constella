// SettingsDispatcher 用例（T6-12；TDD-C-11 §6.1a~d）——applySetting 分发（星野 12 键→
// __skyCtl.layer；dens→dens(k,v/100)＋toast；bg→pause+隐藏语义；autoSave→徽标联动+
// AutoSaveScheduler schedule/cancel 门控）＋ __skyReady 回放两加载序恰一次（demo L2695-2727）。
// window.__skyCtl 在测试中 mock（§6.1 前置——sky 本体归 C-12/T6-13，通道形=demo L4761-4776）。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { createStorageClient, type StorageBridge } from '../storage';
import { DEFAULT_SETTINGS, attachSettingsStorage, useSettingsStore } from './settings-store';
import { createSettingsDispatcher } from './settings-dispatcher';
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

function mountSky(ctl: SkyCtlChannel | null): void {
  const w = globalThis as unknown as Record<string, unknown>;
  if (ctl === null) delete w.__skyCtl;
  else w.__skyCtl = ctl;
}

function clearSkyReady(): void {
  delete (globalThis as unknown as Record<string, unknown>).__skyReady;
}

function fakeStorageClient() {
  const calls: StorageInvokeReq[] = [];
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      if (req.op === 'settings.getAll') return {};
      return undefined;
    },
  };
  return { calls, client: createStorageClient(bridge) };
}

/** 手写调用记录器（vi.fn 泛型面与仓库无先例——fake bridge 手写数组记录同风格） */
interface Recorder<A extends unknown[]> {
  calls: A[];
  fn(...args: A): void;
}

function rec<A extends unknown[]>(): Recorder<A> {
  const calls: A[] = [];
  return { calls, fn: (...args: A) => { calls.push(args); } };
}

interface Harness {
  dispatcher: ReturnType<typeof createSettingsDispatcher>;
  sky: ReturnType<typeof mockSky>;
  scheduler: { schedule: Recorder<[]>; cancel: Recorder<[]> };
  toast: Recorder<[string]>;
  onAutoSaveChange: Recorder<[boolean]>;
  onBgChange: Recorder<[boolean]>;
  readDirty: { value: boolean };
}

function harness(over: Partial<Parameters<typeof createSettingsDispatcher>[0]> = {}): Harness {
  const sky = mockSky();
  mountSky(sky.ctl);
  const scheduler = { schedule: rec<[]>(), cancel: rec<[]>() };
  const toast = rec<[string]>();
  const onAutoSaveChange = rec<[boolean]>();
  const onBgChange = rec<[boolean]>();
  const readDirty = { value: true };
  const dispatcher = createSettingsDispatcher({
    scheduler: { schedule: scheduler.schedule.fn, cancel: scheduler.cancel.fn },
    readDirty: () => readDirty.value,
    toast: toast.fn,
    onAutoSaveChange: onAutoSaveChange.fn,
    onBgChange: onBgChange.fn,
    ...over,
  });
  return { dispatcher, sky, scheduler, toast, onAutoSaveChange, onBgChange, readDirty };
}

beforeEach(() => {
  attachSettingsStorage(null);
  useSettingsStore.setState({ values: DEFAULT_SETTINGS, loaded: false });
  clearSkyReady();
  mountSky(null);
});

afterEach(() => {
  clearSkyReady();
  mountSky(null);
  vi.restoreAllMocks();
});

describe('applySetting 分发（§6.1a/b/c）', () => {
  it('a) 星野 12 键 → layer(k,v) 恰一次（含 parallax 视差）', () => {
    const h = harness();
    for (const k of SKY_LAYER_KEYS) {
      h.dispatcher.setSetting(k, false);
    }
    const layerCalls = h.sky.calls.filter((c) => c.kind === 'layer');
    expect(layerCalls).toHaveLength(SKY_LAYER_KEYS.length);
    expect(layerCalls.every((c) => c.v === false)).toBe(true);
    expect(h.sky.calls.some((c) => c.kind === 'dens')).toBe(false);
  });

  it('a) snap/edgeAnim → sky 通道零调用（C-01 侧订阅 settingsStore 拉取，非通道下发）', () => {
    const h = harness();
    h.dispatcher.setSetting('snap', false);
    h.dispatcher.setSetting('edgeAnim', false);
    expect(h.sky.calls).toHaveLength(0);
  });

  it('a) autoSave 开 → 徽标联动+scheduler.schedule（dirty 时补排）；关 → 徽标联动+scheduler.cancel', () => {
    const h = harness();
    h.readDirty.value = true;
    h.dispatcher.setSetting('autoSave', true);
    expect(h.onAutoSaveChange.calls).toEqual([[true]]);
    expect(h.scheduler.schedule.calls).toHaveLength(1);
    h.dispatcher.setSetting('autoSave', false);
    expect(h.onAutoSaveChange.calls).toEqual([[true],[false]]);
    expect(h.scheduler.cancel.calls).toHaveLength(1);
    expect(h.scheduler.schedule.calls).toHaveLength(1);
  });

  it('a) autoSave 开但无 dirty → 不补排（demo L2702：if(autoSave&&dirty) 才 schedule）', () => {
    const h = harness();
    h.readDirty.value = false;
    h.dispatcher.setSetting('autoSave', true);
    expect(h.onAutoSaveChange.calls).toEqual([[true]]);
    expect(h.scheduler.schedule.calls).toHaveLength(0);
  });

  it('a) 三开关切换 → settings.set op 恰一次（每次切换一条）', () => {
    const { calls, client } = fakeStorageClient();
    attachSettingsStorage(client);
    const h = harness({ scheduler: null });
    h.dispatcher.setSetting('snap', false);
    h.dispatcher.setSetting('edgeAnim', false);
    h.dispatcher.setSetting('autoSave', true);
    const setOps = calls.filter((c) => c.op === 'settings.set');
    expect(setOps).toHaveLength(3);
    expect(setOps.map((c) => (c.op === 'settings.set' ? c.args.key : null))).toEqual([
      'snap',
      'edgeAnim',
      'autoSave',
    ]);
  });

  it('b) bg=纯黑 → pause(true)+onBgChange(true)（canvas/暗角隐藏语义留位）；切回星空 → pause(false)+onBgChange(false)', () => {
    const h = harness();
    h.dispatcher.setSetting('bg', 'black');
    expect(h.sky.calls.filter((c) => c.kind === 'pause').map((c) => c.v)).toEqual([true]);
    expect(h.onBgChange.calls).toEqual([[true]]);
    h.dispatcher.setSetting('bg', 'sky');
    expect(h.sky.calls.filter((c) => c.kind === 'pause').map((c) => c.v)).toEqual([true, false]);
    expect(h.onBgChange.calls).toEqual([[true],[false]]);
  });

  it('c) dens 滑杆 → dens(k, v/100) + 「星野重建中」toast', () => {
    const h = harness();
    h.dispatcher.setSetting('dens_stars', 40);
    expect(h.sky.calls).toContainEqual({ kind: 'dens', k: 'stars', v: 0.4 });
    expect(h.toast.calls).toEqual([['星野重建中 — stars 40%']]);
    h.dispatcher.setSetting('dens_gas', 100);
    expect(h.sky.calls).toContainEqual({ kind: 'dens', k: 'gas', v: 1 });
    expect(h.toast.calls).toEqual([['星野重建中 — stars 40%'],['星野重建中 — gas 100%']]);
    expect(h.sky.calls.filter((c) => c.kind === 'layer')).toHaveLength(0);
  });

  it('sky 通道不存在（T6-13 未挂载）→ 分发不抛、toast 仍发（bg/层键静默跳过）', () => {
    mountSky(null);
    const dispatcher = createSettingsDispatcher({ toast: rec<[string]>().fn });
    expect(() => {
      dispatcher.setSetting('disk', false);
      dispatcher.setSetting('bg', 'black');
      dispatcher.setSetting('dens_stars', 40);
    }).not.toThrow();
  });
});

describe('replayAll 全量回放（§6.1d——demo L2719-2727）', () => {
  it('全量下发：bg pause + 12 层键 layer + 7 密度 dens（v/100）', () => {
    const h = harness();
    useSettingsStore.setState((s) => ({
      values: { ...s.values, bg: 'black', dens_stars: 40, disk: false, parallax: false },
    }));
    h.dispatcher.replayAll();
    const layers = h.sky.calls.filter((c) => c.kind === 'layer');
    const dens = h.sky.calls.filter((c) => c.kind === 'dens');
    const pauses = h.sky.calls.filter((c) => c.kind === 'pause');
    expect(layers).toHaveLength(SKY_LAYER_KEYS.length);
    expect(dens).toHaveLength(SKY_DENS_KEYS.length);
    expect(pauses.map((c) => c.v)).toEqual([true]);
    expect(layers.find((c) => c.k === 'disk')?.v).toBe(false);
    expect(layers.find((c) => c.k === 'parallax')?.v).toBe(false);
    expect(dens.find((c) => c.k === 'stars')?.v).toBe(0.4);
    expect(dens.find((c) => c.k === 'gas')?.v).toBe(1);
    // 回放路径不发 toast（重建提示属用户主动变更，非启动回放）
    expect(h.toast.calls).toHaveLength(0);
  });
});

describe('__skyReady 回放注册（§6.1d——两加载序恰一次）', () => {
  it('加载序 A：renderer 先挂回调、sky 后就绪 → __skyReady() 全量恰一次下发；重复回调不重复', () => {
    const h = harness();
    mountSky(null); // sky 未就绪
    const uninstall = h.dispatcher.install();
    expect(h.sky.calls).toHaveLength(0); // 未就绪前零下发
    // sky 就绪：暴露 __skyCtl 并调用 renderer 预挂的 __skyReady（demo L4761-4776）
    mountSky(h.sky.ctl);
    const ready = (globalThis as unknown as Record<string, unknown>).__skyReady as () => void;
    expect(typeof ready).toBe('function');
    ready();
    const layers = h.sky.calls.filter((c) => c.kind === 'layer');
    const dens = h.sky.calls.filter((c) => c.kind === 'dens');
    expect(layers).toHaveLength(SKY_LAYER_KEYS.length);
    expect(dens).toHaveLength(SKY_DENS_KEYS.length);
    expect(h.sky.calls.filter((c) => c.kind === 'pause')).toHaveLength(1);
    // 恰一次：sky 侧再触发（重复回调）不重复全量
    ready();
    expect(h.sky.calls.filter((c) => c.kind === 'layer')).toHaveLength(SKY_LAYER_KEYS.length);
    uninstall();
    expect((globalThis as unknown as Record<string, unknown>).__skyReady).toBeUndefined();
  });

  it('加载序 B：sky 先就绪（__skyCtl 已在）→ install 即全量恰一次；此后回调不再下发', () => {
    const h = harness();
    const uninstall = h.dispatcher.install();
    expect(h.sky.calls.filter((c) => c.kind === 'layer')).toHaveLength(SKY_LAYER_KEYS.length);
    expect(h.sky.calls.filter((c) => c.kind === 'dens')).toHaveLength(SKY_DENS_KEYS.length);
    // sky 后加载重复触发 __skyReady（异常序）→ 幂等不重复
    const ready = (globalThis as unknown as Record<string, unknown>).__skyReady as () => void;
    ready();
    expect(h.sky.calls.filter((c) => c.kind === 'layer')).toHaveLength(SKY_LAYER_KEYS.length);
    uninstall();
  });
});
