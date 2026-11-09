// SandboxExecutor ts 链 S-5 复现链（T4-16 验收=TDD-C-M1 §6.1a ts 侧＋§6.1b＋§6.1f；
// node 直跑＋electron-as-node 双口径——S-5 三矩阵 Run A/B 同构口径）。
//
// 对端互证：sdk/fixtures 六形态（T4-10=S-5 共同输入）驱动 spawn 全链（esbuild bundle→
// spawn→CONSTELLA_CTX 注入→stdout JSON 行帧→exit 0/1/2），帧序列与 sdk/fixtures/expected
// 逐帧对照（剥 runtime/stack 波动字段——K-01 §6.1 同口径）。
//
// caps bound 补跑（PM 登记本卡）：CONSTELLA_CDP_WS/NET_WS 注入后子进程经 ws 帧真往返＋
// 域名白名单拒 NET-DENIED——fake 桥宿主（NetProxyBridge 本体不在本卡，留痕见
// testing/fake-capability-bridge.ts 文件头；真宿主联测归 T4-20/P5）。
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SDK_ROOT,
  collectEvents,
  electronExecPath,
  makeSandboxEnv,
  spawnReq,
  waitPidDead,
  type SandboxTestEnv,
} from './testing/sandbox-harness';
import { startFakeCapabilityBridge, type FakeBridgeHandle } from './testing/fake-capability-bridge';

/** 期望资产（S-5 六形态冻结契约——K-01 §6.1 同源复用） */
interface Expected {
  id: string;
  ctx: unknown;
  exit: number;
  frames: unknown[];
}

const EXPECTED_DIR = path.join(SDK_ROOT, 'fixtures', 'expected');
const SDK_VERSION = JSON.parse(readFileSync(path.join(SDK_ROOT, 'package.json'), 'utf8')).version as string;
const EXPECTED_SIX: Expected[] = ['s1-basic', 's2-compute', 's3-relative-import', 's4-error', 's5-branch', 's6-invalid-out'].map(
  (id) => JSON.parse(readFileSync(path.join(EXPECTED_DIR, `${id}.json`), 'utf8')) as Expected,
);

/** 帧剥波动字段（result→runtime；error→stack——K-01 §6.2 同构剥除口径） */
function stripVolatile(frame: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...frame };
  if (copy.type === 'result') delete copy.runtime;
  if (copy.type === 'error') delete copy.stack;
  return copy;
}

/** 六形态断言（§6.1a：终帧恰一且末行＋exit 逐场景＋帧序列=期望 JSON） */
function assertSixContract(label: string, expected: Expected, frames: Array<Record<string, unknown>>, exitCode: number, stderrText: string): void {
  expect(frames.length, `${label}: stdout 至少含终帧`).toBeGreaterThan(0);
  const terminals = frames.filter((f) => f.type === 'result' || f.type === 'error');
  expect(terminals, `${label}: 终帧（result|error）恰一`).toHaveLength(1);
  expect(frames[frames.length - 1], `${label}: 终帧为末行`).toBe(terminals[0]);
  expect(exitCode, `${label}: exit 码（0=成功/1=脚本错误/2=装配错误）`).toBe(expected.exit);
  expect(
    frames.map(stripVolatile),
    `${label}: 帧序列剥 runtime/stack 后与期望 JSON 逐帧一致`,
  ).toStrictEqual(expected.frames);
  expect(stderrText.includes('"type":"result"') || stderrText.includes('"type":"error"'), `${label}: stderr 不承载协议`).toBe(false);
}

/** 双运行时矩阵（S-5 Run B=node 直跑；Run A=electron-as-node）——id=路径安全 ASCII 段 */
const RUNTIMES: Array<{ id: string; label: string; execPath?: string; electron: boolean }> = [
  { id: 'node', label: 'node 直跑', electron: false },
  { id: 'electron', label: 'electron-as-node', execPath: electronExecPath(), electron: true },
];

