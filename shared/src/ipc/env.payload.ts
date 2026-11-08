// env 域 payload（X-01 §1 ipc 行；02 §3.4；C-M1 §1 矩阵 AppRuntime/Cdp 行）。

/** env:systemInfo（r→m）：`{}` → {os,cpuCores,memTotal,runtimeVersions}（02 §3.4，B-9）
 * ＋ lanes 内存数组（✅ M4 #7 收口：按 lane 会话窗口 processMemoryInfo 聚合——
 * 单 lane ≤150MB 预算告警数据源，01 §8.1「单 lane 会话预算 ≤150MB，超预算在任务中心告警」） */
export interface SystemInfoReq {
  // 空 payload（02 §3.4 `{}`）
}

/** lane 会话内存采样（env:systemInfo lanes 数组元素；01 §8.1/§12） */
export interface LaneMemory {
  /** lane 会话键（= lanes 表 laneKey） */
  laneKey: string;
  /** lane 展示名 */
  label: string;
  /** 会话窗口 processMemoryInfo 聚合工作集（字节） */
  workingSetBytes: number;
}

export interface SystemInfoRes {
  os: string;
  cpuCores: number;
  memTotal: number;
  /** 运行时版本聚合（electron/node/chrome 等 → 版本串） */
  runtimeVersions: Record<string, string>;
  /** lane 会话内存数组（M4 #7 增补） */
  lanes: LaneMemory[];
}

/** 单 lane 内存预算（字节）＝150MB（01 §8.1；超预算在任务中心告警——告警 UI 归 C-10/C-11） */
export const LANE_MEMORY_BUDGET_BYTES = 150 * 1024 * 1024;

/** env:cdpProbe（r→m）：`{}` → {ok,detail}（02 §3.4；附栈会话探活+故障上报，B-9/B-14；
 * C-M1 §1：in-band——探活失败→{ok:false,detail}，非 reject） */
export interface CdpProbeReq {
  // 空 payload（02 §3.4 `{}`）
}

export interface CdpProbeRes {
  ok: boolean;
  /** 探活失败时的故障详情 */
  detail?: string;
}
