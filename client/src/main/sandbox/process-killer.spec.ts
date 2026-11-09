// ProcessKiller 组件用例（T4-17 / TDD-C-M1 §3 ProcessKiller 行＋S-4 ①③：
// taskkill /PID x /T /F 冻结形参＋杀后复查 tasklist 枚举＋re-parent 残留补杀→KillReport）。
// 全链三层 python 树（§6.1c）归 py-chain.spec.ts；本文件=killTree/report 组件面（真进程）。
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { ProcessKiller, tasklistAlive } from './process-killer';

/** 拉起不退出的真子进程（node 定时器挂死） */
function spawnHanging(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (child.pid === undefined) throw new Error('测试子进程未取得 pid');
  return child.pid;
}

/** 拉起即退的短命进程（取已死 pid） */
function spawnDead(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
    child.on('close', () => resolve(child.pid!));
  });
}

describe('ProcessKiller（taskkill /T /F＋杀后复查 KillReport——S-4 ①）', () => {
  it('tasklistAlive：存活 pid=true／已死 pid=false（ASCII CSV 枚举，不依赖本地化文案）', async () => {
    const live = spawnHanging();
    const dead = await spawnDead();
    try {
      expect(await tasklistAlive(live)).toBe(true);
      expect(await tasklistAlive(dead)).toBe(false);
    } finally {
      void new ProcessKiller().killTree(live);
    }
  }, 15_000);

  it('killTree 挂死进程：全轮复查→DEAD，KillReport {attempts≥1, survivors=[]}', async () => {
    const pid = spawnHanging();
    const report = await new ProcessKiller({ settleMs: 100 }).killTree(pid);
    expect(report.pid).toBe(pid);
    expect(report.attempts).toBeGreaterThanOrEqual(1);
    expect(report.survivors).toEqual([]); // 残留=0（S-4 ① 复查面）
    expect(await tasklistAlive(pid)).toBe(false);
  }, 15_000);

  it('killTree 已退出 pid：幂等复查→survivors=[]（killScript in-band 幂等同源）', async () => {
    const dead = await spawnDead();
    const report = await new ProcessKiller({ settleMs: 50 }).killTree(dead);
    expect(report.survivors).toEqual([]);
    expect(report.attempts).toBe(1); // 复查即死——不补杀
  }, 15_000);

  it('复查残留补杀循环：taskkill 无效（注入 no-op）→ 轮数耗尽→survivors=[pid]＋warn 台账', async () => {
    const pid = spawnHanging();
    try {
      const killer = new ProcessKiller({ rounds: 3, settleMs: 50, taskkill: async () => undefined });
      const report = await killer.killTree(pid);
      expect(report.attempts).toBe(3); // 首杀＋补杀共 rounds 轮
      expect(report.survivors).toEqual([pid]); // 仍活=残留如实上报
      expect(await tasklistAlive(pid)).toBe(true);
    } finally {
      await new ProcessKiller().killTree(pid); // 真杀收尾
    }
  }, 20_000);
});