for (const rt of RUNTIMES) {
  const maybe = rt.execPath === undefined && rt.electron ? describe.skip : describe;
  maybe(`ts 链 · ${rt.label}（S-5 复现链）`, () => {
    let env: SandboxTestEnv;

    beforeAll(() => {
      env = makeSandboxEnv();
    });
    afterAll(async () => {
      await env.makeExecutor().dispose().catch(() => undefined);
      env.dispose();
    });

    for (const expected of EXPECTED_SIX) {
      it(
        `${rt.label}：${expected.id} 六形态契约（帧序列=期望 JSON、exit=${expected.exit}）`,
        async () => {
          const sb = env.makeExecutor(rt.execPath === undefined ? {} : { execPath: rt.execPath });
          const c = collectEvents(sb);
          const ctx = (expected.ctx ?? {}) as { params?: Record<string, unknown>; input?: unknown };
          await sb.spawnScript(
            spawnReq({
              scriptPath: path.join('demo', '1.0.0', 'scripts', `${expected.id}.ts`),
              params: ctx.params ?? {},
              input: ctx.input ?? null,
              nodeRunId: `r-${rt.id}:n-${expected.id}`,
            }),
          );
          const exit = await c.waitForExit(30_000);
          const stderrText = c.events
            .filter((e) => e.kind === 'stderr')
            .map((e) => e.chunk ?? '')
            .join('');
          assertSixContract(expected.id, expected, c.frames(), exit.code ?? -1, stderrText);
          // runtime 字段集与运行体判定（K-01 §1：electron=null=纯 node；electron-as-node=版本串）
          const term = c.frames().at(-1)!;
          if (term.type === 'result') {
            const runtime = (term as { runtime?: Record<string, unknown> }).runtime;
            expect(Object.keys(runtime ?? {}).sort()).toEqual(['electron', 'execPath', 'node', 'sdkVersion']);
            expect(runtime!.sdkVersion).toBe(SDK_VERSION);
            expect(rt.electron ? typeof runtime!.electron : runtime!.electron).toBe(rt.electron ? 'string' : null);
          }
        },
        45_000,
      );
    }

    it(
      `${rt.label}：entry 缺 run（ENTRY_NO_RUN）→ error 终帧＋exit 2（§6.1a 装配错误态）`,
      async () => {
        const sb = env.makeExecutor(rt.execPath === undefined ? {} : { execPath: rt.execPath });
        const c = collectEvents(sb);
        await sb.spawnScript(
          spawnReq({
            scriptPath: path.join('demo', '1.0.0', 'scripts', 's1-basic.ts'),
            entry: 'notRun', // 模块未导出该入口函数
            nodeRunId: `r-${rt.id}:n-no-run`,
          }),
        );
        const exit = await c.waitForExit(30_000);
        const frames = c.frames();
        const term = frames.at(-1) as { type: string; code: string };
        expect(term.type).toBe('error');
        expect(term.code).toBe('ENTRY_NO_RUN');
        expect(exit.code).toBe(2);
      },
      45_000,
    );

    it(
      `${rt.label}：sourcemap 回源（S-5 ⑤）——错误帧 stack 指向 .ts 源行号`,
      async () => {
        const sb = env.makeExecutor(rt.execPath === undefined ? {} : { execPath: rt.execPath });
        const c = collectEvents(sb);
        await sb.spawnScript(
          spawnReq({
            scriptPath: path.join('demo', '1.0.0', 'scripts', 's4-error.ts'),
            nodeRunId: `r-${rt.id}:n-sm`,
          }),
        );
        const exit = await c.waitForExit(30_000);
        expect(exit.code).toBe(1);
        const term = c.frames().at(-1) as { type: string; stack: string };
        expect(term.type).toBe('error');
        expect(term.stack).toContain('s4-error.ts:'); // bundle 行号→源 .ts（--enable-source-maps）
      },
      45_000,
    );

    it(
      `${rt.label}：不退出进程 → N6 超时强杀兜底（§6.1b；timeoutMs=800）`,
      async () => {
        const sb = env.makeExecutor(rt.execPath === undefined ? {} : { execPath: rt.execPath });
        const c = collectEvents(sb);
        const startedAt = Date.now();
        const res = await sb.spawnScript(
          spawnReq({
            scriptPath: path.join('demo', '1.0.0', 'scripts', 'hang.ts'),
            timeoutMs: 800,
            nodeRunId: `r-${rt.id}:n-hang`,
          }),
        );
        const exit = await c.waitForExit(30_000);
        expect(res.ok).toBe(true);
        expect(exit.code).not.toBe(0); // taskkill 强杀（观测按 code）
        expect(exit.ms ?? 0).toBeGreaterThanOrEqual(800);
        expect(Date.now() - startedAt).toBeLessThan(30_000); // 看门狗兜底而非测试超时
        expect(await waitPidDead(res.pid, 5000)).toBe(true);
      },
      45_000,
    );

    it(
      `${rt.label}：env 注入面（§6.1 前置）——CONSTELLA_* 恒在键＋cwd=workdir＋reveal 注密可见`,
      async () => {
        env.llmSource.set('https://llm.example/v1', 'secret.ai.apiKey');
        const sb = env.makeExecutor(rt.execPath === undefined ? {} : { execPath: rt.execPath });
        const c = collectEvents(sb);
        await sb.spawnScript(
          spawnReq({
            scriptPath: path.join('demo', '1.0.0', 'scripts', 'env-probe.ts'),
            params: { probe: 1 },
            laneKey: 'lane-none', // 端点解析=未开 lane → CDP_WS 不注入
            nodeRunId: `r-${rt.id}:n-env`,
          }),
        );
        const exit = await c.waitForExit(30_000);
        expect(exit.code).toBe(0);
        const term = c.frames().at(-1) as { out: { data: Record<string, unknown> } };
        expect(term.out.data).toMatchObject({
          runId: `r-${rt.id}`,
          nodeId: 'n-env',
          llmBaseUrl: 'https://llm.example/v1',
          hasApiKey: true, // reveal 注密明文已注入（明文只入 env，不入事件流——掩码面另测）
          ctxParams: { probe: 1 },
          cdpWs: null,
          netWs: null,
          runAsNode: '1',
          hasSystemRoot: true,
        });
        expect(String(term.out.data.vaultPath).replaceAll('\\', '/')).toContain(`/r-${rt.id}/n-env/vault.json`);
        expect(String(term.out.data.cwd).replaceAll('\\', '/')).toContain(`/r-${rt.id}/n-env`);
        expect(env.revealCalls).toContain('secret.ai.apiKey'); // LLM_API_KEY=SecretVault.reveal 注密
      },
      45_000,
    );
  });
}

