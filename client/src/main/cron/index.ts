// main/cron 域导出面（T4-19 / TDD-C-M1 §3 CronScheduler·CronParser·MissedFireDetector
// 三组件＋cron:upsert/cancel 通道挂载）。
// 消费方：AppRuntime 装配（service-slots CronSchedulerSlot——组合根生产接线随 T4-20 组收尾，
// 同 cdp/vault/sandbox 先例）；renderer 对端=T4-01 RunEngine cron:fired 消费（三闸复查后
// startRun——本域只负责到点恰推一次，不自行 startRun）。
export {
  CronInvalidExprError,
  CronParser,
  type CronParseInvalid,
  type CronParseOk,
  type CronParseResult,
  type CronSchedule,
} from './cron-parser';
export {
  MISSED_FIRE_CAP_PER_FLOW,
  MissedFireDetector,
  type MissedFire,
  type MissedFireDetectorDeps,
  type MissedFireSchedule,
} from './missed-fire-detector';
export {
  CRON_LAST_ALIVE_AT_KEY,
  CRON_TICK_MS,
  CronScheduler,
  extractCronTriggers,
  type CronFlowSource,
  type CronSchedulerDeps,
  type CronSettingsKv,
} from './cron-scheduler';
export { registerCronChannels, type CronSchedulerChannelFace } from './cron-channels';
