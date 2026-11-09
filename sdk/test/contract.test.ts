// TDD-K-01 §6.1 ts 契约测试（T4-10）：fixtures 六形态驱动 bootstrap（S-5 基）。
//
// 驱动形态（S-5 直跑变体）：本测试生成 entry（`import { boot } from '@constella/sdk/bootstrap';
// boot(m.run)`——C-M1 SandboxExecutor 生成 entry 的同构形态）后 spawn `node <entry>` 子进程，
// 经 CONSTELLA_CTX 注入 ctx、采集 stdout JSON 行帧与 exit 码，与 fixtures/expected/*.json 对照。
//
// 对照规则（§1 帧形冻结 + §6.2 同构剥除同口径）：
//   - result 终帧剥 runtime 字段（{node,electron,execPath,sdkVersion} 随环境变，另行断言字段集与值域）；
//   - error 终帧剥 stack 字段（行号随实现变）；其余字段逐帧 toStrictEqual（帧形冻结=多字段/少字段均失败）；
//   - 终帧恰一且为末行、stdout 全行可解析为 JSON、stderr 不承载协议（应空，S-5①）；
//   - exit 0/1/2 逐场景断言（S-5②：0=成功；1=脚本错误含 OUT_INVALID 与能力 stub 抛错；2=装配错误）。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { SdkCapUnavailableError } from '@constella/sdk';
import pkg from '../package.json';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(SDK_ROOT, 'fixtures');
const EXPECTED_DIR = path.join(FIXTURES_DIR, 'expected');
const ENTRY_DIR = path.join(SDK_ROOT, '.tmp', 'contract', 'entries');
const CHILD_TIMEOUT_MS = 15_000;

// ---------- 期望资产（fixtures/expected/*.json —— 六形态冻结契约，py 侧 T4-11 复用同集） ----------
interface Expected {
  id: string;
  ctx: unknown;
  exit: number;
  frames: unknown[];
}

function loadExpected(): Expected[] {
  const files = readdirSync(EXPECTED_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  expect(files, '期望资产恰六份（S-5 六形态）').toHaveLength(6);
  return files.map((f) => {
    const e = JSON.parse(readFileSync(path.join(EXPECTED_DIR, f), 'utf8')) as Expected;
    expect(e.id, `期望 id 应与文件名一致：${f}`).toBe(f.replace(/\.json$/, ''));
    return e;
  });
}

// ---------- 子进程驱动 ----------
interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runChild(entryPath: string, env: NodeJS.ProcessEnv): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entryPath], {
      cwd: SDK_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      }
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err, timedOut });
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: String(e), timedOut });
    });
  });
}

// §12.1 env 白名单（S-5⑧ 实测）：PATH/SYSTEMROOT/TEMP + CONSTELLA_*（测试子进程=纯 node，
// 无 ELECTRON_RUN_AS_NODE；electron-as-node 矩阵归 C-M1/S-5）。
function baseEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    TEMP: process.env.TEMP ?? '',
    CONSTELLA_RUN_ID: 'sdk-contract',
  };
}

function envWithCtx(ctx: unknown, raw?: string): NodeJS.ProcessEnv {
  const env = baseEnv();
  env.CONSTELLA_CTX = raw ?? JSON.stringify(ctx);
  return env;
}

// ---------- 帧解析与对照 ----------
type Frame = Record<string, unknown>;

function parseFrames(stdout: string): { frames: Frame[]; unparseable: string[] } {
  const frames: Frame[] = [];
  const unparseable: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const f = JSON.parse(line) as unknown;
      if (typeof f === 'object' && f !== null && !Array.isArray(f)) frames.push(f as Frame);
      else unparseable.push(line);
    } catch {
      unparseable.push(line);
    }
  }
  return { frames, unparseable };
}

function stripVolatile(frame: Frame): Frame {
  const copy: Frame = { ...frame };
  if (copy.type === 'result') delete copy.runtime;
  if (copy.type === 'error') delete copy.stack;
  return copy;
}

