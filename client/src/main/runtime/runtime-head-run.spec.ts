// T4-20 组收尾一：AppRuntime 启动/退出全序 electron 头跑集成冒烟（TDD-C-M1 §3 生命周期段）。
//
// 真件全链＝生产装配同构（production-assembly.ts 单一来源——main/index.ts 同函数）：
// 真 electron＋真 StorageLayer（better-sqlite3）＋safeStorage＋真 BrowserWindow/debugger＋
// CdpBridge（真 ws）＋CronScheduler（真 tick＋假钟注入缝）＋SandboxExecutor（真 esbuild 转译
// ＋electron-as-node 子进程）。dist 缺陷修复（T4-04 bundle shared）后首跑回归。
//
// 断言面：
//   1) 启动全序（§3 生命周期段）：storage.init→vault.init→cdp.init→net.init→cron.start→
//      sweepOrphans（T5-12a 五步→六步：net.init=cdp.init 后、主窗加载 renderer 前——PM 缺省②）
//      ＋主窗在位＋21 通道真注册（storage:invoke/zip:* 在列）；
//   2) 真通道冒烟：storage:invoke 往返／未知 op→IPC-UNKNOWN-OP／zip:export stub→ZIP-WRITE-FAILED；
//   3) T4-19 对端联测：cron:fired 真推送→renderer RunGate 三闸复查→startRun（真
//      flows.get/runs.create/logs 落库往返）；脏闸拒绝→不产生 run＋err 日志；
//   4) 退出全序：cron.stop→sandbox.dispose（killTree——挂起子进程 pid DEAD）→net.dispose
//      （T5-12a：sandbox.dispose 后、cdp.destroyAllLaneWindows 前——PM 缺省②）→
//      cdp.destroyAllLaneWindows（lane 窗销毁保主窗）→storage.close（WAL checkpoint——进程
//      退出后 -wal 文件不残留）。
//
// 端口段：9301–9320（与 §6.2 套件 9221–9260／T4-05 补跑 9261–9300 错段——并行 vitest worker
// 并发竞态登记项〔T4-06 🔵/T4-18 域〕处置留痕：段内错开，均在 lane 段 9221–9320 内）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS, type FlowDoc } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { createStorageClient } from '../../renderer/storage/storage-client';
import { createRunEngine, type RunEngine } from '../../renderer/run/run-engine';
import type { RunRegistryLike, RunTransport } from '../../renderer/run/types';
import { launchHeadRun, removeDir, type HeadRunHandle } from '../cdp/testing/head-run-harness';

const TEST_TIMEOUT = 90_000;
const HOOK_TIMEOUT = 200_000;
/** 本套件端口子段（9301–9320——见文件头留痕） */
const POOL_RANGE = { first: 9301, last: 9320 };

let head: HeadRunHandle;
const tempDirs: string[] = [];
let userData: string;

beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'constella-runtime-head-'));
  tempDirs.push(userData);
  head = await launchHeadRun('t420-runtime', {
    userData,
    poolRange: POOL_RANGE,
    entry: '../../runtime/testing/app-head-run-main.ts', // 相对 cdp/testing（harness 定位基准）
    externals: ['better-sqlite3', 'esbuild'], // 原生模块/spawn 期转译服务——运行期自 node_modules 解析
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  await head?.quit().catch(() => undefined);
  await Promise.all(tempDirs.map((d) => removeDir(d)));
}, HOOK_TIMEOUT);

/** 控制面 invoke 的通道往返（{ok,result}|{ok:false,error}——与生产同一校验/序列化链） */
async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<{ ok: boolean; result?: T; error?: { code: string; message: string } }> {
  return head.invoke(channel, payload);
}

/** main 侧真 storage 面（renderer 半段封装——经真通道往返） */
function storageOverChannel() {
  return createStorageClient({
    invoke: async (req) => {
      const r = await head.invoke(IPC_CHANNELS.storageInvoke, req);
      if (!r.ok) throw Object.assign(new Error(r.error?.message ?? 'storage invoke 失败'), r.error);
      return r.result;
    },
  });
}

