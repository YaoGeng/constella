// LaneSessionSpec —— C-04 lane 生命周期规格（TDD-C-04 §3 组件行；T4-05）。
// 状态机（§1 生命周期表/demo L2813-2819/L2870）：lane 首 cdp.*→createSession、
// 同 lane 后续→navigate 只更新 URL、run 收尾→destroyRun 统一销毁（幂等）。
// partition/port 规格常量同落本件（C-M1 执行面实现消费；§2 imports ↓ 仅 X-01 纯类型）。

/** attach 协议版本（仅 1.2/1.3 受支持，S-3 判据 2——Electron 升级时复验） */
export const CDP_ATTACH_PROTOCOL = '1.3';

/** lane 会话台账 renderer 视图（02 §7.1 lanes 列子集；写入归 C-M1，本卡只读投影） */
export interface LaneSessionRecord {
  readonly laneKey: string;
  readonly label: string;
  readonly port: number;
  readonly partition: string;
  readonly lastUrl: string;
}

/** 生命周期决策（§1 表三行）：create=cdp:createSession／navigate=cdp:navigate 只更新 URL／destroy=cdp:destroyRun */
export type LaneSessionDecision =
  | { readonly kind: 'create' }
  | { readonly kind: 'navigate' }
  | { readonly kind: 'destroy' };

/** 决策时机：cdp-node=lane 内 cdp.* 节点执行前（首建或复用）；finalize=run 收尾（done/error/aborted） */
export type SessionPhase = 'cdp-node' | 'finalize';

/** partition 形=`persist:<flowId>·<laneLabel>`（含 `·`/中文实测可用，S-3 判据 1） */
export function partitionOf(flowId: string, laneLabel: string): string {
  return `persist:${flowId}·${laneLabel}`;
}

/** §3 组件行冻结签名：无会话（首 cdp.*）→true=createSession；有会话→false=复用 navigate */
export function shouldCreate(lane: LaneSessionRecord | undefined): boolean {
  return lane === undefined;
}

/** 三转移决策（§6.1b 验收面）：cdp-node×无会话→create／cdp-node×有会话→navigate／finalize→destroy。
 * destroy 语义=cdp:destroyRun 统一销毁全部 lane 窗（幂等）——坑②「保 dock 主窗存活或显式覆盖
 * window-all-closed」的兜底归 C-M1 AppRuntime（§1 表收尾行），本规格只冻结销毁时机。 */
export function decideSessionAction(
  lane: LaneSessionRecord | undefined,
  phase: SessionPhase,
): LaneSessionDecision {
  if (phase === 'finalize') return { kind: 'destroy' };
  return lane === undefined ? { kind: 'create' } : { kind: 'navigate' };
}
