// settings 域导出面（T6-12；TDD-C-11 §1 对外接口契约——C-01/C-06 ↓ 订阅消费＋应用壳 T6-17 装配）。
//
// P-3 边界：星野下发唯一正式方=window.__skyCtl 通道（control-channel.ts），禁 import sky/canvas
// （§6.5 grep 验收）；持久化唯一走 C-06 settings 域 op（本地存储零直写）。
export {
  DEFAULT_SETTINGS,
  INTERACTION_KEYS,
  BACKGROUND_KEYS,
  SKY_TOGGLE_KEYS,
  SKY_LAYER_KEYS,
  SKY_DENS_KEYS,
  attachSettingsStorage,
  densRatio,
  densShortKey,
  selectAutoSave,
  selectEdgeAnim,
  selectSnap,
  useSettingsStore,
} from './settings-store';
export type { SettingsStoreApi } from './settings-store';
export { createSettingsDispatcher } from './settings-dispatcher';
export type { SettingsDispatcher, SettingsDispatcherDeps } from './settings-dispatcher';
export { getSkyCtl, setSkyReadyCallback, clearSkyReadyCallback } from './control-channel';
export type { SkyCtlChannel, SkyReadyCallback } from './control-channel';
export { SettingsDialog } from './SettingsDialog';
export type { SettingsDialogProps, SettingsSectionId } from './SettingsDialog';
export {
  BackgroundSection,
  DangerZoneSection,
  InteractionSection,
  RouteSettingsSection,
  SkyFieldSection,
} from './sections';
export type { SectionProps, RouteSettingsDeps } from './sections';
export { AlertDialog } from './AlertDialog';
export type { AlertDialogProps } from './AlertDialog';