describe('T4-20 组收尾一：启动全序（§3 生命周期段——生产装配同构头跑）', () => {
  it('生命周期六步恰序：storage.init→vault.init→cdp.init→net.init→cron.start→sandbox.sweepOrphans＋主窗在位', async () => {
    // T5-12a 改动留痕：五步断言→六步（net.init 插 cdp.init 后、主窗加载 renderer 前——PM 缺省②）
    const { steps } = await head.control<{ steps: string[] }>('steps');
    expect(steps).toEqual([
      'storage.init',
      'vault.init',
      'cdp.init',
      'net.init',
      'cron.start',
      'sandbox.sweepOrphans',
    ]);
    const { count } = await head.control<{ count: number }>('windowCount');
    expect(count).toBeGreaterThanOrEqual(1); // 主窗（renderer 产物缺省不拦启动）
  }, TEST_TIMEOUT);

  it('21 r→m 通道真注册（IpcGateway 全量——storage:invoke/zip:* 在列；§6.6 运行时半段）', async () => {
    const { channels } = await head.control<{ channels: string[] }>('channels');
    expect([...channels].sort()).toEqual([...IPC_INVOKE_CHANNELS].sort());
  }, TEST_TIMEOUT);

  it('真通道冒烟：flows.list 往返（种子流程）／definitions=21（T5-08 示例预装联跑收口）／未知 op→IPC-UNKNOWN-OP／zip:export stub→ZIP-WRITE-FAILED', async () => {
    const ok = await invoke<{ items: unknown[] }>(IPC_CHANNELS.storageInvoke, { op: 'flows.list' });
    expect(ok.ok).toBe(true);
    expect((ok.result?.items ?? []).length).toBeGreaterThanOrEqual(9); // f1~f9 种子（T1-03）

    // T5-08 联跑收口（真装配链 exampleAssetsDir 已注入）：open 完成态 definitions=21
    // （12 builtin＋9 示例——C-06 §6.1d 口径；此前无既有断言假设 12，计数首冻结为 21）
    const defs = await invoke<unknown[]>(IPC_CHANNELS.storageInvoke, { op: 'definitions.loadAll' });
    expect(defs.ok).toBe(true);
    expect((defs.result ?? []).length).toBe(21);

    const unknown = await invoke(IPC_CHANNELS.storageInvoke, { op: 'nope.nope' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('IPC-UNKNOWN-OP');

    const zipStub = await invoke(IPC_CHANNELS.zipExport, { flowId: 'f1', savePath: 'C:\\a.zip' });
    expect(zipStub.ok).toBe(false);
    expect(zipStub.error?.code).toBe('ZIP-WRITE-FAILED');
  }, TEST_TIMEOUT);
});

describe('T4-19 对端联测：cron:fired 真推送→RunGate 三闸复查→startRun（真库往返）', () => {
  let engine: RunEngine;
  const storage = storageOverChannel();

  /** registry：真 definitions.loadAll（真通道）——触发判定/broken 面真数据源 */
  let registry: RunRegistryLike;

  /** fires 观察轮询（main 真 CronScheduler tick→onFired→IpcGateway.send cron:fired 真推送） */
  async function waitFires(minCount: number, deadlineMs: number): Promise<Array<{ flowId: string }>> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const { fires } = await head.control<{ fires: Array<{ flowId: string }> }>('fires');
      if (fires.length >= minCount) return fires;
      if (Date.now() > deadline) throw new Error(`cron fire 等待超时（期望≥${minCount}，实际 ${fires.length}）`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  beforeAll(async () => {
    const defs = (await storage.invoke('definitions.loadAll', undefined)) as NodeDefinition[];
    registry = {
      get: (type) => defs.find((d) => d.type === type),
      isBroken: () => false,
    };
  }, TEST_TIMEOUT);

  it('注册两流程（净/脏）→ 到点双 fire → 净流程 startRun（runs 落库）／脏闸拒绝不产生 run＋err 日志', async () => {
    // 1) 两流程经真通道落库（trigger.cron＋data.transform——种子定义 FK 齐；节点 id 全局 PK，
    //    两流程各用独立 id 段——nodes.id 无 flow 前缀，撞名即 UNIQUE 违例）
    const docOf = (name: string, tag: string): FlowDoc => ({
      name,
      nodes: [
        {
          id: `t-${tag}`,
          type: 'trigger.cron',
          name: '定时',
          position: { x: 0, y: 0 },
          params: { cron: '* * * * *' },
        },
        { id: `a-${tag}`, type: 'data.transform', name: '加工', position: { x: 1, y: 1 }, params: { expr: 'x' } },
      ],
      edges: [{ id: `t-${tag}--a-${tag}`, from: [`t-${tag}`, 'out'], to: [`a-${tag}`, 'in'] }],
    });
    const cleanFlow = await storage.invoke('flows.create', { name: '联测净流程' });
    await storage.invoke('flows.save', { id: cleanFlow.id, ...docOf('联测净流程', 'clean'), label: '手动保存' });
    const dirtyFlow = await storage.invoke('flows.create', { name: '联测脏流程' });
    await storage.invoke('flows.save', { id: dirtyFlow.id, ...docOf('联测脏流程', 'dirty'), label: '手动保存' });

    // 2) renderer RunEngine（test 进程——t4-05 先例：renderer 消费面替身；storage=真通道往返）
    const seenFireFlowIds: string[] = [];
    const transport: RunTransport = {
      onCronFired: (fn) => {
        void (async () => {
          // 轮询 main 侧 fires 台账（真推送观察位——gateway.send 面在生产装配内）
          for (;;) {
            const { fires } = await head.control<{ fires: Array<{ flowId: string }> }>('fires');
            for (const f of fires) {
              if (seenFireFlowIds.includes(f.flowId)) continue;
              seenFireFlowIds.push(f.flowId);
              fn({ flowId: f.flowId });
            }
            await new Promise((r) => setTimeout(r, 100));
          }
        })();
        return () => {};
      },
      spawnScript: async () => {
        throw new Error('联测 transport 不 spawn');
      },
      onScriptEvent: () => () => {},
      cdpCreateSession: async () => {
        throw new Error('联测 transport 不建会话');
      },
      cdpNavigate: async () => {
        throw new Error('联测 transport 不导航');
      },
      killScript: async () => ({ ok: true }),
      cdpDestroyRun: async () => ({ ok: true }),
      envCdpProbe: async () => ({ ok: false, detail: '联测不探活' }),
    };
    engine = createRunEngine({
      storage,
      registry,
      guardDirty: (flowId) => flowId === dirtyFlow.id, // 脏闸（三闸之首）
      transport,
    });

    // 3) 真通道注册两流程 cron（每分钟——假钟推进即到点）
    await expect(
      invoke(IPC_CHANNELS.cronUpsert, { flowId: cleanFlow.id, cron: '* * * * *' }),
    ).resolves.toMatchObject({ ok: true, result: { ok: true } });
    await expect(
      invoke(IPC_CHANNELS.cronUpsert, { flowId: dirtyFlow.id, cron: '* * * * *' }),
    ).resolves.toMatchObject({ ok: true, result: { ok: true } });

    // 4) 假钟推到下一分钟边界＋1s（deps.now 注入缝——真 tick 100ms 扫表）
    const { at } = await head.control<{ at: number | null }>('nextFire', { flowId: cleanFlow.id });
    expect(at).not.toBeNull();
    await head.control('clockSet', { ms: at! + 1_000 });

    // 5) 双 fire 恰各一次（真 CronScheduler tick→恰推一次）
    const fires = await waitFires(2, 15_000);
    const firedIds = fires.map((f) => f.flowId).sort();
    expect(firedIds).toEqual([cleanFlow.id, dirtyFlow.id].sort());

    // 6) startRun 生效等待：净流程 run 落库（真 runs.create 往返）
    const deadline = Date.now() + 15_000;
    let cleanRunSeen = false;
    for (;;) {
      const runs = await storage.invoke('runs.list', undefined);
      cleanRunSeen = runs.items.some((r) => r.flowId === cleanFlow.id);
      if (cleanRunSeen || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(cleanRunSeen, '净流程 cron 触发应产生 run（RunGate 三闸放行→startRun）').toBe(true);

    // 7) 脏闸拒绝：脏流程不产生 run（fire 静默不产生 run——A-6.6）＋err 日志
    const runs = await storage.invoke('runs.list', undefined);
    expect(runs.items.some((r) => r.flowId === dirtyFlow.id)).toBe(false);
    const logs = await storage.invoke('logs.list', { limit: 200 });
    expect(
      logs.some((l) => l.flowId === dirtyFlow.id && l.level === 'err' && l.msg.includes('先保存再运行')),
    ).toBe(true);
  }, 180_000);

  afterAll(() => {
    engine?.dispose();
  });
});

describe('T4-20 组收尾一：退出全序（killTree＋销毁 lane 窗＋WAL checkpoint）', () => {
  it('lane 会话窗在位→挂起脚本 spawn→pid 存活；shutdownNow 全序恰五步（T5-12a 四步→五步：net.dispose）＋pid DEAD＋lane 窗销毁保主窗', async () => {
    // 0) 真 run 行（生产 flowIdOfRun=runs DAO 直查——会话须在 run 建立后，RUN-NOT-FOUND 透传语义）
    const storage = storageOverChannel();
    const flow = await storage.invoke('flows.create', { name: '退出序冒烟' });
    const run = await storage.invoke('runs.create', { flowId: flow.id, name: '退出序冒烟run' });

    // 1) 真 cdp:createSession（隐藏 lane 窗＋attach＋lane 桥端口；partition=flow 粒度）
    const lane = await invoke<{ ok: boolean; port: number; partition: string }>(IPC_CHANNELS.cdpCreateSession, {
      runId: run.id,
      laneKey: 'n-smoke',
      label: '冒烟',
      startUrl: `${head.origin}/`,
    });
    expect(lane.ok, `createSession 失败：${JSON.stringify(lane.error)}`).toBe(true);
    expect(lane.result?.partition).toBe(`persist:${flow.id}·冒烟`);
    const beforeWindows = (await head.control<{ count: number }>('windowCount')).count;
    expect(beforeWindows).toBeGreaterThanOrEqual(2); // 主窗＋lane 窗

    // 2) 挂起 ts 脚本真 spawn（esbuild 真转译＋electron-as-node；timeoutMs=0 不武装看门狗）
    const { req } = await head.control<{ req: Record<string, unknown> }>('spawnSmokeReq');
    const spawnRes = await invoke<{ ok: boolean; pid: number }>(IPC_CHANNELS.runSpawnScript, req);
    if (!spawnRes.ok) throw new Error(`spawnScript 失败：${JSON.stringify(spawnRes.error)}`);
    const pid = spawnRes.result?.pid;
    expect(typeof pid).toBe('number');
    expect((await head.control<{ alive: boolean }>('pidAlive', { pid })).alive).toBe(true);

    // 3) 退出全序（AppRuntime.shutdown——before-quit 同方法）：恰五步恰序
    //    （T5-12a 改动留痕：四步→五步——net.dispose 插 sandbox.dispose 后、
    //    cdp.destroyAllLaneWindows 前，PM 缺省②）
    const { steps } = await head.control<{ steps: string[] }>('shutdownNow');
    expect(steps.slice(-5)).toEqual([
      'cron.stop', // 刷 lastAliveAt
      'sandbox.dispose', // 在跑树 killTree＋复查
      'net.dispose', // NetProxyBridge closeAll（T5-12a）
      'cdp.destroyAllLaneWindows', // 销毁 lane 窗（保主窗——S-3 坑②）
      'storage.close', // WAL checkpoint
    ]);

    // 4) killTree 复查：挂起子进程 DEAD（S-4 ① 同口径）
    const aliveChecks = await head.control<{ alive: boolean }>('pidAlive', { pid });
    expect(aliveChecks.alive).toBe(false);
    // 5) lane 窗销毁保主窗（窗口数回落 1）
    const afterWindows = (await head.control<{ count: number }>('windowCount')).count;
    expect(afterWindows).toBe(1);
    // 6) WAL checkpoint：连接已 close（-wal 不再活跃；进程退出后文件面收口见下例）
    const { exists: walExists } = await head.control<{ exists: boolean }>('dbWalExists');
    void walExists; // close 后 sidecar 归档/删除属 SQLite 内部时序——终态断言在进程退出后（下例）
  }, TEST_TIMEOUT);

  it('进程退出后：constella.db 在位且 -wal 不残留（WAL checkpoint 干净收口）', async () => {
    // head.quit：quit 命令（按协议不回帧）→10s 竞速→强杀兜底→等进程退出（harness 语义）
    await head.quit();
    expect(fs.existsSync(path.join(userData, 'constella.db'))).toBe(true);
    expect(fs.existsSync(path.join(userData, 'constella.db-wal'))).toBe(false); // checkpoint 干净收口
  }, TEST_TIMEOUT);
});
