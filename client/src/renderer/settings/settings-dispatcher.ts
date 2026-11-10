// SettingsDispatcher —— applySetting 分发＋__skyReady 回放注册（T6-12；TDD-C-11 §1/§3
// SettingsDispatcher 行；demo L2695-2727 语义）。
//
// setSetting(k,v)＝store.setSetting（镜像+settings.set op）＋applySetting(k) 分发（§1 语义）：
// - 星野 12 键 → window.__skyCtl.layer(k,v)（含 parallax 视差——demo L2698 12 键集）
// - dens_* → __skyCtl.dens(短键, v/100)＋「星野重建中」toast（demo L2741-2745）
// - bg → applyBg：纯黑=__skyCtl.pause(true)＋onBgChange(true)（canvas/暗角隐藏语义——本卡只发
//   通道+回调留位，canvas 实隐藏联调随 T6-17/T6-13）；切回=pause(false)（demo L2704-2711）
// - autoSave → 底栏徽标联动（onAutoSaveChange 留位）＋AutoSaveScheduler 门控：开且 dirty→
//   schedule() 补排、关→cancel()（demo L2702；readDirty 注入位=T6-17 装配 flowStore.dirty）
// - snap/edgeAnim → 无通道动作（C-01 侧订阅 settingsStore 拉取，L4→L3 方向）
//
// install()＝__skyReady 回放注册（两加载序恰一次）：renderer 先→挂回调待 sky 就绪回调回放；
// sky 先（__skyCtl 已在）→install 即全量回放；一次性守卫防重复回调双发。P-3：不 import
// sky/canvas——通道全经 window（control-channel.ts），scheduler/toast/回调全注入。
import type { SettingsKey, SettingsSchema } from '@constella/shared/settings';
import type { AutoSaveScheduler } from '../storage';
import { useSettingsStore } from './settings-store';
import { SKY_DENS_KEYS, SKY_LAYER_KEYS, densRatio, densShortKey } from './settings-store';
import { clearSkyReadyCallback, getSkyCtl, setSkyReadyCallback, type SkyReadyCallback } from './control-channel';

/** dispatcher 依赖注入位（应用壳 T6-17 装配；测试 mock 同面） */
export interface SettingsDispatcherDeps {
  /** AutoSaveScheduler 门控调用面（schedule/cancel——T1-08 注入位；null=未装配（无排程）） */
  scheduler?: Pick<AutoSaveScheduler, 'schedule' | 'cancel'> | null;
  /** dirty 读取（autoSave 开启时若有 pending 脏立即补排——demo L2702 `if(autoSave&&dirty)`；
   *  装配＝() => useFlowStore.getState().dirty〔T6-17〕；缺省 false＝保守不补排） */
  readDirty?(): boolean;
  /** toast 注入位（「星野重建中」——canvas CanvasToastProvider/uiStore toast 队列随 T6-17 装配） */
  toast?(text: string): void;
  /** autoSave 底栏徽标联动留位（demo L2747-2752 updateAsBadge——应用壳接线） */
  onAutoSaveChange?(on: boolean): void;
  /** bg 纯黑 canvas/暗角隐藏语义留位（demo L2704-2711 applyBg 的 DOM 半段——T6-17/T6-13 联调） */
  onBgChange?(black: boolean): void;
}

export interface SettingsDispatcher {
  /** 即时生效＋落盘：store.setSetting（镜像+settings.set op）＋applySetting(k)（§1） */
  setSetting(k: SettingsKey, v: SettingsSchema[SettingsKey]): void;
  /** 分发当前值（demo L2696-2703 applySetting） */
  applySetting(k: SettingsKey): void;
  /** 全量回放：bg pause＋12 层键＋7 密度（demo L2719-2727——__skyReady/联调用；不发 toast） */
  replayAll(): void;
  /** __skyReady 回放注册（两加载序恰一次守卫）；返回卸载函数（清回调） */
  install(): () => void;
}

/** 短键 → layer 键集合查找（12 键成员判定） */
function isLayerKey(k: string): k is (typeof SKY_LAYER_KEYS)[number] {
  return (SKY_LAYER_KEYS as readonly string[]).includes(k);
}

/** 全键 → dens 键集合查找 */
function isDensKey(k: string): k is (typeof SKY_DENS_KEYS)[number] {
  return (SKY_DENS_KEYS as readonly string[]).includes(k);
}

export function createSettingsDispatcher(deps: SettingsDispatcherDeps = {}): SettingsDispatcher {
  const applyBg = (): void => {
    const black = useSettingsStore.getState().values.bg === 'black';
    getSkyCtl()?.pause(black);
    deps.onBgChange?.(black);
  };

  const applySetting = (k: SettingsKey): void => {
    const { values } = useSettingsStore.getState();
    if (isLayerKey(k)) {
      getSkyCtl()?.layer(k, !!values[k]);
      return;
    }
    if (isDensKey(k)) {
      const v = values[k];
      getSkyCtl()?.dens(densShortKey(k), densRatio(v));
      deps.toast?.(`星野重建中 — ${densShortKey(k)} ${v}%`);
      return;
    }
    if (k === 'bg') {
      applyBg();
      return;
    }
    if (k === 'autoSave') {
      deps.onAutoSaveChange?.(values.autoSave);
      if (values.autoSave) {
        if (deps.readDirty?.() ?? false) deps.scheduler?.schedule();
      } else {
        deps.scheduler?.cancel();
      }
    }
    // snap/edgeAnim（C-01 订阅拉取）与 ai/market.baseUrl/ai.route（C-07/C-18 域）无通道分发
  };

  const replayAll = (): void => {
    const { values } = useSettingsStore.getState();
    applyBg();
    const sky = getSkyCtl();
    if (sky !== null) {
      for (const k of SKY_LAYER_KEYS) sky.layer(k, !!values[k]);
      for (const k of SKY_DENS_KEYS) sky.dens(densShortKey(k), densRatio(values[k]));
    }
  };

  const install = (): (() => void) => {
    let replayed = false;
    const once: SkyReadyCallback = () => {
      if (replayed) return;
      replayed = true;
      replayAll();
    };
    if (getSkyCtl() !== null) once(); // 加载序 B：sky 先就绪 → 立即全量
    setSkyReadyCallback(once); // 加载序 A：sky 后就绪 → 回调回放
    return () => clearSkyReadyCallback(once);
  };

  return {
    setSetting: (k, v) => {
      useSettingsStore.getState().setSetting(k, v);
      applySetting(k);
    },
    applySetting,
    replayAll,
    install,
  };
}
