// settingsStore —— settings KV 镜像（T6-12；TDD-C-11 §1/§3 settingsStore 行、02 §3.3）。
//
// 启动 getAll 装载＋缺省合并（C-06 settings.getAll → Partial<SettingsSchema>，缺省键取
// §1 默认值=demo L1071-1073 同源）；写入即 settings.set op（fire-and-forget，错误吞掉并
// console.error——AutoSaveScheduler 同款惯例）；危险区 factoryReset=op 发起（删库/重迁/
// 重种/重启编排归 C-M1 对端，本卡只发起）。持久化唯一走 C-06 op（本地存储零直写，§6.5）。
//
// storageClient 装配：应用壳启动序 attachSettingsStorage(client)（bridge 随 C-M1 preload 面，
// T6-17 接线）；#e2e 模式不 attach——load() 走无 storage 默认值路径（canvas-e2e 不回归）。
// snap/edgeAnim/autoSave 消费方（C-01/C-06 AutoSaveScheduler）↓ 订阅本 store 拉取（§2 方向）。
import { create } from 'zustand';
import type { SettingsKey, SettingsSchema } from '@constella/shared/settings';
import type { StorageClient } from '../storage';

// ————————————————————————————————————————————
// 键分组常量（设置面控件键集——check-settings-keys.mjs 静态比对源；demo L2698/L2721-2726 顺序）
// ————————————————————————————————————————————

/** 交互三开关（01 A-14.1；默认：开/开/关） */
export const INTERACTION_KEYS = ['snap', 'edgeAnim', 'autoSave'] as const;

/** 背景与渲染（01 A-14.2：bg 双值＋鼠标视差——parallax 控件挂背景节，demo L762-764） */
export const BACKGROUND_KEYS = ['bg', 'parallax'] as const;

/** 11 星野开关键（UI 控件——demo L766-777；parallax 视差在背景节，不在此组） */
export const SKY_TOGGLE_KEYS = [
  'meteor',
  'sat',
  'disk',
  'minis',
  'mega',
  'gas',
  'heroes',
  'stars',
  'band',
  'clusters',
  'pulse',
] as const;

/** 星野 12 层键（通道下发面：11 星野开关＋parallax 视差——demo L2698/L2721 同集，__skyCtl.layer） */
export const SKY_LAYER_KEYS = [...SKY_TOGGLE_KEYS, 'parallax'] as const;

/** 7 密度全键（10%–100% 步进 10——__skyCtl.dens 下发面，短键=去 'dens_' 前缀） */
export const SKY_DENS_KEYS = [
  'dens_stars',
  'dens_band',
  'dens_heroes',
  'dens_clusters',
  'dens_minis',
  'dens_mega',
  'dens_gas',
] as const;

/** 密度全键 → 短键（dens_stars→stars——__skyCtl.dens 通道键，demo L2725） */
export function densShortKey(k: (typeof SKY_DENS_KEYS)[number]): string {
  return k.slice('dens_'.length);
}

/** 密度百分比 → 通道比（v/100，10–100 → 0.1–1.0） */
export function densRatio(v: number): number {
  return v / 100;
}

// 编译期穷尽断言：设置面 UI 控件键并集（三开关+背景双值视差+11 星野开关+7 密度=23 控件）≡
// X-01 SettingsSchema 键集 − AI 配置引用键（ai / market.baseUrl / ai.route 非 A-14 设置面
// 控件——check-settings-keys.mjs 运行时同断言；通道分组 SKY_LAYER_KEYS 另含 parallax，非 UI 并集成员）
const ALL_UI_KEYS = [...INTERACTION_KEYS, ...BACKGROUND_KEYS, ...SKY_TOGGLE_KEYS, ...SKY_DENS_KEYS] as const;
type _UiKeyFromSchema = Exclude<SettingsKey, 'ai' | 'market.baseUrl' | 'ai.route'>;
type _UiKeyExhaustive = _UiKeyFromSchema extends (typeof ALL_UI_KEYS)[number]
  ? (typeof ALL_UI_KEYS)[number] extends _UiKeyFromSchema
    ? true
    : never
  : never;
