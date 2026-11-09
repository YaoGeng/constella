// T4-05 §6.2 集成段补跑（T4-18 验收「→补跑 T4-05」）：CommandTransport 接 CdpBridge **真端点**复跑。
//
// 六例（TDD-C-04 §6.2 集成段——原 T4-05 套件为注入 fake 驱动，依赖 C-M1 执行面 ⚠ 区头 a；
// 本套件=真 electron main 内 CdpBridge ws 端点＋真 webContents.debugger 代理）：
//   坑①序断言（未导航即命令被拒＋createSession 先导航后命令）／坑②保主窗（destroyRun 后新建
//   窗口导航成功）／坑③跨进程存活（显式 expires cookie 新进程仍在）／extract 双路径（evaluate 主＋
//   DOM 备选——真 DOM 文本）／click 两击（中心 pressed＋released——状态文本两次递增）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IPC_CHANNELS, type CreateSessionRes } from '@constella/shared/ipc';
// renderer 消费面（测试=renderer 消费者替身；生产由 C-03 ExecDispatcher 消费）：
import { createCommandTransport, type CommandTransport } from '../../renderer/cdp/command-transport';
import { createCdpOps, NotNavigatedError, type CdpOps, type LaneSessionPort } from '../../renderer/cdp/cdp-ops';
import { cookieParamsOf } from '../../renderer/cdp/cookie-semantics';
import { launchHeadRun, removeDir, type HeadRunHandle } from './testing/head-run-harness';

const TEST_TIMEOUT = 90_000;
const HOOK_TIMEOUT = 150_000;
/** 本套件端口子段（9261–9300；与 §6.2 套件 9221–9260 不相交——并行 worker 下两 electron
 *  同抢 9221 起段会互踩；均在 lane 段 9221–9320 内，02 §3.2 C-04 行） */
const POOL_RANGE = { first: 9261, last: 9300 };

let head: HeadRunHandle;
let transport: CommandTransport;
let ops: CdpOps;
const tempDirs: string[] = [];
let phaseB: HeadRunHandle | undefined;

/** cdp:navigate 通道网关注入（CdpOps.session——真通道） */
function sessionPort(h: HeadRunHandle, runId: string, laneKey: string): LaneSessionPort {
  return {
    async navigate(url: string): Promise<void> {
      const res = await h.invoke(IPC_CHANNELS.cdpNavigate, { runId, laneKey, url });
      if (!res.ok) throw new Error(`cdp:navigate 失败：${JSON.stringify(res.error)}`);
    },
  };
}

async function createLane(h: HeadRunHandle, laneKey: string, label: string): Promise<CreateSessionRes> {
  const res = await h.invoke<CreateSessionRes>(IPC_CHANNELS.cdpCreateSession, {
    runId: 'r-1',
    laneKey,
    label,
    startUrl: `${h.origin}/`,
  });
  if (!res.ok || res.result === undefined) throw new Error(`createSession 失败：${JSON.stringify(res.error)}`);
  return res.result;
}

/** 新 ops 实例（导航状态随实例——「未 open 先命令」用例需要 fresh 实例） */
function freshOps(h: HeadRunHandle, port: number, laneKey: string): CdpOps {
  return createCdpOps({
    transport: createCommandTransport(`ws://127.0.0.1:${port}`),
    session: sessionPort(h, 'r-1', laneKey),
  });
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constella-cdp-t405-a-'));
  tempDirs.push(dir);
  head = await launchHeadRun('t405', { userData: dir, poolRange: POOL_RANGE });
}, HOOK_TIMEOUT);

afterAll(async () => {
  transport?.close();
  await head?.quit().catch(() => undefined);
  if (phaseB !== undefined) await phaseB.quit().catch(() => undefined);
  await Promise.all(tempDirs.map((d) => removeDir(d)));
}, HOOK_TIMEOUT);

