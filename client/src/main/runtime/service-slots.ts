// 五服务构造注入位（T4-13 / TDD-C-M1 §3 生命周期段——T4-15~T4-20 逐卡接入，只立注入位不预实装）。
//
// 本文件只冻结 AppRuntime 启动/退出双序编排调用的服务生命周期面；各服务本体接口/组件级签名
// 以其归属卡（§3 组件行）为准——接入时由装配层（index.ts）适配到本面，不在本卡预实装。
import type { LaneMemory } from '@constella/shared/ipc';

/** StorageService（T4-20 接入）：storage:invoke 桥接 C-06；open 装配序归 StorageLayer（C-06）。 */
export interface StorageServiceSlot {
  /**
   * 启动序：C-06 open（迁移前备份→迁移→**ExamplePreloader 挂载步**→种子→ensureInitialVersions）。
   * options.preloadExamples=C-08 域注入回调装配位（迁移完成后、种子流程写入前——M4 裁决 2/#11，
   * T1-03 缺省空实现收口为装配点）：AppRuntime 恒传回调（缺省空实现），永不 undefined。
   */
  init(options: { preloadExamples: () => void | Promise<void> }): void | Promise<void>;
  /** 退出序末步：close（WAL checkpoint） */
  close(): void;
}

/** SecretVault（T4-15 接入）：safeStorage 可用性探测（不可用→SECRET-UNAVAILABLE 降级）。 */
export interface SecretVaultSlot {
  init(): void | Promise<void>;
}

/** CdpSessionManager（T4-18 接入）：lane 执行面。 */
export interface CdpSessionManagerSlot {
  /** 启动序：init（PortPool 预热） */
  init(): void | Promise<void>;
  /** 退出序：销毁全部 lane 窗（此阶段才允许窗口全空——S-3 坑②） */
  destroyAllLaneWindows(): void | Promise<void>;
  /**
   * env:systemInfo lanes 内存数组数据源（M4 #7：按 lane 会话窗口 processMemoryInfo 聚合——
   * 单 lane ≤150MB 预算告警数据源，B-9；T4-18 接线，缺省=无 lane → []）。
   */
  laneMemory?(): LaneMemory[] | Promise<LaneMemory[]>;
}

/** CronScheduler（T4-19 接入）：常驻调度（应用运行期间生效，D-5）。 */
export interface CronSchedulerSlot {
  /** 启动序：start（经 StorageService 读 flows/nodes 提取 trigger.cron 注册＋missed 检测） */
  start(): void | Promise<void>;
  /** 退出序首步：stop（刷 lastAliveAt） */
  stop(): void | Promise<void>;
}

/** SandboxExecutor（T4-16/T4-17 接入）：ts/python 执行链编排。 */
export interface SandboxExecutorSlot {
  /** 启动序末步：sweepOrphans（runId 标记＋启动清扫） */
  sweepOrphans(): void | Promise<void>;
  /** 退出序：dispose（在跑树 killTree＋复查） */
  dispose(): void | Promise<void>;
}

/** 五服务构造注入位合集（缺省=该服务的启动/退出步跳过，T4-15~T4-20 逐卡填入） */
export interface MainServiceSlots {
  storage?: StorageServiceSlot;
  vault?: SecretVaultSlot;
  cdp?: CdpSessionManagerSlot;
  cron?: CronSchedulerSlot;
  sandbox?: SandboxExecutorSlot;
}
