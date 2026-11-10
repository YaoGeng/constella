// C-12 SkyBackground 通道类型（TDD-C-12 §1；demo L2696-2727/L4761-4776 通道形冻结）。
// 键集合按 demo L2698（12 层）与 L2721/L2723（7 密度）冻结；键形对齐 X-01 SettingsSchema
// 星野键（03 §1「键集合形=X-01 SettingsSchema 星野键」）——对齐以本文件底部编译期断言锁定，
// 键漂移（改名/增删）=编译失败。唯一正式下发方=C-11（经 __skyCtl/__skyReady 通道，无 import 边）。
import type { SettingsSchema } from '@constella/shared/settings';

/** 12 星野层键（demo L2698/L3153-3154 冻结；「11 星野元素+视差」=01 A-14.2 口径） */
export const SKY_LAYER_KEYS = [
  'meteor', 'sat', 'disk', 'minis', 'mega', 'gas',
  'heroes', 'stars', 'band', 'clusters', 'pulse', 'parallax',
] as const;

export type SkyLayerKey = (typeof SKY_LAYER_KEYS)[number];

/** 7 密度键（demo L2721/L2723 冻结；对应 SettingsSchema dens_* 七键） */
export const SKY_DENS_KEYS = ['stars', 'band', 'heroes', 'clusters', 'minis', 'mega', 'gas'] as const;

export type DensKey = (typeof SKY_DENS_KEYS)[number];

/** window.__skyCtl 通道形（03 §1；demo L4761-4775） */
export interface SkyControl {
  /** 层开关；meteor 关闭清空流星池（demo L4762） */
  layer(k: SkyLayerKey, v: boolean): void;
  /** 密度 p∈[0.1,1] 钳制→重建星野（demo L4764） */
  dens(k: DensKey, p: number): void;
  /** 纯黑背景=主循环整帧跳过（省电，demo L4500/L4774） */
  pause(v: boolean): void;
}

// window.__skyCtl / __skyReady 全局声明（03 §1；实现点唯一=本模块 control-channel.ts，
// 消费方 C-11 经通道调用，两端零 import 边——03 §6.5 grep 验收）。
declare global {
  interface Window {
    __skyCtl?: SkyControl;
    /** 主控侧注册回放回调；sky 就绪即调用——两端加载序无关（demo L2718-2727/L4776） */
    __skyReady?: () => void;
  }
}

// —— X-01 对齐编译期断言（03 §1「键集合形=X-01」；无运行时产物）——
// 12 层键全部是 SettingsSchema 的 boolean 键；7 密度键 k 均存在 SettingsSchema[`dens_${k}`]: number。
// 任一键漂移 → 下面两个类型不再化简为 true → 引用处的赋值编译失败。
type LayerAligned = { [K in SkyLayerKey]: SettingsSchema[K] extends boolean ? true : 0 };
type DensAligned = { [K in DensKey]: SettingsSchema[`dens_${K}`] extends number ? true : 0 };
export type SkyKeysAlignWithSettings =
  LayerAligned[keyof LayerAligned] extends true
    ? DensAligned[keyof DensAligned] extends true
      ? true
      : never
    : never;

/** 编译期消费（误用为值时即断言失败；正常仅作类型存在性证明） */
export const SKY_KEYS_ALIGNED: SkyKeysAlignWithSettings = true;
