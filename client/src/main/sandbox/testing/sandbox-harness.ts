// SandboxExecutor 测试装配（T4-16）：假 node-types 资产树（02 §12.2#3 布局）＋sdk fixtures
// 六形态复用（T4-10 对端——S-5 共同输入互证）＋事件采集器。
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScriptEvent, SpawnScriptReq } from '@constella/shared/ipc';
import type { LlmEnvSource, SandboxExecutor, SandboxExecutorDeps } from '../sandbox-executor';
import { SandboxExecutor as SandboxExecutorClass } from '../sandbox-executor';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_ROOT = path.resolve(HERE, '..', '..', '..', '..'); // src/main/sandbox/testing → client
export const SDK_ROOT = path.resolve(CLIENT_ROOT, '..', 'sdk');
export const SDK_FIXTURES = path.join(SDK_ROOT, 'fixtures');
export const SDK_MODULES = {
  sdk: path.join(SDK_ROOT, 'src', 'index.ts'),
  bootstrap: path.join(SDK_ROOT, 'src', 'bootstrap.ts'),
};

/** electron 二进制（devDep 安装态；未装=undefined——electron-as-node 口径跳过留痕） */
export function electronExecPath(): string | undefined {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const p = path.join(CLIENT_ROOT, 'node_modules', 'electron', 'dist', exe);
  return existsSync(p) ? p : undefined;
}

/** 自定义 fixture 脚本（沙箱链路专用——hang/密钥打印/env 探针/caps ws 往返） */
export const CUSTOM_FIXTURES: Record<string, string> = {
  // 不退出进程（Watchdog §6.1b 面）：到点强杀兜底
  'hang.ts': [
    "import type { NodeCtx, NodeOut } from '@constella/sdk';",
    'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
    "  ctx.log('hanging-forever');",
    '  for (;;) { await ctx.sleep(200); }',
    '}',
    '',
  ].join('\n'),
  // §6.1f：stdout 打明文 apiKey → 事件面应收 sk-***
  'print-secret.ts': [
    "import type { NodeCtx, NodeOut } from '@constella/sdk';",
    'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
    "  ctx.log('llm key: sk-test-123xyz (plaintext)');",
    "  console.log('raw channel: sk-another-key-999');",
    "  return { data: 'printed' };",
    '}',
    '',
  ].join('\n'),
  // env 探针：CONSTELLA_* 注入面回读（不回明文 key 本体——掩码面另测）
  'env-probe.ts': [
    "import type { NodeCtx, NodeOut } from '@constella/sdk';",
    'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
    '  const e = process.env;',
    '  return {',
    '    data: {',
    '      runId: e.CONSTELLA_RUN_ID,',
    '      nodeId: e.CONSTELLA_NODE_ID,',
    '      vaultPath: e.CONSTELLA_VAULT_PATH,',
    '      llmBaseUrl: e.CONSTELLA_LLM_BASE_URL,',
    '      hasApiKey: typeof e.CONSTELLA_LLM_API_KEY === "string" && e.CONSTELLA_LLM_API_KEY.length > 0,',
    '      ctxParams: e.CONSTELLA_CTX === undefined ? null : JSON.parse(e.CONSTELLA_CTX).params,',
    '      cdpWs: e.CONSTELLA_CDP_WS ?? null,',
    '      netWs: e.CONSTELLA_NET_WS ?? null,',
    '      runAsNode: e.ELECTRON_RUN_AS_NODE,',
    '      hasSystemRoot: e.SystemRoot !== undefined,',
    '      cwd: process.cwd(),',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n'),
  // caps 绑定态（PM 登记补跑）：子进程内经 CONSTELLA_CDP_WS/NET_WS ws 帧往返＋白名单拒 NET-DENIED
  'caps-ws.ts': [
    "import type { NodeCtx, NodeOut } from '@constella/sdk';",
    'interface Frame { id: number; ns: string; method: string; params: Record<string, unknown> }',
    'async function roundTrip(url: string, frames: Frame[]): Promise<unknown[]> {',
    '  const ws = new WebSocket(url);',
    '  await new Promise<void>((res, rej) => {',
    '    const onErr = (): void => rej(new Error("ws error " + url));',
    '    ws.addEventListener("error", onErr);',
    '    ws.addEventListener("open", () => { ws.removeEventListener("error", onErr); res(); });',
    '    setTimeout(() => rej(new Error("ws open timeout " + url)), 5000);',
    '  });',
    '  const replies: unknown[] = [];',
    '  for (const f of frames) ws.send(JSON.stringify(f));',
    '  for (let i = 0; i < frames.length; i++) {',
    '    replies.push(await new Promise<unknown>((res) => {',
    '      const h = (ev: MessageEvent): void => { ws.removeEventListener("message", h); res(JSON.parse(String(ev.data))); };',
    '      ws.addEventListener("message", h);',
    '    }));',
    '  }',
    '  ws.close();',
    '  return replies;',
    '}',
    'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
    '  const out: Record<string, unknown> = {};',
    '  if (process.env.CONSTELLA_CDP_WS !== undefined) {',
    '    out.cdp = await roundTrip(process.env.CONSTELLA_CDP_WS, [',
    '      { id: 1, ns: "cdp", method: "Page.enable", params: {} },',
    '      { id: 2, ns: "cdp", method: "Runtime.evaluate", params: { expression: "1+1" } },',
    '    ]);',
    '  }',
    '  if (process.env.CONSTELLA_NET_WS !== undefined) {',
    '    out.net = await roundTrip(process.env.CONSTELLA_NET_WS, [',
    '      { id: 1, ns: "net", method: "fetch", params: { url: "https://allowed.example.com/api" } },',
    '      { id: 2, ns: "net", method: "fetch", params: { url: "https://evil.example.net/exfil" } },',
    '    ]);',
    '  }',
    '  ctx.log("caps-ws-done");',
    '  return { data: out };',
    '}',
    '',
  ].join('\n'),
};

/** 假资产树（node-types/<type>/<ver>/scripts/…——02 §12.2#3 布局） */
export interface SandboxTestEnv {
  root: string;
  nodeTypesRoot: string;
  sandboxRoot: string;
  /** 资产脚本绝对路径（key=文件名） */
  scripts: Record<string, string>;
  makeExecutor(overrides?: Partial<SandboxExecutorDeps>): SandboxExecutor;
  llmSource: LlmEnvSource & { set(baseUrl: string, apiKeyRef: string | null): void };
  revealCalls: string[];
  dispose(): void;
}

/** 组装测试环境：tmp userData＋假 node-types（sdk 六形态拷入＋自定义 fixture） */
export function makeSandboxEnv(): SandboxTestEnv {
  const root = mkdtempSync(path.join(tmpdir(), 'constella-sbx-'));
  const nodeTypesRoot = path.join(root, 'node-types');
  const sandboxRoot = path.join(root, 'sandbox');
  const pkgScripts = path.join(nodeTypesRoot, 'demo', '1.0.0', 'scripts');
  mkdirSync(pkgScripts, { recursive: true });
  mkdirSync(sandboxRoot, { recursive: true });

  const scripts: Record<string, string> = {};
  // sdk fixtures 六形态（T4-10 对端复用）＋lib/（s3 相对 import）
  for (const f of readdirSync(SDK_FIXTURES)) {
    if (f.endsWith('.ts')) {
      copyFileSync(path.join(SDK_FIXTURES, f), path.join(pkgScripts, f));
      scripts[f] = path.join(pkgScripts, f);
    }
  }
  const libSrc = path.join(SDK_FIXTURES, 'lib');
  const libDst = path.join(pkgScripts, 'lib');
  mkdirSync(libDst, { recursive: true });
  for (const f of readdirSync(libSrc)) copyFileSync(path.join(libSrc, f), path.join(libDst, f));
  // 自定义 fixture
  for (const [name, source] of Object.entries(CUSTOM_FIXTURES)) {
    writeFileSync(path.join(pkgScripts, name), source, 'utf8');
    scripts[name] = path.join(pkgScripts, name);
  }

  const llmState = { baseUrl: '', apiKeyRef: null as string | null };
  const llmSource = Object.assign(
    (): { baseUrl: string; apiKeyRef: string | null } => ({ ...llmState }),
    {
      set(baseUrl: string, apiKeyRef: string | null): void {
        llmState.baseUrl = baseUrl;
        llmState.apiKeyRef = apiKeyRef;
      },
    },
  );
  const revealCalls: string[] = [];

  return {
    root,
    nodeTypesRoot,
    sandboxRoot,
    scripts,
    llmSource,
    revealCalls,
    makeExecutor(overrides?: Partial<SandboxExecutorDeps>): SandboxExecutor {
      const deps: SandboxExecutorDeps = {
        sandboxRoot,
        nodeTypesRoot,
        revealSecret: (refKey) => {
          revealCalls.push(refKey);
          return 'sk-test-123xyz';
        },
        sdkModules: SDK_MODULES,
        llm: llmSource,
        ...overrides,
      };
      return new SandboxExecutorClass(deps);
    },
    dispose(): void {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理 */
      }
    },
  };
}