// ————————————————————————————————————————————
// 掩码（§6.1f）＋通道/推送面＋caps bound 补跑（node 口径足以覆盖协议面；PM 登记项）
// ————————————————————————————————————————————

describe('ts 链 · 事件面（run:scriptEvent 转发前 SecretMasker）', () => {
  let env: SandboxTestEnv;
  beforeAll(() => {
    env = makeSandboxEnv();
  });
  afterAll(async () => {
    await env.makeExecutor().dispose().catch(() => undefined);
    env.dispose();
  });

  it('§6.1f：脚本 stdout 打明文 apiKey → 推送面收 sk-***（明文零泄漏）', async () => {
    const sb = env.makeExecutor();
    const pushed: Array<{ channel: string; payload: unknown }> = [];
    sb.init({
      registry: { handle: () => undefined },
      push: (channel, payload) => pushed.push({ channel, payload }),
    });
    await sb.spawnScript(spawnReq({ scriptPath: path.join('demo', '1.0.0', 'scripts', 'print-secret.ts'), nodeRunId: 'r-mask:n-1' }));
    // 等待 exit 推送（spawn 返回后子进程事件异步到齐——快照须在等待后取）
    await new Promise<void>((resolve, reject) => {
      const t = setInterval(() => {
        if (pushed.some((p) => (p.payload as { kind?: string }).kind === 'exit')) {
          clearInterval(t);
          resolve();
        }
      }, 50);
      const guard = setTimeout(() => {
        clearInterval(t);
        reject(new Error('等待 exit 推送超时'));
      }, 30_000);
      guard.unref?.();
    });
    const channelPushes = pushed.filter((p) => p.channel === 'constella:run:scriptEvent');
    const stdoutPushes = channelPushes.filter((p) => (p.payload as { kind?: string }).kind === 'stdout');
    expect(stdoutPushes.length).toBeGreaterThan(0);
    const allText = stdoutPushes.map((p) => (p.payload as { chunk?: string }).chunk ?? '').join('');
    expect(allText).toContain('sk-***');
    expect(allText.includes('sk-test-123xyz')).toBe(false); // 明文不穿推送面（02 §12.3/§12.4）
    expect(allText.includes('sk-another-key-999')).toBe(false);
    // ctx.log 帧与 console.log 裸行两径都掩码；exit 帧恰一照发
    expect(channelPushes.filter((p) => (p.payload as { kind?: string }).kind === 'exit')).toHaveLength(1);
  }, 45_000);
});