describe('T4-05 §6.2 集成段补跑——CommandTransport 接 CdpBridge 真端点（M4 PM 裁决 3 方案 A）', () => {
  it('坑①序断言：未 open 先 extract → NotNavigatedError；createSession 已先导航（title 即真页）', async () => {
    const lane = await createLane(head, 'n-1', '主支');
    ops = freshOps(head, lane.port, 'n-1');
    // 规格面序断言（真实 CDP 拒绝=不可靠而非报错——S-3 发现 1）：未导航发命令在 CdpOps 即拒
    await expect(ops.extract({ selector: '#status' })).rejects.toBeInstanceOf(NotNavigatedError);
    // createSession attach 后先导航（坑①）：首条命令即可读真页 title
    transport = createCommandTransport(`ws://127.0.0.1:${lane.port}`);
    const r = (await transport.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })) as { result: { value: string } };
    expect(r.result.value).toBe('t418-cdp-target');
  }, TEST_TIMEOUT);

  it('坑④真链：ops.open → readyState=complete（main 等待 loadEventFired＋renderer 轮询兜底）', async () => {
    const r = await ops.open({ url: `${head.origin}/` });
    expect(r).toEqual({ url: `${head.origin}/`, readyState: 'complete' });
  }, TEST_TIMEOUT);

  it('extract 双路径（S-3 判据 3）：主路径 Runtime.evaluate 真文本＋备选 DOM 三连真文本', async () => {
    const main = await ops.extract({ selector: '#status' });
    expect(main).toEqual({ values: ['before-click'] }); // 主路径：真 DOM 文本

    // 备选路径（DOM.getDocument→querySelector→getOuterHTML）——真端点直驱
    const doc = (await transport.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
    const node = (await transport.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#status',
    })) as { nodeId: number };
    const html = (await transport.send('DOM.getOuterHTML', { nodeId: node.nodeId })) as { outerHTML: string };
    expect(html.outerHTML).toContain('before-click');
  }, TEST_TIMEOUT);

  it('click 两击（S-3 判据 3：getBoundingClientRect 中心 pressed＋released）——状态文本两次递增', async () => {
    const p1 = await ops.click({ selector: '#btn' });
    expect(p1.x).toBeGreaterThan(0);
    expect(p1.y).toBeGreaterThan(0);
    expect(await ops.extract({ selector: '#status' })).toEqual({ values: ['after-click-1'] });
    await ops.click({ selector: '#btn' });
    expect(await ops.extract({ selector: '#status' })).toEqual({ values: ['after-click-2'] });
  }, TEST_TIMEOUT);

  it('坑②保主窗：destroyRun 后窗口归零→新建会话导航成功（新 ops 实例真链）', async () => {
    transport.close();
    const res = await head.invoke(IPC_CHANNELS.cdpDestroyRun, { runId: 'r-1' });
    expect(res.ok).toBe(true);
    expect((await head.control<{ count: number }>('windowCount')).count).toBe(0);
    const lane2 = await createLane(head, 'n-2', '支二');
    const ops2 = freshOps(head, lane2.port, 'n-2');
    const r = await ops2.open({ url: `${head.origin}/` });
    expect(r.readyState).toBe('complete');
    expect(await ops2.extract({ selector: '#status' })).toEqual({ values: ['before-click'] });
  }, TEST_TIMEOUT);

  it('坑③跨进程存活：显式 expires cookie（cookieParamsOf 构造）新进程仍在、无 expires 会话 cookie 已失', async () => {
    // 经真桥以 T4-05 CookieSemantics 构造器写显式 expires cookie（坑③语义锚同源）
    const t = createCommandTransport(`ws://127.0.0.1:${(await createLane(head, 'n-3', '支三')).port}`);
    const persist = cookieParamsOf('t405persist', 'p-1', { url: `${head.origin}/` });
    expect(persist.expires).toBeGreaterThan(Math.floor(Date.now() / 1000)); // 显式 expires 保证
    const set = (await t.send('Network.setCookie', { ...persist })) as { success: boolean };
    expect(set.success).toBe(true);
    await t.send('Network.setCookie', { name: 't405session', value: 's-1', url: `${head.origin}/` }); // 无 expires 对照
    t.close();

    await head.quit();
    phaseB = await launchHeadRun('t405-b', { userData: tempDirs[0]!, poolRange: POOL_RANGE }); // 同 userData 新进程
    const lane = await createLane(phaseB, 'n-3', '支三'); // 同 label→同 partition
    const t2 = createCommandTransport(`ws://127.0.0.1:${lane.port}`);
    const r = (await t2.send('Network.getCookies', { urls: [phaseB.origin] })) as {
      cookies: Array<{ name: string; value: string }>;
    };
    t2.close();
    const byName = Object.fromEntries(r.cookies.map((c) => [c.name, c.value]));
    expect(byName.t405persist).toBe('p-1'); // 显式 expires 跨进程存活（坑③）
    expect(byName.t405session).toBeUndefined(); // 会话 cookie 进程退出即失（坑③对照）
  }, TEST_TIMEOUT);
});
