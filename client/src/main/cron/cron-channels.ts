// cron:upsert / cron:cancel 通道 handler（T4-19 / TDD-C-M1 §1 矩阵 Cron 行）。
//
// 语义冻结（§1 矩阵）：
//   cron:upsert   r→m  {flowId,cron} → {ok}（注册/同 flowId 覆盖；表达式=标准五段式，X-18）
//                       非法形 → CRON-INVALID-EXPR（CronInvalidExprError throw→IpcGateway
//                       序列化 {code,message} reject）；payload 形状 → VALIDATION-FAILED
//                       （IpcGateway/payload-schemas 通道面——T4-14 既有，本文件不重叠）
//   cron:cancel   r→m  {flowId} → {ok}（幂等 in-band——未注册亦 ok，非 reject）
//
// 注册面：InvokeRegistry（缺省 AppRuntime.ipc〔IpcGateway，T4-14〕；AppRuntimeDeps.
// invokeRegistry 测试注入缝——SecretVault/Cdp init 同形先例）。
import {
  IPC_CHANNELS,
  type CronCancelReq,
  type CronCancelRes,
  type CronUpsertReq,
  type CronUpsertRes,
} from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';
import type { CronScheduler } from './cron-scheduler';

/** 通道面消费的 CronScheduler 子集 */
export type CronSchedulerChannelFace = Pick<CronScheduler, 'upsert' | 'cancel'>;

/** 注册 cron 域两通道（装配层调用——重复注册由 IpcGateway 拒绝） */
export function registerCronChannels(scheduler: CronSchedulerChannelFace, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.cronUpsert, (payload) => {
    const req = payload as CronUpsertReq; // 形状已过 payload-schemas（T4-14 通道面）
    scheduler.upsert(req.flowId, req.cron);
    return { ok: true } satisfies CronUpsertRes;
  });
  registry.handle(IPC_CHANNELS.cronCancel, (payload) => {
    const req = payload as CronCancelReq;
    scheduler.cancel(req.flowId);
    return { ok: true } satisfies CronCancelRes; // 幂等 in-band
  });
}
