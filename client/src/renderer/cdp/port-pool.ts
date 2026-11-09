// PortPool —— C-04 端口池规格（03 §1 生命周期表端口行＋02 §15.2 N7；T4-05）。
// 9221–9320 递增分配（demo L1748 cdpPortSeq 语义）/创建前探活冲突跳号（N7 对策）/
// 耗尽=CDP-PORT-EXHAUSTED＋提示收敛 lane 数（≤10 并行 lane 内存指标 PRD D-5 ⚠）。
// 物理执行面（main 侧持有/真实端口探活）＝C-M1 §3 PortPool 组件——本件冻结其分配语义。
import { IPC_ERROR_CODES } from '@constella/shared/ipc';

/** lane 端口段（02 §3.2 C-04 行：9221–9320；net 段 9321–9420 为独立池不挤占，T0-06 会签） */
export const CDP_PORT_RANGE = { first: 9221, last: 9320 } as const;

/** 创建前探活：port 被外部占用→true（跳号；N7） */
export type PortProbe = (port: number) => Promise<boolean>;

/** 耗尽错误（IpcError 形：code=CDP-PORT-EXHAUSTED＋message 含 lane 收敛提示） */
export interface PortPoolExhausted {
  readonly code: typeof IPC_ERROR_CODES.CDP_PORT_EXHAUSTED;
  readonly message: string;
}

/** 分配结果（C-M1 §3 `acquire(): port | Exhausted` 语义的 renderer 规格形） */
export type PortAllocation =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: PortPoolExhausted };

export interface PortPool {
  /** 递增分配＋探活冲突跳号；优先复用最小归还口 */
  acquire(): Promise<PortAllocation>;
  /** 归还已分配口（未分配口为无操作；重复归还不双记） */
  release(port: number): void;
}

export function createPortPool(range?: { first: number; last: number }, probe?: PortProbe): PortPool {
  const seg = range ?? CDP_PORT_RANGE;
  const allocated = new Set<number>(); // 已分配未归还（不参与再分配）
  const recycled: number[] = []; // 归还口（升序维护，acquire 取最小）
  let cursor = seg.first; // 递增游标（demo cdpPortSeq 语义）

  const exhausted = (): PortAllocation => ({
    ok: false,
    error: {
      code: IPC_ERROR_CODES.CDP_PORT_EXHAUSTED,
      message: `CDP 端口段 ${seg.first}–${seg.last} 已耗尽：请收敛并行 lane 数（内存指标 ≤10，PRD D-5）后重试`,
    },
  });

  return {
    async acquire(): Promise<PortAllocation> {
      for (;;) {
        const port = recycled.shift();
        if (port !== undefined) return { ok: true, port }; // 归还口（本池记账，无需再探活）
        if (cursor > seg.last) return exhausted();
        const candidate = cursor++;
        if (probe !== undefined && (await probe(candidate))) continue; // 探活冲突跳号（N7）
        allocated.add(candidate);
        return { ok: true, port: candidate };
      }
    },
    release(port: number): void {
      if (!allocated.delete(port)) return; // 未分配/重复归还＝无操作
      recycled.push(port);
      recycled.sort((a, b) => a - b);
    },
  };
}
