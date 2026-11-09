// SandboxExecutor 组件用例（T4-16 / TDD-C-M1 §3 SandboxExecutor 行＋§6.1 对应段之组件面：
// env 组装键集合〔§6.1d 前置〕、脚本路径白名单〔02 §12.2#3〕、lang 分派、configYaml 合并、
// killScript 幂等、sweepOrphans/dispose）。S-5 复现链（六形态双运行时/看门狗/掩码/caps 绑定）
// 见 sandbox-chain.spec.ts。
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SandboxError, assembleChildEnv } from './sandbox-executor';
import { WorkdirFactory } from './workdir-factory';
import type { SpawnScriptReq } from '@constella/shared/ipc';
import {
  collectEvents,
  makeSandboxEnv,
  spawnOrphan,
  spawnReq,
  waitPidDead,
  type SandboxTestEnv,
} from './testing/sandbox-harness';

/** 白名单 5＋CONSTELLA_* 恒在键＋RUN_AS_NODE（ts 链）——02 §12.1 v1.0a 传入块口径 */
const BASE_KEYS = [
  'SystemRoot',
  'TEMP',
  'TMP',
  'PATHEXT',
  'ComSpec',
  'CONSTELLA_RUN_ID',
  'CONSTELLA_NODE_ID',
  'CONSTELLA_CTX',
  'CONSTELLA_VAULT_PATH',
  'CONSTELLA_LLM_BASE_URL',
  'CONSTELLA_LLM_API_KEY',
  'ELECTRON_RUN_AS_NODE',
].sort();

