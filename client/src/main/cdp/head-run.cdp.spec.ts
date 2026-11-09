// CdpSessionManager electron 真头跑（T4-18 验收=TDD-C-M1 §6.2a~d；S-3 判据同口径）。
//
// 真件全链：真 electron 二进制（S-3 工程链）＋CdpSessionManager（真 BrowserWindow/
// webContents.debugger）＋CdpBridge（真 ws）＋CdpPortPool（真探活）＋IpcGateway（真 ipcMain.handle
// 注册——cdp:* 通道 mock 解除冒烟，T4-06 备注项）。桥帧经真 ws 连接驱动。
//
// 阶段：A（双 partition 隔离→坑②回归→probe/laneMemory/listSessions→openViewer）→
// B（同 userData 新进程：跨进程落盘＋坑③显式 expires）→ C（端口池注入耗尽）。
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import type { CreateSessionRes, ListSessionsRes } from '@constella/shared/ipc';
import { launchHeadRun, removeDir, type HeadRunHandle } from './testing/head-run-harness';

const TEST_TIMEOUT = 90_000;
/** 含「quit 旧实例＋冷启动新实例」两段预算的用例（跨进程/耗尽） */
const PHASE_TEST_TIMEOUT = 180_000;
const HOOK_TIMEOUT = 150_000;
/** 本套件端口子段（9221–9260；与 t4-05 补跑套件 9261–9300 不相交——并行 vitest worker 下
 *  两 electron 同抢 9221 起段会互踩〔实测 connect 超时〕；均在 lane 段 9221–9320 内，02 §3.2） */
const POOL_RANGE = { first: 9221, last: 9260 };

/** 真桥 ws 客户端（cdp 帧驱动——Network.setCookie/getCookies/Runtime.evaluate）。
 *  socket 在 connect() 内惰性创建＋同步挂监听（构造即连会漏先于挂监听完成的 open——实测竞态）。 */
function makeBridgeClient(port: number) {
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextId = 1;
  let ws: WebSocket;
  const failAll = (reason: string): void => {
    for (const w of pending.values()) w.reject(new Error(reason));
    pending.clear();
  };
  return {
    connect(): Promise<void> {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const opened = new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
        setTimeout(() => reject(new Error(`bridge connect 超时（15s）：port ${port}`)), 15_000).unref?.();
      });
      ws.on('close', () => failAll(`bridge 连接关闭：port ${port}`));
      ws.on('error', () => failAll(`bridge 连接错误：port ${port}`));
      ws.on('message', (data) => {
        const frame = JSON.parse(String(data)) as {
          id: number;
          ok: boolean;
          result?: unknown;
          error?: { code: string; message: string };
        };
        const waiter = pending.get(frame.id);
        if (waiter === undefined) return;
        pending.delete(frame.id);
        if (frame.ok) waiter.resolve(frame.result);
        else waiter.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
      });
      return opened;
    },
    send(method: string, params: Record<string, unknown>): Promise<unknown> {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, ns: 'cdp', method, params }));
      });
    },
    close(): void {
      ws?.close();
    },
  };
}

const EXPIRES_AT = () => Math.floor(Date.now() / 1000) + 86_400; // 坑③：显式 expires（spike 同源 1 天）

const tempDirs: string[] = [];
let phaseA: HeadRunHandle;
let phaseB: HeadRunHandle;
let phaseC: HeadRunHandle;
const holders: net.Server[] = [];

async function occupy(port: number): Promise<void> {
  const srv = net.createServer();
  holders.push(srv);
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', resolve);
  });
}

async function createLane(
  h: HeadRunHandle,
  laneKey: string,
  label: string,
): Promise<CreateSessionRes> {
  const res = await h.invoke<CreateSessionRes>(IPC_CHANNELS.cdpCreateSession, {
    runId: 'r-1',
    laneKey,
    label,
    startUrl: `${h.origin}/`,
  });
  if (!res.ok || res.result === undefined) throw new Error(`createSession 失败：${JSON.stringify(res.error)}`);
  return res.result;
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constella-cdp-head-a-'));
  tempDirs.push(dir);
  phaseA = await launchHeadRun('cdp-a', { userData: dir, poolRange: POOL_RANGE });
}, HOOK_TIMEOUT);

