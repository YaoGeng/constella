// settingsStore 用例（T6-12；TDD-C-11 §6.1e＋§1 接口）——启动 getAll 装载+缺省合并
// （缺省键取 §1 默认值：snap=on/edgeAnim=on/autoSave=off/bg='sky'/11 层全 on/7 密度=100）、
// 写入即 settings.set op、危险区 factoryReset op 发起；未 attach storage 的 e2e 路径
// （#e2e 无 storage 默认值——index.tsx 装配依赖）。通道 handler 归 C-M1——注入式 bridge mock
// （renderer.storage.spec.ts 同款）。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { createStorageClient, type StorageBridge } from '../storage';
import {
  DEFAULT_SETTINGS,
  attachSettingsStorage,
  useSettingsStore,
} from './settings-store';

function fakeStorage(overrides: Record<string, unknown> = {}) {
  const calls: StorageInvokeReq[] = [];
  const store = new Map<string, unknown>(Object.entries(overrides));
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      if (req.op === 'settings.getAll') return Object.fromEntries(store);
      if (req.op === 'settings.set') {
        store.set(req.args.key, req.args.value);
        return undefined;
      }
      if (req.op === 'settings.factoryReset') {
        store.clear();
        return undefined;
      }
      throw new Error(`mock bridge 未注册 op：${req.op}`);
    },
  };
  return { calls, store, client: createStorageClient(bridge) };
}

beforeEach(() => {
  // store 模块单例重置（flow-store.test 同款惯例）＋卸载 storage 注入
  attachSettingsStorage(null);
  useSettingsStore.setState({ values: DEFAULT_SETTINGS, loaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settingsStore：启动装载+缺省合并（§6.1e）', () => {
  it('getAll 返回部分键 → 与 §1 默认值合并：已有键覆盖、缺省键取默认', async () => {
    const { client } = fakeStorage({ snap: false, dens_stars: 40, bg: 'black' });
    attachSettingsStorage(client);
    await useSettingsStore.getState().load();
    const v = useSettingsStore.getState().values;
    // 已有键覆盖
    expect(v.snap).toBe(false);
    expect(v.dens_stars).toBe(40);
    expect(v.bg).toBe('black');
    // 缺省键取 §1 默认（demo L1071-1073 同源）
    expect(v.edgeAnim).toBe(true);
    expect(v.autoSave).toBe(false);
    expect(v.parallax).toBe(true);
    expect(v.disk && v.minis && v.mega && v.gas && v.clusters).toBe(true);
    expect(v.heroes && v.stars && v.band && v.pulse && v.meteor && v.sat).toBe(true);
    expect(v.dens_band).toBe(100);
    expect(v.dens_gas).toBe(100);
    // 非 UI 引用键默认形（X-01：ai/market.baseUrl V1.0 空、ai.route V1.1 空配置）
    expect(v.ai).toEqual({ baseUrl: '', apiKeyRef: '' });
    expect(v['market.baseUrl']).toBe('');
    expect(v['ai.route']).toEqual({ profiles: [], bindings: {}, defaultProfileId: '' });
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('空库（getAll={}）→ 全量默认值', async () => {
    const { client } = fakeStorage();
    attachSettingsStorage(client);
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().values).toEqual(DEFAULT_SETTINGS);
  });

  it('未 attach storage（#e2e 路径）→ load 不抛、保持默认值并标 loaded', async () => {
    await expect(useSettingsStore.getState().load()).resolves.toBeUndefined();
    expect(useSettingsStore.getState().values).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });
});

describe('settingsStore：写入即 settings.set op（§6.1a 落盘半段）', () => {
  it('setSetting → 镜像即时更新 + settings.set op 恰一次（key/value 形）', () => {
    const { client, calls } = fakeStorage();
    attachSettingsStorage(client);
    useSettingsStore.getState().setSetting('autoSave', true);
    expect(useSettingsStore.getState().values.autoSave).toBe(true);
    useSettingsStore.getState().setSetting('dens_stars', 40);
    expect(useSettingsStore.getState().values.dens_stars).toBe(40);
    const setOps = calls.filter((c) => c.op === 'settings.set');
    expect(setOps).toHaveLength(2);
    expect(setOps[0]?.op === 'settings.set' && setOps[0].args).toEqual({ key: 'autoSave', value: true });
    expect(setOps[1]?.op === 'settings.set' && setOps[1].args).toEqual({ key: 'dens_stars', value: 40 });
  });

  it('set op 失败 → 镜像仍更新、错误吞掉并 console.error（fire-and-forget，AutoSaveScheduler 同款）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: StorageInvokeReq[] = [];
    const bridge: StorageBridge = {
      invoke: async (req) => {
        calls.push(req);
        if (req.op === 'settings.set') throw new Error('DAO-ERROR');
        return {};
      },
    };
    attachSettingsStorage(createStorageClient(bridge));
    useSettingsStore.getState().setSetting('snap', false);
    expect(useSettingsStore.getState().values.snap).toBe(false);
    await Promise.resolve(); // 等 fire-and-forget promise 结算
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('settingsStore：factoryReset op 发起（§6.2——删库/重启编排归 C-M1 对端）', () => {
  it('factoryReset → settings.factoryReset op 恰一次', async () => {
    const { client, calls } = fakeStorage();
    attachSettingsStorage(client);
    await useSettingsStore.getState().factoryReset();
    expect(calls.filter((c) => c.op === 'settings.factoryReset')).toHaveLength(1);
  });

  it('未 attach storage → factoryReset reject（危险 op 不静默吞）', async () => {
    await expect(useSettingsStore.getState().factoryReset()).rejects.toThrow(/storage/i);
  });
});