describe('env 组装基座（assembleChildEnv——键集合断言面）', () => {
  const env = makeSandboxEnv();
  afterAll(() => env.dispose());

  it('基础键集合严格相等（白名单 5＋CONSTELLA_* 恒在＋RUN_AS_NODE；无 PATH 等继承键）', () => {
    const factory = new WorkdirFactory({ sandboxRoot: env.sandboxRoot });
    const layout = factory.create('r-1', 'n-1');
    const out = assembleChildEnv({
      mergedParams: { a: 1 },
      input: null,
      runId: 'r-1',
      nodeId: 'n-1',
      workdir: layout,
      revealSecret: () => 'sk-x',
      req: spawnReq({ scriptPath: 'x.ts' }),
      executorEnv: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(Object.keys(out).sort()).toEqual(BASE_KEYS); // 传入块键集严格相等（S-4 ⑤ 口径）
    expect(out.ELECTRON_RUN_AS_NODE).toBe('1'); // S-5 ④
    expect(out.CONSTELLA_CTX).toBe(JSON.stringify({ params: { a: 1 }, input: null }));
    expect(out.CONSTELLA_VAULT_PATH).toBe(layout.vaultJsonFile);
    expect(out.CONSTELLA_LLM_BASE_URL).toBe(''); // llm 键恒在（未配置=空值）
    expect(out.CONSTELLA_LLM_API_KEY).toBe('');
  });

  it('LLM 注密：apiKeyRef 配置 → reveal(refKey) 明文注入（T4-15 消费接线）', () => {
    const factory = new WorkdirFactory({ sandboxRoot: env.sandboxRoot });
    const layout = factory.create('r-2', 'n-1');
    const out = assembleChildEnv({
      mergedParams: {},
      input: null,
      runId: 'r-2',
      nodeId: 'n-1',
      workdir: layout,
      revealSecret: (ref) => `plain-for-${ref}`,
      llm: () => ({ baseUrl: 'https://llm.example/v1', apiKeyRef: 'secret.ai.apiKey' }),
      req: spawnReq({ scriptPath: 'x.ts' }),
    });
    expect(out.CONSTELLA_LLM_BASE_URL).toBe('https://llm.example/v1');
    expect(out.CONSTELLA_LLM_API_KEY).toBe('plain-for-secret.ai.apiKey');
  });

  it('条件键（T0-06 会签）：CDP_WS=lane 已开注入／未开不注入；NET_WS=N1 网络类目注入', () => {
    const factory = new WorkdirFactory({ sandboxRoot: env.sandboxRoot });
    const layout = factory.create('r-3', 'n-1');
    const make = (laneKey: string | undefined, net: string | null): string[] =>
      Object.keys(
        assembleChildEnv({
          mergedParams: {},
          input: null,
          runId: 'r-3',
          nodeId: 'n-1',
          workdir: layout,
          revealSecret: () => '',
          laneKey,
          cdpEndpointOf: (k) => (k === 'lane-open' ? 'ws://127.0.0.1:9300' : ''),
          netEndpointOf: () => net,
          req: spawnReq({ scriptPath: 'x.ts', laneKey }),
          executorEnv: { ELECTRON_RUN_AS_NODE: '1' },
        }),
      ).sort();
    // per-node 期望集（§6.1d 口径）
    expect(make('lane-open', 'ws://127.0.0.1:9400')).toEqual([...BASE_KEYS, 'CONSTELLA_CDP_WS', 'CONSTELLA_NET_WS'].sort());
    expect(make('lane-closed', null)).toEqual(BASE_KEYS);
    expect(make(undefined, null)).toEqual(BASE_KEYS); // 无 laneKey → 不注入 CDP_WS
  });
});

describe('SandboxExecutor 组件面（spawn 前置校验＋台账生命周期）', () => {
  it('RUN-INVALID-LANG：lang 枚举外值拒绝', async () => {
    const env = makeSandboxEnv();
    try {
      const sb = env.makeExecutor();
      await expect(sb.spawnScript(spawnReq({ scriptPath: env.scripts['s1-basic.ts']!, lang: 'js' as never }))).rejects.toMatchObject({
        code: 'RUN-INVALID-LANG',
      });
    } finally {
      env.dispose();
    }
  });

  it('RUN-ENV-MISSING：py 链未装配（PyExecutor=T4-17 占位）', async () => {
    const env = makeSandboxEnv();
    try {
      const sb = env.makeExecutor();
      await expect(sb.spawnScript(spawnReq({ scriptPath: 'x.py', lang: 'py' }))).rejects.toMatchObject({
        code: 'RUN-ENV-MISSING',
      });
    } finally {
      env.dispose();
    }
  });

  it('RUN-SCRIPT-NOT-FOUND：白名单外绝对路径/越界相对形/不存在文件', async () => {
    const env = makeSandboxEnv();
    try {
      const sb = env.makeExecutor();
      await expect(sb.spawnScript(spawnReq({ scriptPath: path.join(env.root, 'outside.ts') }))).rejects.toMatchObject({
        code: 'RUN-SCRIPT-NOT-FOUND',
      });
      await expect(sb.spawnScript(spawnReq({ scriptPath: '../../escape.ts' }))).rejects.toMatchObject({
        code: 'RUN-SCRIPT-NOT-FOUND',
      });
      await expect(sb.spawnScript(spawnReq({ scriptPath: 'demo/1.0.0/scripts/nope.ts' }))).rejects.toMatchObject({
        code: 'RUN-SCRIPT-NOT-FOUND',
      });
    } finally {
      env.dispose();
    }
  });

  it('相对 scriptPath 按 nodeTypesRoot 解析（X-01 ExecSpec.file 相对形）→ spawn ok', async () => {
    const env = makeSandboxEnv();
    try {
      const sb = env.makeExecutor();
      const c = collectEvents(sb);
      const res = await sb.spawnScript(
        spawnReq({ scriptPath: 'demo/1.0.0/scripts/s1-basic.ts', input: { ok: 1 }, nodeRunId: 'r-rel:n-1' }),
      );
      expect(res.ok).toBe(true);
      expect(res.pid).toBeGreaterThan(0);
      const exit = await c.waitForExit(20_000);
      expect(exit.code).toBe(0);
    } finally {
      await env.makeExecutor().dispose().catch(() => undefined);
      env.dispose();
    }
  }, 30_000);

  it('configYaml 合并经真链：config 覆盖 PARAMS、实例覆盖 config（02 §14 冻结序）', async () => {
    const env = makeSandboxEnv();
    try {
      const sb = env.makeExecutor();
      const c = collectEvents(sb);
      // s2 PARAMS={factor:2,label:'score'}；config 设 factor:3+label:'cfg'；实例设 factor:5
      await sb.spawnScript(
        spawnReq({
          scriptPath: env.scripts['s2-compute.ts']!,
          input: 10,
          params: { factor: 5 },
          configYaml: 'factor: 3\nlabel: cfg\n',
          nodeRunId: 'r-cfg:n-1',
        }),
      );
      const exit = await c.waitForExit(20_000);
      expect(exit.code).toBe(0);
      const resultFrame = c.frames().at(-1)!;
      expect(resultFrame.out).toEqual({ data: { cfg: 50 } }); // label='cfg'（config）×factor=5（实例）
      // workdir config.yaml 落 req 原文（02 §12.1 布局件）
      expect(readFileSync(path.join(env.sandboxRoot, 'r-cfg', 'n-1', 'config.yaml'), 'utf8')).toBe('factor: 3\nlabel: cfg\n');
    } finally {
      env.dispose();
    }
  }, 30_000);

  it('killScript：在跑挂死进程强杀＋幂等（in-band {ok:true}——已退出亦 ok）', async () => {
    const env = makeSandboxEnv();
    let pid = 0;
    try {
      const sb = env.makeExecutor();
      const c = collectEvents(sb);
      const res = await sb.spawnScript(spawnReq({ scriptPath: env.scripts['hang.ts']!, nodeRunId: 'r-kill:n-1' }));
      pid = res.pid;
      expect(await waitPidDead(pid, 2000)).toBe(false); // 在跑
      expect(await sb.killScript('r-kill:n-1')).toEqual({ ok: true });
      const exit = await c.waitForExit(15_000);
      expect(exit.code).not.toBe(0);
      expect(await waitPidDead(pid, 5000)).toBe(true);
      expect(await sb.killScript('r-kill:n-1')).toEqual({ ok: true }); // 幂等（已退出亦 ok）
      expect(await sb.killScript('r-kill:unknown')).toEqual({ ok: true }); // 未知 id 亦幂等
    } finally {
      if (pid !== 0) await killPid(pid);
      env.dispose();
    }
  }, 40_000);

  it('sweepOrphans：陈旧 run 目录（含残留 pid 标记）清扫——杀 pid＋删目录；在跑 run 不动', async () => {
    const env: SandboxTestEnv = makeSandboxEnv();
    let livePid = 0;
    try {
      const sb = env.makeExecutor();
      // 陈旧 run（上一会话残留）：目录＋pid 标记（真孤儿进程）
      const orphanPid = spawnOrphan();
      mkdirSync(path.join(env.sandboxRoot, 'r-stale', 'n-1'), { recursive: true });
      writeFileSync(path.join(env.sandboxRoot, 'r-stale', 'n-1', 'config.yaml'), '', 'utf8');
      new WorkdirFactory({ sandboxRoot: env.sandboxRoot }).addPid('r-stale', orphanPid);
      // 在跑 run：不清理
      const live = await sb.spawnScript(spawnReq({ scriptPath: env.scripts['hang.ts']!, nodeRunId: 'r-live:n-1' }));
      livePid = live.pid;
      await sb.sweepOrphans();
      expect(existsSync(path.join(env.sandboxRoot, 'r-stale'))).toBe(false); // 目录清
      expect(await waitPidDead(orphanPid, 5000)).toBe(true); // 孤儿 pid 树杀
      expect(await waitPidDead(livePid, 1500)).toBe(false); // 在跑不动
      expect(existsSync(path.join(env.sandboxRoot, 'r-live', 'n-1'))).toBe(true);
      await sb.dispose();
      expect(await waitPidDead(livePid, 5000)).toBe(true); // dispose：在跑树 killTree
    } finally {
      if (livePid !== 0) await killPid(livePid);
      env.dispose();
    }
  }, 60_000);

  it('SandboxError 形：Error+string code（IpcGateway serializeError 归一面）', () => {
    const e = new SandboxError('RUN-SCRIPT-NOT-FOUND', 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('RUN-SCRIPT-NOT-FOUND');
    expect(e.name).toBe('SandboxError');
  });
});

function killPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    p.on('close', () => resolve());
    p.on('error', () => resolve());
  });
}
