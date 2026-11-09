// cron:upsert / cron:cancel 通道规格（T4-19 / TDD-C-M1 §1 矩阵 Cron 行——经真 IpcGateway
// 〔T4-14：payload 校验＋{code,message} 序列化〕+ MockIpcMain 走完整 r→m 半段）。
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { IpcGateway } from '../ipc/ipc-gateway';
import { MockIpcMain } from '../runtime/testing/mock-electron';
import { CronScheduler, type CronSettingsKv } from './cron-scheduler';
import { registerCronChannels } from './cron-channels';

function makeScheduler(now?: () => number): { scheduler: CronScheduler; rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const kv: CronSettingsKv = {
    get: (key) => (rows.has(key) ? (JSON.parse(rows.get(key) as string) as unknown) : null),
    set: (key, value) => void rows.set(key, JSON.stringify(value)),
  };
  return { scheduler: new CronScheduler({ settings: kv, ...(now !== undefined ? { now } : {}) }), rows };
}

/** 真 IpcGateway 基座（payload 校验+错误序列化即生产路径） */
function makeGateway(): { gateway: IpcGateway; ipcMain: MockIpcMain } {
  const ipcMain = new MockIpcMain();
  const gateway = new IpcGateway({ ipcMain });
  return { gateway, ipcMain };
}

describe('cron:upsert 通道（注册/同 flowId 覆盖；CRON-INVALID-EXPR）', () => {
  it('合法表达式 → {ok:true} 且注册生效（nextFire 可见）', async () => {
    const { scheduler } = makeScheduler(() => new Date(2026, 10, 9, 14, 0, 0).getTime());
    const { gateway, ipcMain } = makeGateway();
    registerCronChannels(scheduler, gateway);

    const res = await ipcMain.invoke(IPC_CHANNELS.cronUpsert, { flowId: 'f1', cron: '0 20 * * *' });
    expect(res).toEqual({ ok: true });
    expect(scheduler.nextFire('f1')?.getTime()).toBe(new Date(2026, 10, 9, 20, 0, 0).getTime());
    scheduler.stop();
  });

  it('非法表达式 61 * * * * → reject {code:CRON-INVALID-EXPR}（§6.3a 通道面）且不注册', async () => {
    const { scheduler } = makeScheduler();
    const { gateway, ipcMain } = makeGateway();
    registerCronChannels(scheduler, gateway);

    await expect(ipcMain.invoke(IPC_CHANNELS.cronUpsert, { flowId: 'f1', cron: '61 * * * *' })).rejects.toMatchObject(
      { code: 'CRON-INVALID-EXPR' },
    );
    expect(scheduler.scheduledFlowIds).toEqual([]);
    scheduler.stop();
  });

  it('payload 形状非法（缺 cron）→ VALIDATION-FAILED（IpcGateway 通道面——本卡不重叠）', async () => {
    const { scheduler } = makeScheduler();
    const { gateway, ipcMain } = makeGateway();
    registerCronChannels(scheduler, gateway);

    await expect(ipcMain.invoke(IPC_CHANNELS.cronUpsert, { flowId: 'f1' })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
    scheduler.stop();
  });
});

describe('cron:cancel 通道（幂等 in-band）', () => {
  it('注册后取消 → {ok:true}；重复取消/未注册取消 → 仍 {ok:true}（幂等不 reject）', async () => {
    const { scheduler } = makeScheduler();
    const { gateway, ipcMain } = makeGateway();
    registerCronChannels(scheduler, gateway);
    scheduler.upsert('f1', '0 20 * * *');

    expect(await ipcMain.invoke(IPC_CHANNELS.cronCancel, { flowId: 'f1' })).toEqual({ ok: true });
    expect(scheduler.nextFire('f1')).toBeNull();
    expect(await ipcMain.invoke(IPC_CHANNELS.cronCancel, { flowId: 'f1' })).toEqual({ ok: true });
    expect(await ipcMain.invoke(IPC_CHANNELS.cronCancel, { flowId: 'unknown' })).toEqual({ ok: true });
    scheduler.stop();
  });
});
