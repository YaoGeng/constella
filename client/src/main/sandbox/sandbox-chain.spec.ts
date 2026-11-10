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
import { NetProxyBridge } from '../net/net-proxy-bridge';
// T5-12b e2e 追加段导入（ctx.net 绑定态——N1 网络门整判＋本地 fetch 目标）
import { writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { SpawnScriptReq } from '@constella/shared/ipc';
import { netEligibleDefinition } from '../net/net-gate';
import type { SandboxExecutor } from './sandbox-executor';

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

// ————————————————————————————————————————————
// 真宿主复跑（T5-12a 验收判据：fake 桥协议面用例改跑真宿主——caps-ws.ts 裸 ws fixture
// 直连真端点，SDK 侧仍不经 ctx.net〔caps 绑定客户端=T5-12b〕）。cdp 半段仍走 fake 桥
// （CdpBridge 真宿主链归 cdp 域套件）；net 半段=真 NetProxyBridge（V1.1 收缩位形态：
// host 供给 ['127.0.0.1']——caps-ws.ts 固定域名均在集外→真拒径＋台账，零外网依赖）。
// 端口段 9381–9384（net 段 9321–9420 内与 net 域套件 9361–9380 错峰）。
// ————————————————————————————————————————————

describe('ts 链 · caps 绑定态真宿主复跑（T5-12a：NetProxyBridge net 半段）', () => {
  let env: SandboxTestEnv;
  let fake: FakeBridgeHandle;
  let netBridge: NetProxyBridge;

  beforeAll(async () => {
    env = makeSandboxEnv();
    fake = await startFakeCapabilityBridge({ allowDomains: ['allowed.example.com'] });
    netBridge = new NetProxyBridge({ portRange: { first: 9381, last: 9384 } });
    await netBridge.init();
  });
  afterAll(async () => {
    await env.makeExecutor().dispose().catch(() => undefined);
    await netBridge.dispose().catch(() => undefined);
    await fake.close();
    env.dispose();
  });

  it('真宿主：NET_WS 注入真端点 → 子进程裸 ws 帧真往返＋域名集外真拒 NET-DENIED＋宿主台账', async () => {
    const sb = env.makeExecutor({
      cdpEndpointOf: () => fake.url, // cdp 半段保持 fake（真 CdpBridge 链归 cdp 域套件）
      // 生产形态（T5-12a 装配同构）：N1 网络门开后 openScope 首开（async——绑定确认先于注入）
      netEndpointOf: (req) => netBridge.openScope(req.nodeRunId, ['127.0.0.1']),
    });
    const c = collectEvents(sb);
    await sb.spawnScript(
      spawnReq({
        scriptPath: path.join('demo', '1.0.0', 'scripts', 'caps-ws.ts'),
        laneKey: 'lane-x',
        nodeRunId: 'r-caps2:n-1',
      }),
    );
    const exit = await c.waitForExit(45_000);
    expect(exit.code).toBe(0);
    const term = c.frames().at(-1) as { out: { data: { cdp?: unknown[]; net?: unknown[] } } };
    // cdp 半段：fake 桥固定应答（既有协议面不动）
    expect(term.out.data.cdp).toStrictEqual([
      { id: 1, ok: true, result: {} },
      { id: 2, ok: true, result: { result: { value: 2 } } },
    ]);
    // net 半段：真宿主域名层（连接级 allowlist=['127.0.0.1']——caps-ws.ts 固定域名均在集外）
    expect(term.out.data.net).toStrictEqual([
      { id: 1, ok: false, error: { code: 'NET-DENIED', message: '域名白名单外默认拒绝: allowed.example.com' } },
      { id: 2, ok: false, error: { code: 'NET-DENIED', message: '域名白名单外默认拒绝: evil.example.net' } },
    ]);
    // 宿主拒绝台账（可查询——PM 授权形 {time,domain,url}）
    expect(netBridge.denials()).toMatchObject([
      { domain: 'allowed.example.com', url: 'https://allowed.example.com/api' },
      { domain: 'evil.example.net', url: 'https://evil.example.net/exfil' },
    ]);
    for (const r of netBridge.denials()) expect(typeof r.time).toBe('number');
  }, 60_000);
});

// ————————————————————————————————————————————
// ctx.net 绑定态 e2e（T5-12b：SDK caps net 绑定客户端 × 真宿主 NetProxyBridge〔T5-12a〕）。
// 形态：N1 网络门整判（net-gate——类目含「网络」的定义命中）→ openScope（绑定确认先于
// env 注入）→ CONSTELLA_NET_WS → 子进程脚本内 ctx.net.fetch 真往返；fetch 目标=本测试
// 进程 127.0.0.1 http 服务（零外网依赖——宿主 nodeFetchImpl 真发 HTTP 到本地口）；
// 对照=无网络类目定义 → 门不开 → ctx.net.fetch=SDK_CAP_UNAVAILABLE（三态①）。
// py 侧同判据（lang:'py'——包内置 RFC6455 极简客户端对真 ws 服务端，K-01 §2 冻结径②）。
// 端口段 9385–9388（net 段 9321–9420 内，与 net 域套件 9361–9380/T5-12a 9381–9384 错峰）。
// ————————————————————————————————————————————

const NET_E2E_BODY = 'constella-net-e2e';

/** e2e fixture（ts）：ctx.net.fetch 真往返＋白名单外拒径（targetUrl/deniedUrl 经 params 注入） */
const NET_CAP_E2E_TS = [
  "import type { NodeCtx, NodeOut } from '@constella/sdk';",
  'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
  "  const res = await ctx.net.fetch(String(ctx.params.targetUrl), { headers: { 'x-probe': 'constella' } });",
  '  let deniedCode: string | null = null;',
  '  try {',
  '    await ctx.net.fetch(String(ctx.params.deniedUrl));',
  '  } catch (e) {',
  "    deniedCode = (e as { code?: string }).code ?? null;",
  '  }',
  '  return { data: { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body, deniedCode } };',
  '}',
  '',
].join('\n');

/** e2e fixture（py）：同判据同构（headers/白名单拒/载荷形） */
const NET_CAP_E2E_PY = [
  'from typing import Any',
  '',
  'from constella_sdk import NodeCtx',
  '',
  '',
  'async def run(ctx: NodeCtx) -> dict[str, Any]:',
  '    res = await ctx.net.fetch(str(ctx.params["targetUrl"]), {"headers": {"x-probe": "constella"}})',
  '    denied_code = None',
  '    try:',
  '        await ctx.net.fetch(str(ctx.params["deniedUrl"]))',
  '    except Exception as e:',
  '        denied_code = getattr(e, "code", None)',
  '    return {"data": {"status": res["status"], "statusText": res["statusText"], "headers": res["headers"], "body": res["body"], "deniedCode": denied_code}}',
  '',
].join('\n');

describe('ts 链 · ctx.net 绑定态 e2e（T5-12b：SDK net 客户端×真宿主 NetProxyBridge）', () => {
  let env: SandboxTestEnv;
  let netBridge: NetProxyBridge;
  let httpServer: HttpServer;
  let httpPort = 0;
  const httpHits: Array<{ url: string; xProbe: string | undefined }> = [];
  const executors: SandboxExecutor[] = [];

  const netDef = (category: string): NodeDefinition => ({
    type: 'demo', // 资产树 demo/1.0.0/scripts/* 首段=type（net-gate nodeTypeOfScript 同源）
    kind: 'custom',
    meta: { name: 'demo', icon: '', category },
    ports: { ins: [], outs: [] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  });

  /** 生产装配同构的 netEndpointOf：N1 门整判 → 门开=openScope（V1.1 收缩形 host 供给 ['127.0.0.1']） */
  const gateEndpointOf = (defs: readonly NodeDefinition[]) => async (req: SpawnScriptReq): Promise<string | null> => {
    return netEligibleDefinition(req.scriptPath, env.nodeTypesRoot, defs) !== undefined
      ? netBridge.openScope(req.nodeRunId, ['127.0.0.1'])
      : null;
  };

  beforeAll(async () => {
    env = makeSandboxEnv();
    // 本地 fetch 目标（真宿主 main 侧真发 HTTP——回显 x-probe 证 headers 上桥面）
    httpServer = createHttpServer((req, res) => {
      const rawProbe = req.headers['x-probe']; // node http 头可 string[]——归一首值
      const probe = Array.isArray(rawProbe) ? rawProbe[0] : rawProbe;
      httpHits.push({ url: req.url ?? '', xProbe: probe });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'echo-x-probe': probe ?? '' });
      res.end(NET_E2E_BODY);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    httpPort = (httpServer.address() as AddressInfo).port;
    netBridge = new NetProxyBridge({ portRange: { first: 9385, last: 9388 } });
    await netBridge.init();
    // fixture 置入资产树（ts+py 同判据；targetUrl/deniedUrl 经 params 注入——两 spawn 形共用）
    const scriptsDir = path.join(env.nodeTypesRoot, 'demo', '1.0.0', 'scripts');
    writeFileSync(path.join(scriptsDir, 'net-cap-e2e.ts'), NET_CAP_E2E_TS, 'utf8');
    writeFileSync(path.join(scriptsDir, 'net-cap-e2e.py'), NET_CAP_E2E_PY, 'utf8');
  });
  afterAll(async () => {
    for (const sb of executors) await sb.dispose().catch(() => undefined);
    await netBridge.dispose().catch(() => undefined);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    env.dispose();
  });

  const spawnNetCap = async (
    overrides: Parameters<SandboxTestEnv['makeExecutor']>[0],
    script: string,
    nodeRunId: string,
    lang: 'ts' | 'py' = 'ts',
  ) => {
    const sb = env.makeExecutor(overrides);
    executors.push(sb);
    const c = collectEvents(sb);
    await sb.spawnScript(
      spawnReq({
        scriptPath: path.join('demo', '1.0.0', 'scripts', script),
        lang,
        params: { targetUrl: `http://127.0.0.1:${httpPort}/api`, deniedUrl: 'https://evil.example.net/exfil' },
        nodeRunId,
      }),
    );
    return c;
  };

  it('门开（N1 类目含「网络」）→ ctx.net.fetch 真宿主真往返＋白名单外真拒（ts）', async () => {
    const c = await spawnNetCap({ netEndpointOf: gateEndpointOf([netDef('网络·演示')]) }, 'net-cap-e2e.ts', 'r-net12b:n-ts');
    const exit = await c.waitForExit(45_000);
    expect(exit.code).toBe(0);
    const term = c.frames().at(-1) as { out: { data: Record<string, unknown> } };
    expect(term.out.data).toMatchObject({
      status: 200,
      statusText: 'OK',
      body: NET_E2E_BODY,
      deniedCode: 'NET-DENIED',
    });
    // headers 面：请求 headers 上桥（x-probe）→ 真响应头回读（echo-x-probe 回显）
    expect((term.out.data.headers as Record<string, string>)['echo-x-probe']).toBe('constella');
    // 真宿主面：scope 已开＋拒绝台账（PM 授权形 {time,domain,url}）
    expect(netBridge.endpointOf('r-net12b:n-ts')).not.toBe('');
    expect(netBridge.denials()).toMatchObject([{ domain: 'evil.example.net', url: 'https://evil.example.net/exfil' }]);
    // 本地 http 目标真达（宿主 main 进程发起——headers 真上桥）
    expect(httpHits.some((h) => h.url === '/api' && h.xProbe === 'constella')).toBe(true);
  }, 60_000);

  it('门关（无网络类目）对照 → 不注入 NET_WS → ctx.net.fetch=SDK_CAP_UNAVAILABLE、exit 1', async () => {
    const c = await spawnNetCap({ netEndpointOf: gateEndpointOf([netDef('工具')]) }, 'net-cap-e2e.ts', 'r-net12b:n-ts-off');
    const exit = await c.waitForExit(45_000);
    expect(exit.code).toBe(1);
    const term = c.frames().at(-1) as { type: string; name: string; code: string; message: string };
    expect(term.type).toBe('error');
    expect(term.name).toBe('SdkCapUnavailableError');
    expect(term.code).toBe('SDK_CAP_UNAVAILABLE');
    expect(term.message).toContain('net.fetch');
    // 门未开=无 scope（端点空串——net-gate 整判面）
    expect(netBridge.endpointOf('r-net12b:n-ts-off')).toBe('');
  }, 60_000);

  it('门开（py 侧）→ RFC6455 极简客户端对真 ws 服务端同判据真往返（lang=py）', async () => {
    const c = await spawnNetCap(
      { netEndpointOf: gateEndpointOf([netDef('网络·演示')]) },
      'net-cap-e2e.py',
      'r-net12b:n-py',
      'py', // py 链 spawn 形参（S-4）——PyExecutor 驱动，RFC6455 极简客户端对真 ws 服务端
    );
    const exit = await c.waitForExit(45_000);
    expect(exit.code).toBe(0);
    const term = c.frames().at(-1) as { out: { data: Record<string, unknown> } };
    expect(term.out.data).toMatchObject({
      status: 200,
      statusText: 'OK',
      body: NET_E2E_BODY,
      deniedCode: 'NET-DENIED',
    });
    expect((term.out.data.headers as Record<string, string>)['echo-x-probe']).toBe('constella');
    expect(netBridge.endpointOf('r-net12b:n-py')).not.toBe('');
    expect(netBridge.denials()).toMatchObject([
      { domain: 'evil.example.net', url: 'https://evil.example.net/exfil' },
      { domain: 'evil.example.net', url: 'https://evil.example.net/exfil' },
    ]);
  }, 60_000);
});
