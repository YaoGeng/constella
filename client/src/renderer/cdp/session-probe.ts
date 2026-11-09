// SessionProbe —— env:cdpProbe 封装＋状态广播（T4-06；TDD-C-04 §1 管理面段＋§3 SessionProbe 行；
// B-9 顶栏环境 pill 同源/B-14 故障上报；探活结果交 C-03〔断连→失败终止决策〕）。
//
// env:cdpProbe 语义=in-band {ok,detail} 不 reject（C-M1 §1 矩阵 Env 行）；本封装每次 probe
// 后无论 ok/fail 皆广播订阅方（「ok/fail→订阅方」），传输层异常（IpcError）兜底映射
// {ok:false,detail=code:message}——故障不静默。探活节律归装配点（P5 pill 轮询/C-03 决策点直调）。
import type { CdpProbeReq, CdpProbeRes } from '@constella/shared/ipc';
import type { CdpManagerChannels } from './manager-channels';

/** SessionProbe 导出面（§3 组件级接口：probe()/onState(fn)；lastState=pill 初挂回显便捷位） */
export interface SessionProbe {
  /** 探活（通道 invoke 异步本质——§3 签名缩写的落地形）；结果同步广播订阅方 */
  probe(req?: CdpProbeReq): Promise<CdpProbeRes>;
  /** 状态订阅（ok/fail 两态皆广播）；返回退订 */
  onState(fn: (state: CdpProbeRes) => void): () => void;
  /** 最近一次探活结果（未探过=undefined） */
  lastState(): CdpProbeRes | undefined;
}

export function createSessionProbe(channels: CdpManagerChannels): SessionProbe {
  const listeners = new Set<(state: CdpProbeRes) => void>();
  let last: CdpProbeRes | undefined;
  return {
    async probe(req?: CdpProbeReq): Promise<CdpProbeRes> {
      let state: CdpProbeRes;
      try {
        state = await channels.probe(req);
      } catch (err) {
        // 传输层故障兜底（env:cdpProbe 本体 in-band；此路=通道断裂——B-14 上报不静默）
        const e = err as { code?: string; message?: string } | null;
        state = { ok: false, detail: `${e?.code ?? 'INTERNAL'}: ${e?.message ?? String(err)}` };
      }
      last = state;
      for (const fn of [...listeners]) fn(state);
      return state;
    },
    onState(fn: (state: CdpProbeRes) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    lastState(): CdpProbeRes | undefined {
      return last === undefined ? undefined : { ...last };
    },
  };
}