/** 基准 spawn req（ts 链；script=资产树内脚本绝对/相对形） */
export function spawnReq(overrides: Partial<SpawnScriptReq> & { scriptPath: string }): SpawnScriptReq {
  return {
    nodeRunId: 'r-test:n-1',
    lang: 'ts',
    entry: 'run',
    params: {},
    input: null,
    timeoutMs: 0,
    retries: 0,
    ...overrides,
  };
}

/** 事件采集器：stdout 拼流+帧解析+exit 码 */
export interface EventCollector {
  events: ScriptEvent[];
  stdoutText(): string;
  frames(): Array<Record<string, unknown>>;
  exitEvent(): ScriptEvent | undefined;
  waitForExit(timeoutMs: number): Promise<ScriptEvent>;
}

export function collectEvents(executor: SandboxExecutor): EventCollector {
  const events: ScriptEvent[] = [];
  executor.onScriptEvent((e) => events.push(e));
  let waiters: Array<(e: ScriptEvent) => void> = [];
  executor.onScriptEvent((e) => {
    if (e.kind === 'exit') {
      const ws = waiters;
      waiters = [];
      for (const w of ws) w(e);
    }
  });
  return {
    events,
    stdoutText(): string {
      return events
        .filter((e) => e.kind === 'stdout' && typeof e.chunk === 'string')
        .map((e) => e.chunk)
        .join('');
    },
    frames(): Array<Record<string, unknown>> {
      return this.stdoutText()
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    exitEvent(): ScriptEvent | undefined {
      return events.find((e) => e.kind === 'exit');
    },
    waitForExit(timeoutMs: number): Promise<ScriptEvent> {
      const exit = this.exitEvent();
      if (exit !== undefined) return Promise.resolve(exit);
      return new Promise<ScriptEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitForExit 超时')), timeoutMs);
        waiters.push((e) => {
          clearTimeout(timer);
          resolve(e);
        });
      });
    },
  };
}

/** 拉起一个游离挂死进程（孤儿清扫用——不经 executor） */
export function spawnOrphan(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (child.pid === undefined) throw new Error('orphan 未取得 pid');
  return child.pid;
}

/** 等待 pid 死亡（ESRCH 观测） */
export function waitPidDead(pid: number, timeoutMs: number): Promise<boolean> {
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