afterAll(async () => {
  for (const h of [phaseA, phaseB, phaseC]) {
    if (h !== undefined) await h.quit().catch(() => undefined);
  }
  await Promise.all(holders.map((s) => new Promise<void>((r) => s.close(() => r()))));
  await Promise.all(tempDirs.map((d) => removeDir(d)));
}, HOOK_TIMEOUT);

describe('CdpSessionManager electron 真头跑（TDD-C-M1 §6.2a~d）', () => {
  it('真通道注册冒烟：cdp:* 五通道＋env:cdpProbe 挂真 ipcMain.handle（T4-06 mock 解除前提）', () => {
    expect(phaseA.channels).toEqual(
      expect.arrayContaining([
        IPC_CHANNELS.cdpCreateSession,
        IPC_CHANNELS.cdpNavigate,
        IPC_CHANNELS.cdpListSessions,
        IPC_CHANNELS.cdpOpenViewer,
        IPC_CHANNELS.cdpDestroyRun,
        IPC_CHANNELS.envCdpProbe,
      ]),
    );
  }, TEST_TIMEOUT);

  it('§6.2a 双 partition cookie 隔离（S-3 判据 1：CDP 写入互不可见＋页面侧交叉验证）', async () => {
    const laneA = await createLane(phaseA, 'n-jia', '甲'); // partition=persist:flow-of-r-1·甲（含·中文）
    const laneB = await createLane(phaseA, 'n-yi', '乙');
    expect(laneA.partition).toBe('persist:flow-of-r-1·甲');
    expect(laneB.partition).toBe('persist:flow-of-r-1·乙');

    const clientA = makeBridgeClient(laneA.port);
    const clientB = makeBridgeClient(laneB.port);
    await clientA.connect();
    await clientB.connect();
    try {
      const cookieBase = { name: 't418probe', url: `${phaseA.origin}/`, expires: EXPIRES_AT() };
      const setA = (await clientA.send('Network.setCookie', { ...cookieBase, value: 'a-value' })) as {
        success: boolean;
      };
      const setB = (await clientB.send('Network.setCookie', { ...cookieBase, value: 'b-value' })) as {
        success: boolean;
      };
      expect(setA.success).toBe(true);
      expect(setB.success).toBe(true);
      // 坑③对照组：不带 expires 的会话 cookie（跨进程即失——phase B 断言）
      await clientA.send('Network.setCookie', { name: 't418session', value: 'session-only', url: `${phaseA.origin}/` });

      const cookiesOf = async (c: ReturnType<typeof makeBridgeClient>): Promise<string[]> => {
        const r = (await c.send('Network.getCookies', { urls: [phaseA.origin] })) as {
          cookies: Array<{ name: string; value: string }>;
        };
        return r.cookies.filter((c2) => c2.name === 't418probe').map((c2) => c2.value);
      };
      expect(await cookiesOf(clientA)).toEqual(['a-value']);
      expect(await cookiesOf(clientB)).toEqual(['b-value']);

      const docCookie = async (c: ReturnType<typeof makeBridgeClient>): Promise<string> => {
        const r = (await c.send('Runtime.evaluate', {
          expression: 'document.cookie',
          returnByValue: true,
        })) as { result: { value: string } };
        return r.result.value;
      };
      const dcA = await docCookie(clientA);
      const dcB = await docCookie(clientB);
      expect(dcA).toContain('a-value');
      expect(dcA).not.toContain('b-value');
      expect(dcB).toContain('b-value');
      expect(dcB).not.toContain('a-value');
    } finally {
      clientA.close();
      clientB.close();
    }
  }, TEST_TIMEOUT);

  it('§6.2b 坑②回归：destroyRun 后窗口数归零（window-all-closed 覆盖下 app 存活）→新建窗口导航成功', async () => {
    const res = await phaseA.invoke(IPC_CHANNELS.cdpDestroyRun, { runId: 'r-1' });
    expect(res.ok).toBe(true);
    const { count } = await phaseA.control<{ count: number }>('windowCount');
    expect(count).toBe(0); // 全部 lane 窗销毁——T4-13 覆盖保证 app 未退
    // 新建窗口导航成功（S-3 发现 2：无覆盖时此处 ERR_FAILED/-2）
    const lane = await createLane(phaseA, 'n-bing', '丙');
    const client = makeBridgeClient(lane.port);
    await client.connect();
    try {
      const r = (await client.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      })) as { result: { value: string } };
      expect(r.result.value).toBe('t418-cdp-target'); // 导航已生效（坑①：attach 后先导航）
    } finally {
      client.close();
    }
  }, TEST_TIMEOUT);

  it('env:cdpProbe/listSessions/laneMemory 真通道（B-9 附栈探活＋台账投影＋内存数据源）', async () => {
    const probe = await phaseA.invoke<{ ok: boolean; detail?: string }>(IPC_CHANNELS.envCdpProbe, {});
    expect(probe.ok).toBe(true);
    expect(probe.result).toEqual({ ok: true });

    const list = await phaseA.invoke<ListSessionsRes>(IPC_CHANNELS.cdpListSessions, { runId: 'r-1' });
    expect(list.result).toEqual([{ laneKey: 'n-bing', label: '丙', port: expect.any(Number), url: `${phaseA.origin}/` }]);

    const mem = await phaseA.control<{ lanes: Array<{ laneKey: string; workingSetBytes: number }> }>('laneMemory');
    expect(mem.lanes).toHaveLength(1);
    expect(mem.lanes[0]!.laneKey).toBe('n-bing');
    expect(mem.lanes[0]!.workingSetBytes).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('cdp:openViewer 真通道：查看窗打开，同 laneKey 再点置顶不开新窗（A-8.2/T4-13 原语）', async () => {
    const first = await phaseA.invoke(IPC_CHANNELS.cdpOpenViewer, { runId: 'r-1', laneKey: 'n-bing' });
    expect(first.ok).toBe(true);
    expect((await phaseA.control<{ count: number }>('viewerCount')).count).toBe(1);
    const again = await phaseA.invoke(IPC_CHANNELS.cdpOpenViewer, { runId: 'r-1', laneKey: 'n-bing' });
    expect(again.ok).toBe(true);
    expect((await phaseA.control<{ count: number }>('viewerCount')).count).toBe(1); // 置顶复用
  }, TEST_TIMEOUT);

  it('§6.2a 跨进程落盘＋§6.2c 坑③：显式 expires cookie 新进程仍在、会话 cookie 已失', async () => {
    await phaseA.quit();
    const dir = tempDirs[0]!; // 同 userData——partition persist 落盘判据
    phaseB = await launchHeadRun('cdp-b', { userData: dir, poolRange: POOL_RANGE });
    const laneA = await createLane(phaseB, 'n-jia', '甲'); // 同 label→同 partition
    const laneB = await createLane(phaseB, 'n-yi', '乙');
    const clientA = makeBridgeClient(laneA.port);
    const clientB = makeBridgeClient(laneB.port);
    await clientA.connect();
    await clientB.connect();
    try {
      const cookiesOf = async (c: ReturnType<typeof makeBridgeClient>): Promise<Record<string, string>> => {
        const r = (await c.send('Network.getCookies', { urls: [phaseB.origin] })) as {
          cookies: Array<{ name: string; value: string }>;
        };
        return Object.fromEntries(r.cookies.map((c2) => [c2.name, c2.value]));
      };
      const a = await cookiesOf(clientA);
      const b = await cookiesOf(clientB);
      expect(a.t418probe).toBe('a-value'); // 显式 expires 跨进程存活（坑③）
      expect(b.t418probe).toBe('b-value');
      expect(a.t418session).toBeUndefined(); // 无 expires=会话 cookie，进程退出即失（坑③对照）
    } finally {
      clientA.close();
      clientB.close();
    }
  }, PHASE_TEST_TIMEOUT);

  it('§6.2d 端口池注入耗尽→CDP-PORT-EXHAUSTED（detail 含 lane 收敛提示，N7；真通道 reject 形）', async () => {
    await phaseB.quit();
    await occupy(9221); // 注入耗尽：两口全被外部占用
    await occupy(9222);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constella-cdp-head-c-'));
    tempDirs.push(dir);
    phaseC = await launchHeadRun('cdp-c', { userData: dir, poolRange: { first: 9221, last: 9222 } });
    const res = await phaseC.invoke(IPC_CHANNELS.cdpCreateSession, {
      runId: 'r-1',
      laneKey: 'n-1',
      label: '耗尽',
      startUrl: `${phaseC.origin}/`,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('CDP-PORT-EXHAUSTED');
    expect(res.error?.message).toContain('lane'); // 收敛并行 lane 数提示
  }, PHASE_TEST_TIMEOUT);
});
