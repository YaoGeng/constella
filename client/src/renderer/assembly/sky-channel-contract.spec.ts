// sky-channel-contract —— SkyCtlChannel↔SkyControl 双 import 结构契约测试（T6-17 返工
// MAJOR-1.2＝batch-1 转交登记③第二项；PM 授权落 assembly/〔两模块目录之外——不触
// settings/sky 的 §6.5「禁互 import」grep 面；assembly=组合根，双 import 合法〕）。
//
// 断言面：
//   - 编译期：sky 侧实现形 SkyControl 可赋值给 settings 消费形 SkyCtlChannel（三方法参数
//     逆变相容——SkyLayerKey/DensKey ⊂ string、返回 void 同构）；C-12 改通道形（方法改名/
//     参数形漂移）→ 本文件 tsc 即红（验收链含 tsc --noEmit）；
//   - 运行期：三方法名逐一在结构探针上可达＋12 层键集两端相等＋7 密度短键集两端相等
//     （settings densShortKey 映射 vs sky DensKey 集）——键漂移任一侧即本测试红。
import { describe, expect, it, vi } from 'vitest';
import type { SkyCtlChannel } from '../settings/control-channel';
import { SKY_LAYER_KEYS as SETTINGS_LAYER_KEYS, SKY_DENS_KEYS as SETTINGS_DENS_KEYS, densShortKey } from '../settings/settings-store';
import type { SkyControl } from '../sky/types';
import { SKY_LAYER_KEYS as SKY_LAYER_KEYS_C12, SKY_DENS_KEYS as SKY_DENS_KEYS_C12 } from '../sky/types';

// ————————————————————————————————————————————
// 编译期类型相容（无运行时产物——tsc --noEmit 面）
// ————————————————————————————————————————————

/** sky 实现 → settings 消费方向赋值相容（window.__skyCtl 实为 SkyControl，getSkyCtl 以
 *  SkyCtlChannel 视图消费——本断言锁定该裸读 cast 的结构安全性） */
const skyImplSatisfiesConsumerFace: SkyCtlChannel = null as unknown as SkyControl;
void skyImplSatisfiesConsumerFace;

/** 三方法参数形编译期对齐探针（Parameters 逐法比较——实现形参数须窄于消费形参数
 *  〔SkyLayerKey/DensKey 字面量 ⊂ string〕；C-12 改参数形 → 不再 extends → 编译红） */
type AssertNarrower<TImpl, TConsumer> = TImpl extends TConsumer ? true : never;
type LayerParamsOk = AssertNarrower<Parameters<SkyControl['layer']>, Parameters<SkyCtlChannel['layer']>>;
type DensParamsOk = AssertNarrower<Parameters<SkyControl['dens']>, Parameters<SkyCtlChannel['dens']>>;
type PauseParamsOk = AssertNarrower<Parameters<SkyControl['pause']>, Parameters<SkyCtlChannel['pause']>>;
const LAYER_OK: LayerParamsOk = true;
const DENS_OK: DensParamsOk = true;
const PAUSE_OK: PauseParamsOk = true;
void LAYER_OK;
void DENS_OK;
void PAUSE_OK;

// ————————————————————————————————————————————
// 运行期结构断言
// ————————————————————————————————————————————

describe('SkyCtlChannel↔SkyControl 结构契约（C-11↔C-12 通道形）', () => {
  it('三方法签名：sky 实现形对象可作消费形调用（layer/dens/pause 逐法可达）', () => {
    const layer = vi.fn();
    const dens = vi.fn();
    const pause = vi.fn();
    // sky 侧实现形（SkyControl——window.__skyCtl 的真实挂载形）
    const ctl: SkyControl = { layer, dens, pause };
    // settings 侧消费视图（getSkyCtl() 的返回形）——结构裸读后逐法调用
    const consumer: SkyCtlChannel = ctl;
    consumer.layer('meteor', false);
    consumer.dens('stars', 0.5);
    consumer.pause(true);
    expect(layer).toHaveBeenCalledWith('meteor', false);
    expect(dens).toHaveBeenCalledWith('stars', 0.5);
    expect(pause).toHaveBeenCalledWith(true);
  });

  it('12 层键集两端相等（settings 分组键 ↔ sky 冻结键——排序集合比较）', () => {
    expect(SETTINGS_LAYER_KEYS).toHaveLength(12);
    expect(SKY_LAYER_KEYS_C12).toHaveLength(12);
    expect([...SETTINGS_LAYER_KEYS].sort()).toEqual([...SKY_LAYER_KEYS_C12].sort());
  });

  it('7 密度短键集两端相等（settings densShortKey 映射 ↔ sky DensKey 冻结键）', () => {
    expect(SETTINGS_DENS_KEYS).toHaveLength(7);
    expect(SKY_DENS_KEYS_C12).toHaveLength(7);
    const settingsShort = SETTINGS_DENS_KEYS.map((k) => densShortKey(k)).sort();
    expect(settingsShort).toEqual([...SKY_DENS_KEYS_C12].sort());
  });
});