function assertContract(label: string, expected: Expected, res: ChildResult): Frame[] {
  const { frames, unparseable } = parseFrames(res.stdout);
  expect(unparseable, `${label}: stdout 全部行应为 JSON`).toEqual([]);
  expect(res.stderr, `${label}: stderr 不承载协议、应为空`).toBe('');
  expect(res.timedOut, `${label}: 不应超时`).toBe(false);
  const terminals = frames.filter((f) => f.type === 'result' || f.type === 'error');
  expect(terminals, `${label}: 终帧（result|error）应恰一`).toHaveLength(1);
  expect(frames[frames.length - 1], `${label}: 终帧应为末行`).toBe(terminals[0]);
  expect(res.code, `${label}: exit 码（0=成功/1=脚本错误/2=装配错误）`).toBe(expected.exit);
  expect(
    frames.map((f) => stripVolatile(f)),
    `${label}: 帧序列剥 runtime/stack 后应与期望 JSON 逐帧一致`,
  ).toStrictEqual(expected.frames);
  return frames;
}

// ---------- entry 生成（C-M1 SandboxExecutor entry 同构形态） ----------
function fixtureEntry(fixtureId: string): string {
  const rel = path.relative(ENTRY_DIR, path.join(FIXTURES_DIR, `${fixtureId}.ts`)).replaceAll('\\', '/');
  return [
    `import { boot } from '@constella/sdk/bootstrap';`,
    `import * as m from '${rel}';`,
    `boot(m.run);`,
    '',
  ].join('\n');
}

const ENTRY_NO_RUN = (() => {
  const rel = path.relative(ENTRY_DIR, path.join(FIXTURES_DIR, 's1-basic.ts')).replaceAll('\\', '/');
  return [
    `import { boot } from '@constella/sdk/bootstrap';`,
    `import * as m from '${rel}';`,
    `boot(m.notRun); // 该模块未导出 run —— ENTRY_NO_RUN 装配错误形态`,
    '',
  ].join('\n');
})();

const ENTRY_CAP_ACCESS = [
  `import { boot } from '@constella/sdk/bootstrap';`,
  `boot(async (ctx: import('@constella/sdk').NodeCtx) => {`,
  `  await ctx.llm.json('hi'); // 未绑定能力访问 —— SDK_CAP_UNAVAILABLE 形态`,
  `  return { data: 'unreachable' };`,
  `});`,
  '',
].join('\n');

// ---------- 套件 ----------
const expectedSix = loadExpected();

beforeAll(() => {
  rmSync(path.join(SDK_ROOT, '.tmp', 'contract'), { recursive: true, force: true });
  mkdirSync(ENTRY_DIR, { recursive: true });
  for (const e of expectedSix) writeFileSync(path.join(ENTRY_DIR, `${e.id}.entry.ts`), fixtureEntry(e.id));
  writeFileSync(path.join(ENTRY_DIR, 'no-run.entry.ts'), ENTRY_NO_RUN);
  writeFileSync(path.join(ENTRY_DIR, 'cap-access.entry.ts'), ENTRY_CAP_ACCESS);
});

afterAll(() => {
  rmSync(path.join(SDK_ROOT, '.tmp', 'contract'), { recursive: true, force: true });
});

describe('六形态契约（S-5 基；stdout 帧序列=期望 JSON＋exit 逐场景断言）', () => {
  for (const expected of expectedSix) {
    it(
      `${expected.id}：帧序列=期望 JSON、exit=${expected.exit}`,
      async () => {
        const res = await runChild(path.join(ENTRY_DIR, `${expected.id}.entry.ts`), envWithCtx(expected.ctx));
        const frames = assertContract(expected.id, expected, res);
        const term = frames[frames.length - 1]!;
        if (term.type === 'result') {
          const rt = (term as { runtime?: Record<string, unknown> }).runtime;
          expect(
            rt && Object.keys(rt).sort(),
            'result 终帧 runtime 字段集={node,electron,execPath,sdkVersion}（K-01 §1）',
          ).toEqual(['electron', 'execPath', 'node', 'sdkVersion']);
          expect(rt?.node, 'runtime.node=子进程 node 版本').toBe(process.versions.node);
          expect(rt?.electron, 'runtime.electron：纯 node 子进程应为 null').toBe(null);
          expect(rt?.sdkVersion, 'runtime.sdkVersion=包版本').toBe(pkg.version);
        }
      },
      CHILD_TIMEOUT_MS * 2,
    );
  }
});

