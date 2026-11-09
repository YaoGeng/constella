// SandboxExecutor → SandboxExecutorSlot 装配接线（T4-16 / TDD-C-M1 §3 生命周期段——
// AppRuntime 启动序末步 sweepOrphans＋退出序 dispose；真 executor 结构满足 slot，
// electron 面=mock〔组合根 index.ts 生产接线随 T4-20 组收尾——cdp/vault 同先例〕）。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppRuntime } from './app-runtime';
import { createMockElectron } from './testing/mock-electron';
import type { MainServiceSlots } from './service-slots';
import { WorkdirFactory } from '../sandbox/workdir-factory';
import {
  makeSandboxEnv,
  spawnOrphan,
  spawnReq,
  waitPidDead,
} from '../sandbox/testing/sandbox-harness';
import type { SpawnScriptRes } from '@constella/shared/ipc';

const RENDERER_DIR = path.resolve('C:\\mock-app\\dist\\renderer');
const PRELOAD_PATH = path.resolve('C:\\mock-app\\dist\\preload\\index.js');

describe('SandboxExecutor 装配接线（service-slots SandboxExecutorSlot）', () => {
  it('startup 末步 sweepOrphans（陈旧 run 目录＋残留 pid 清扫）→ shutdown dispose（在跑树强杀）', async () => {
    const env = makeSandboxEnv();
    const mock = createMockElectron([]);
    // 启动前残留：上一会话 run 目录＋真孤儿 pid 标记（runId 标记面）
    const orphanPid = spawnOrphan();
    mkdirSync(path.join(env.sandboxRoot, 'r-legacy', 'n-1'), { recursive: true });
    writeFileSync(path.join(env.sandboxRoot, 'r-legacy', 'n-1', 'config.yaml'), '', 'utf8');
    new WorkdirFactory({ sandboxRoot: env.sandboxRoot }).addPid('r-legacy', orphanPid);

    const sandbox = env.makeExecutor();
    const services: MainServiceSlots = { sandbox };
    const runtime = new AppRuntime({
      electron: mock.api,
      rendererDir: RENDERER_DIR,
      preloadPath: PRELOAD_PATH,
      services,
    });
    await runtime.startup();
    try {
      // 启动序末步：孤儿清扫已执行（残留目录删＋孤儿 pid 树杀）
      expect(existsSync(path.join(env.sandboxRoot, 'r-legacy'))).toBe(false);
      expect(await waitPidDead(orphanPid, 5000)).toBe(true);

      // 在跑脚本 → before-quit 退出序 dispose 强杀
      const res: SpawnScriptRes = await sandbox.spawnScript(
        spawnReq({ scriptPath: path.join('demo', '1.0.0', 'scripts', 'hang.ts'), nodeRunId: 'r-live:n-1' }),
      );
      expect(await waitPidDead(res.pid, 1500)).toBe(false); // 在跑
      mock.app.emitApp('before-quit');
      await new Promise((r) => setTimeout(r, 200)); // shutdown 异步链（preventDefault→shutdown→quit）
      expect(await waitPidDead(res.pid, 5000)).toBe(true); // dispose：在跑树 killTree
    } finally {
      await runtime.shutdown().catch(() => undefined);
      env.dispose();
    }
  }, 60_000);
});
