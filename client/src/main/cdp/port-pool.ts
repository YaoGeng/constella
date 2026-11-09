// CdpPortPool —— main 侧端口池物理执行面（T4-18 / TDD-C-M1 §3 PortPool 行）。
//
// 9221–9320 递增分配（02 §3.2 C-04 行；demo L1748 cdpPortSeq 语义）＋创建前探活冲突跳号
// （02 §15.2 N7 对策）＋耗尽=CDP-PORT-EXHAUSTED＋detail 含 lane 收敛提示（≤10 并行 lane
// 内存指标 PRD D-5 ⚠）。net 段 9321–9420 为 NetProxyBridge 独立池（T0-06 会签）不挤占本段。
//
// 与 renderer 规格件（renderer/cdp/port-pool.ts，T4-05）语义同步；接口形差异=T4-05 评审冻结的
// main 侧同步形：acquire(): number——物理探活的异步性收在 warmUp（启动序「PortPool 预热」，
// C-M1 §3 生命周期段）与 CdpBridge 绑定冲突跳号（openLane EADDRINUSE→markBusy→次号重试），
// 分配记账本身无 I/O。
import net from 'node:net';
import { IPC_ERROR_CODES } from '@constella/shared/ipc';
import { CdpChannelError } from './errors';

/** lane 端口段（同 renderer CDP_PORT_RANGE——值冻结 02 §3.2 C-04 行；跨层同构复制不 import renderer） */
export const CDP_PORT_RANGE_MAIN = { first: 9221, last: 9320 } as const;

export interface PortPoolRange {
  first: number;
  last: number;
}

/** 探活：port 被外部占用 → true（跳号；N7） */
export type PortOccupiedProbe = (port: number) => Promise<boolean>;

/** 耗尽报错文案（detail 含段范围＋lane 收敛提示——与 renderer 规格件同文） */
function exhaustedMessage(seg: PortPoolRange): string {
  return `CDP 端口段 ${seg.first}–${seg.last} 已耗尽：请收敛并行 lane 数（内存指标 ≤10，PRD D-5）后重试`;
}

/**
 * 物理探活（net bind 试探）：127.0.0.1:port 能绑 → false（空闲）；EADDRINUSE → true。
 * （bind 试探即 CdpBridge 服务端同口径占用判据——探活与实际用口同语义。）
 */
export function probePortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(false));
    });
  });
}

/**
 * main 侧端口池（§3 组件行 `acquire(): port | Exhausted` 的同步落地：耗尽=throw
 * CdpChannelError〔CDP-PORT-EXHAUSTED〕——IpcGateway 序列化识别序 ②）。
 */
export class CdpPortPool {
  private readonly allocated = new Set<number>(); // 已分配未归还（不参与再分配）
  private readonly recycled: number[] = []; // 归还口（升序维护，acquire 取最小）
  private readonly busy = new Set<number>(); // 探活/绑定冲突占用（跳号记账，markBusy 可追记）
  private cursor: number; // 递增游标（demo cdpPortSeq 语义）

  constructor(
    range?: PortPoolRange,
    private readonly probe: PortOccupiedProbe = probePortOccupied,
  ) {
    const seg = range ?? CDP_PORT_RANGE_MAIN;
    this.cursor = seg.first;
    this.range = seg;
  }

  private readonly range: PortPoolRange;

  /** 预热：启动序全段探活扫描，占用口入 busy 记账（首个 createSession 前完成「创建前探活」） */
  async warmUp(): Promise<void> {
    const ports: number[] = [];
    for (let p = this.range.first; p <= this.range.last; p += 1) ports.push(p);
    const results = await Promise.all(ports.map(async (p) => ((await this.probe(p)) ? p : null)));
    for (const p of results) if (p !== null) this.busy.add(p);
  }

  /** 同步分配：回收口（最小归还口）→ 递增段（busy 口跳号）；耗尽 → throw CDP-PORT-EXHAUSTED */
  acquire(): number {
    for (;;) {
      const port = this.recycled.shift();
      if (port !== undefined) return port; // 归还口（本池记账，无需再探活）
      if (this.cursor > this.range.last) {
        throw new CdpChannelError(IPC_ERROR_CODES.CDP_PORT_EXHAUSTED, exhaustedMessage(this.range));
      }
      const candidate = this.cursor++;
      if (this.busy.has(candidate)) continue; // 探活/绑定冲突占用跳号（N7）
      this.allocated.add(candidate);
      return candidate;
    }
  }

  /** 归还已分配口（destroyRun/会话销毁还池）；未分配口/重复归还＝无操作 */
  release(port: number): void {
    if (!this.allocated.delete(port)) return;
    this.recycled.push(port);
    this.recycled.sort((a, b) => a - b);
  }

  /** 追记占用口（CdpBridge openLane 绑定冲突 EADDRINUSE 后跳号记账）；已入回收池的口一并摘除 */
  markBusy(port: number): void {
    const i = this.recycled.indexOf(port);
    if (i >= 0) this.recycled.splice(i, 1);
    this.busy.add(port);
  }

  /** 可分配口余量（观测面：测试/诊断——段内非 busy 且未持有，含回收待复用口） */
  get available(): number {
    let n = 0;
    for (let p = this.range.first; p <= this.range.last; p += 1) {
      if (!this.busy.has(p) && !this.allocated.has(p)) n += 1;
    }
    return n;
  }
}