describe('ts 链 · caps 绑定态（T0-06 会签·PM 登记补跑：fake 桥协议面）', () => {
  let env: SandboxTestEnv;
  let bridge: FakeBridgeHandle;

  beforeAll(async () => {
    env = makeSandboxEnv();
    bridge = await startFakeCapabilityBridge({ allowDomains: ['allowed.example.com'] });
  });
  afterAll(async () => {
    await env.makeExecutor().dispose().catch(() => undefined);
    await bridge.close();
    env.dispose();
  });

  it('CDP_WS/NET_WS 注入 → 子进程 ws 帧真往返＋白名单外域名拒 NET-DENIED（拒绝事件台账可见）', async () => {
    const sb = env.makeExecutor({
      cdpEndpointOf: () => bridge.url, // lane 已开（真宿主=CdpBridge.endpointOf 装配位）
      netEndpointOf: () => bridge.url, // N1 网络类目（真宿主=NetProxyBridge，T4-20/P5 留痕）
    });
    const c = collectEvents(sb);
    await sb.spawnScript(
      spawnReq({
        scriptPath: path.join('demo', '1.0.0', 'scripts', 'caps-ws.ts'),
        laneKey: 'lane-x',
        nodeRunId: 'r-caps:n-1',
      }),
    );
    const exit = await c.waitForExit(45_000);
    expect(exit.code).toBe(0);
    const term = c.frames().at(-1) as { out: { data: { cdp?: unknown[]; net?: unknown[] } } };
    // cdp 桥：method 白名单内两帧 ok 往返（T0-07 冻结帧形）
    expect(term.out.data.cdp).toStrictEqual([
      { id: 1, ok: true, result: {} },
      { id: 2, ok: true, result: { result: { value: 2 } } },
    ]);
    // net 桥：白名单内放行＋白名单外默认拒绝 NET-DENIED（02 §12.1）
    expect(term.out.data.net).toStrictEqual([
      { id: 1, ok: true, result: { status: 200, url: 'https://allowed.example.com/api', via: 'fake-net-bridge' } },
      {
        id: 2,
        ok: false,
        error: { code: 'NET-DENIED', message: '域名白名单外默认拒绝: evil.example.net' },
      },
    ]);
    // 拒绝事件日志可见（宿主台账面——真落日志表归 NetProxyBridge 本体 T4-20/P5）
    expect(bridge.denials).toEqual([{ domain: 'evil.example.net', url: 'https://evil.example.net/exfil' }]);
  }, 60_000);
});