describe('装配错误 → exit 2（ENTRY_NO_RUN·CTX_MISSING·CTX_INVALID_JSON，重试无意义）', () => {
  it(
    'CTX_MISSING：未注入 CONSTELLA_CTX → error 终帧 code=CTX_MISSING、exit 2',
    async () => {
      const expected: Expected = {
        id: 'boot-ctx-missing',
        ctx: null,
        exit: 2,
        frames: [{ type: 'error', name: 'SdkError', message: '缺少 CONSTELLA_CTX 环境变量', code: 'CTX_MISSING' }],
      };
      const res = await runChild(path.join(ENTRY_DIR, 's1-basic.entry.ts'), baseEnv());
      assertContract(expected.id, expected, res);
    },
    CHILD_TIMEOUT_MS * 2,
  );

  it(
    'CTX_INVALID_JSON：CONSTELLA_CTX 非法 JSON → error 终帧 code=CTX_INVALID_JSON、exit 2',
    async () => {
      const expected: Expected = {
        id: 'boot-ctx-invalid-json',
        ctx: null,
        exit: 2,
        frames: [
          { type: 'error', name: 'SdkError', message: 'CONSTELLA_CTX 不是合法 JSON', code: 'CTX_INVALID_JSON' },
        ],
      };
      const res = await runChild(path.join(ENTRY_DIR, 's1-basic.entry.ts'), envWithCtx(null, '{"params":{'));
      assertContract(expected.id, expected, res);
    },
    CHILD_TIMEOUT_MS * 2,
  );

  it(
    'ENTRY_NO_RUN：entry 未导出 run → error 终帧 code=ENTRY_NO_RUN、exit 2',
    async () => {
      const expected: Expected = {
        id: 'boot-entry-no-run',
        ctx: { params: {}, input: null },
        exit: 2,
        frames: [{ type: 'error', name: 'SdkError', message: '脚本未导出 run(ctx)', code: 'ENTRY_NO_RUN' }],
      };
      const res = await runChild(path.join(ENTRY_DIR, 'no-run.entry.ts'), envWithCtx(expected.ctx));
      assertContract(expected.id, expected, res);
    },
    CHILD_TIMEOUT_MS * 2,
  );
});

describe('caps 未绑定 stub（访问即抛 SDK_CAP_UNAVAILABLE——V1.0 冻结面，绑定实装不在本卡）', () => {
  it(
    '子进程：run 内访问未绑定能力 → error 终帧 code=SDK_CAP_UNAVAILABLE、exit 1',
    async () => {
      const expected: Expected = {
        id: 'cap-unavailable',
        ctx: { params: {}, input: null },
        exit: 1,
        frames: [
          {
            type: 'error',
            name: 'SdkCapUnavailableError',
            message: 'SDK_CAP_UNAVAILABLE:llm.json（能力未绑定；运行时绑定注入见 02 §14/§12.1）',
            code: 'SDK_CAP_UNAVAILABLE',
          },
        ],
      };
      const res = await runChild(path.join(ENTRY_DIR, 'cap-access.entry.ts'), envWithCtx(expected.ctx));
      assertContract(expected.id, expected, res);
    },
    CHILD_TIMEOUT_MS * 2,
  );

  it('七 Cap（browser/llm/net/file/im/vault/agent）任一成员访问即抛 code=SDK_CAP_UNAVAILABLE', async () => {
    const sdk = await import('@constella/sdk');
    const probes: Array<[string, string]> = [
      ['browser', 'open'],
      ['llm', 'json'],
      ['net', 'fetch'],
      ['file', 'read'],
      ['im', 'pollUnread'],
      ['vault', 'exec'],
      ['agent', 'reply'],
    ];
    for (const [cap, member] of probes) {
      const stub = sdk.unboundCap(cap) as unknown as Record<string, unknown>;
      const access = () => (stub[member] as () => void)();
      let caught: unknown;
      try {
        access();
      } catch (e) {
        caught = e;
      }
      expect(caught, `ctx.${cap}.${member} 访问应抛错`).toBeInstanceOf(sdk.SdkCapUnavailableError);
      expect((caught as SdkCapUnavailableError).code).toBe('SDK_CAP_UNAVAILABLE');
      expect((caught as Error).message).toContain(`${cap}.${member}`);
    }
  });
});
