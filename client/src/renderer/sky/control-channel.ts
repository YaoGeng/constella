// C-12 ControlChannel（TDD-C-12 §3）：window.__skyCtl 实现 + 就绪即调 __skyReady
// （demo L4755-4778：通道 L4761-4775、触发 L4776，1:1 移植）——LAYER/DENS 内存标志唯一写点
// （03 §3；设置状态本体在 C-11 settings 域，本模块仅持内存标志，零持久化）。
// dens 的 rebuild 注入（=resize）以避免与 SkyCanvas 的运行时环形 import；demo L4772 的 resize() 调用同位。
import type { SkyState } from './sky-canvas';
import type { SkyControl } from './types';

export interface ControlChannel {
  /** §1 通道形（window.__skyCtl） */
  ctl: SkyControl;
  /** 移除通道实现（卸载清理；demo 页面级生命周期能无此项，React 卸载语义补齐——03 §1「移除监听」同类） */
  unregister(): void;
}

export function createControlChannel(s: SkyState, rebuild: () => void): ControlChannel {
  const ctl: SkyControl = {
    layer(k, v) {                                                    // demo L4762
      if (k in s.LAYER) {
        s.LAYER[k] = v;
        if (k === 'meteor' && !v) s.meteors.length = 0;              // meteor 关闭清空流星池
      }
    },
    dens(k, p) {                                                     // demo L4763-4773
      const c = Math.max(.1, Math.min(1, p));                        // p∈[0.1,1] 钳制
      s.DENS[k] = c;                                                 // demo DENS..DENS7 的 Record 化（键集相同）
      rebuild();                                                     // demo L4772 resize()
    },
    pause(v) { s.PAUSED = !!v; },                                    // demo L4774
  };
  const win = s.win;                                                 // types.ts 已 declare global Window.__skyCtl/__skyReady
  win.__skyCtl = ctl;                                                // demo L4761
  if (win.__skyReady) win.__skyReady();                              // demo L4776：就绪即调（主控先注册→回放恰一次）
  return {
    ctl,
    unregister() { delete win.__skyCtl; },
  };
}
