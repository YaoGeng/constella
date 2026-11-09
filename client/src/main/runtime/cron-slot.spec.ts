// CronScheduler → CronSchedulerSlot 装配接线（T4-19 / TDD-C-M1 §3 生命周期段——
// AppRuntime 启动序步骤 8 start（提取 trigger.cron＋missed 检测）／退出序首步 stop
//（刷 lastAliveAt）；cron:fired 到点恰推一次经 IpcGateway m→r 推送面到主窗 webContents；
// settings KV 经 main/vault/settings-kv.ts 先例〔main 内直调注入〕——生产组合根 index.ts
// 接线随 T4-20 组收尾，cdp/vault/sandbox 同先例）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { AppRuntime } from './app-runtime';
import { createMockElectron } from './testing/mock-electron';
import type { MainServiceSlots } from './service-slots';
import { createDaoSettingsKv } from '../vault/settings-kv';
import { CronScheduler, registerCronChannels } from '../cron';

const RENDERER_DIR = 'C:\\mock-app\\dist\\renderer';
const PRELOAD_PATH = 'C:\\mock-app\\dist\\preload\\index.js';

/** 局部时间（五段式=本地墙钟） */
function at(y: number, m0: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m0, d, h, min, s);
}

/** 真 settings KV 适配（vault/settings-kv.ts 先例——StorageDao.settings 最小 stub，JSON 落 Map） */
function makeDaoSettingsKvStub(): { kv: ReturnType<typeof createDaoSettingsKv>; rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const dao = {
    settings: {
      getAll: () => Object.fromEntries([...rows].map(([k, v]) => [k, JSON.parse(v)])),
      set: (key: string, value: unknown) => void rows.set(key, JSON.stringify(value)),
    },
  };
  return { kv: createDaoSettingsKv(dao as never), rows };
}

describe('CronScheduler 装配接线（service-slots CronSchedulerSlot）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('startup 步骤 8 start（提取 trigger.cron＋写 lastAliveAt）→ 到点恰推一次 cron:fired → shutdown 首步 stop 刷 lastAliveAt', async () => {
    vi.setSystemTime(at(2026, 10, 9, 19, 59, 30)); // 20:00 边界前 30s
    const mock = createMockElectron([]);
    const { kv, rows } = makeDaoSettingsKvStub();
    const scheduler = new CronScheduler({ settings: kv });

    // 装配接线：slot start=通道挂载＋start(flows)（flows 注入读——生产=T4-20 经 StorageService）
    const runtime = new AppRuntime({
      electron: mock.api,
      rendererDir: RENDERER_DIR,
      preloadPath: PRELOAD_PATH,
      services: {
        cron: {
          start: () => {
            registerCronChannels(scheduler, runtime.ipc);
            // 到点恰推一次 cron:fired（m→r：onFired 事件 → IpcGateway.send——fire-and-forget，
            // 主窗未就绪静默丢弃；不自行 startRun，闸在 renderer RunGate）
            scheduler.onFired((flowId) => {
              runtime.ipc.send(IPC_CHANNELS.cronFired, { flowId } satisfies { flowId: string });
            });
            scheduler.start([{ id: 'f9', nodes: [{ type: 'trigger.cron', params: { cron: '0 20 * * *' } }] }]);
          },
          stop: () => scheduler.stop(),
        },
      } satisfies MainServiceSlots,
    });
    await runtime.startup();
    try {
      // start(flows) 已提取注册；启动写 lastAliveAt（ISO 字符串，经真 settings-kv 适配落 KV）
      expect(scheduler.scheduledFlowIds).toEqual(['f9']);
      expect(JSON.parse(rows.get('cron.lastAliveAt') as string)).toBe(
        at(2026, 10, 9, 19, 59, 30).toISOString(),
      );

      // 通道已挂载（r→m 半段经真 IpcGateway）：cron:upsert 往返
      await expect(
        mock.ipcMain.invoke(IPC_CHANNELS.cronUpsert, { flowId: 'f2', cron: '*/5 * * * *' }),
      ).resolves.toEqual({ ok: true });

      // 到点恰推一次 cron:fired（m→r：IpcGateway.send → 主窗 webContents；f2=*/5 同 tick
      // 各自恰一次——断言面按 flowId 分流）
      const mainWindow = mock.createdWindows[0]!; // startup 已建主窗（守卫后断言——config-yaml 先例）
      const firedOf = (flowId: string) =>
        mainWindow.webContents.sent.filter(
          (m) => m.channel === IPC_CHANNELS.cronFired && (m.args[0] as { flowId?: string })?.flowId === flowId,
        );
      vi.advanceTimersByTime(60_000); // 20:00:30 tick → due
      expect(firedOf('f9')).toEqual([{ channel: IPC_CHANNELS.cronFired, args: [{ flowId: 'f9' }] }]);
      vi.advanceTimersByTime(120_000); // 跨过非边界分钟——恰一次不再推
      expect(firedOf('f9')).toHaveLength(1);

      // 退出序首步 stop：刷 lastAliveAt=now、停 tick
      const beforeQuit = at(2026, 10, 9, 20, 3, 30).getTime();
      vi.setSystemTime(beforeQuit);
      await runtime.shutdown();
      expect(JSON.parse(rows.get('cron.lastAliveAt') as string)).toBe(
        at(2026, 10, 9, 20, 3, 30).toISOString(),
      );
      vi.advanceTimersByTime(60 * 60_000); // 已停——次日边界前不再推
      expect(firedOf('f9')).toHaveLength(1);
      expect(firedOf('f2')).toHaveLength(1); // stop 后无新增（f2 在 20:00:30 已恰推一次）
    } finally {
      await runtime.shutdown().catch(() => undefined);
    }
  });
});