const _uiKeyExhaustive: _UiKeyExhaustive = true;
void _uiKeyExhaustive;

// ————————————————————————————————————————————
// 默认值（§1：snap=on/edgeAnim=on/autoSave=off/bg='sky'/11 层全 on/7 密度=100——demo L1071-1073
// 与 X-01 settings-keys.ts 注释口径核对一致；AI 引用键默认空形〔X-01：apiKey 只存 safeStorage〕）
// ————————————————————————————————————————————

export const DEFAULT_SETTINGS: SettingsSchema = {
  snap: true,
  edgeAnim: true,
  autoSave: false,
  bg: 'sky',
  parallax: true,
  disk: true,
  minis: true,
  mega: true,
  gas: true,
  clusters: true,
  heroes: true,
  stars: true,
  band: true,
  pulse: true,
  meteor: true,
  sat: true,
  dens_stars: 100,
  dens_band: 100,
  dens_heroes: 100,
  dens_clusters: 100,
  dens_minis: 100,
  dens_mega: 100,
  dens_gas: 100,
  ai: { baseUrl: '', apiKeyRef: '' },
  'market.baseUrl': '',
  'ai.route': { profiles: [], bindings: {}, defaultProfileId: '' },
};

// ————————————————————————————————————————————
// store（zustand 模块单例——flowStore/canvasStore 同款惯例；测试 beforeEach setState 重置）
// ————————————————————————————————————————————

export interface SettingsStoreApi {
  /** 全量合并后的 KV 镜像（装载完成前=DEFAULT_SETTINGS） */
  values: SettingsSchema;
  /** 启动装载完成标记 */
  loaded: boolean;
  /** 启动装载：settings.getAll → 缺省合并（未 attach storage → 保持默认并标 loaded，#e2e 路径） */
  load(): Promise<void>;
  /** 写镜像＋落盘（settings.set op，fire-and-forget；分发由 SettingsDispatcher.setSetting 组合） */
  setSetting(k: SettingsKey, v: SettingsSchema[SettingsKey]): void;
  /** 危险区：storage settings.factoryReset op 发起（恰一次由 DangerZoneSection 确认流保证；删库/重启编排归 C-M1） */
  factoryReset(): Promise<void>;
}

let storageRef: StorageClient | null = null;

/** 装配 storageClient（应用壳启动序——T6-17 接线；null=卸载〔测试〕） */
export function attachSettingsStorage(client: StorageClient | null): void {
  storageRef = client;
}

export const useSettingsStore = create<SettingsStoreApi>()((set, get) => ({
  values: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    if (storageRef === null) {
      // #e2e/未装配路径：无 storage，保持默认值（缺省合并的平凡情形）
      set({ loaded: true });
      return;
    }
    const partial = await storageRef.invoke('settings.getAll', undefined);
    set({ values: { ...DEFAULT_SETTINGS, ...partial }, loaded: true });
  },

  setSetting: (k, v) => {
    set((s) => ({ values: { ...s.values, [k]: v } }));
    if (storageRef === null) return;
    void storageRef
      .invoke('settings.set', { key: k, value: v })
      .catch((err: unknown) => console.error('[settingsStore] settings.set 失败：', err));
  },

  factoryReset: async () => {
    if (storageRef === null) {
      throw new Error('settingsStore: storage 未装配（attachSettingsStorage）——危险 op 不静默吞');
    }
    await storageRef.invoke('settings.factoryReset', undefined);
  },
}));

/** 便捷 selector 面（C-01 snap/edgeAnim / C-06 autoSave 门控 ↓ 订阅拉取用） */
export const selectSnap = (s: SettingsStoreApi): boolean => s.values.snap;
export const selectEdgeAnim = (s: SettingsStoreApi): boolean => s.values.edgeAnim;
export const selectAutoSave = (s: SettingsStoreApi): boolean => s.values.autoSave;
