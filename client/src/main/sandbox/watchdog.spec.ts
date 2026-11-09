// Watchdog 用例（T4-16 / TDD-C-M1 §3 Watchdog 行＋§6.1b「不退出进程→超时 taskkill 兜底」
// 的组件面——真子进程＋真 taskkill；py 树杀复查口径〔§6.1c〕归 T4-17）。
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Watchdog, taskkillTree } from './watchdog';

/** 拉起一个不退出的真子进程（node 定时器挂死） */
function spawnHanging(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (child.pid === undefined) throw new Error('测试子进程未取得 pid');
  return child.pid;
}

function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const poll = (): void => {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
          resolve(true);
          return;
        }
      }
      if (Date.now() - startedAt > timeoutMs) resolve(false);
      else setTimeout(poll, 50);
    };
    poll();
  });
}

describe('Watchdog（退出看门狗＋N6 超时强杀）', () => {
  it('不退出进程 → 到点强杀（真 taskkill）→ timedOut=true', async () => {
    const pid = spawnHanging();
    try {
      const wd = new Watchdog({ pollIntervalMs: 25 });
      const info = await wd.arm(pid, 400);
      expect(info.timedOut).toBe(true);
      expect(info.pid).toBe(pid);
      expect(info.ms).toBeGreaterThanOrEqual(400);
      expect(await waitDead(pid, 3000)).toBe(true); // §6.1b：taskkill 兜底后真死
    } finally {
      void taskkillTree(pid);
    }
  }, 15_000);

  it('自然退出先于到点 → timedOut=false（不触发强杀）', async () => {
    const wd = new Watchdog({ pollIntervalMs: 25 });
    const shortLived = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
    const pid = shortLived.pid!;
    const info = await wd.arm(pid, 5_000);
    expect(info.timedOut).toBe(false);
    expect(info.ms).toBeLessThan(5_000);
  }, 15_000);

  it('timeoutMs=0 → arm 拒绝（N6 0 值=调用方不武装——misuse 防御）', async () => {
    const wd = new Watchdog();
    await expect(wd.arm(1, 0)).rejects.toThrow(/timeoutMs/);
    await expect(wd.arm(1, -5)).rejects.toThrow(/timeoutMs/);
  });

  it('killTree 注入位：到点恰一次调用注入实现（T4-17 ProcessKiller 换装面）', async () => {
    const pid = spawnHanging();
    try {
      const killed: number[] = [];
      const wd = new Watchdog({
        killTree: async (p) => {
          killed.push(p);
          await taskkillTree(p); // 模拟换装体履行真杀职责
        },
        pollIntervalMs: 25,
      });
      const info = await wd.arm(pid, 150);
      expect(killed).toEqual([pid]); // 触发位恰一次、传 pid
      expect(info.timedOut).toBe(true);
      expect(await waitDead(pid, 3000)).toBe(true);
    } finally {
      void taskkillTree(pid);
    }
  }, 15_000);
});
