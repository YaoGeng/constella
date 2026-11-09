// SandboxExecutor py 链 S-4 复现链（T4-17 验收=TDD-C-M1 §6.1a py 侧＋§6.1c＋§6.1d＋§6.1e；
// 验收命令 `pnpm -F ./client exec vitest run main/sandbox -t "py"` 的主件）。
//
// 对端互证：sdk/py/fixtures 六形态（T4-11=S-4/S-5 共同输入）驱动 spawn 全链（py 启动器一次解析
// →包/脚本置入沙箱 scripts/→entry 生成〔v1.0d 垫片〕→spawn `python -I -X utf8 <entry>`→
// CONSTELLA_CTX 注入→stdout JSON 行帧→exit 0/1/2），帧序列与 sdk/fixtures/expected 共享期望
// 逐帧对照（剥 runtime/stack——K-01 §6 同口径）。
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assembleChildEnv } from './sandbox-executor';
import { PyExecutor } from './py-executor';
import { ProcessKiller, tasklistAlive, type KillReport } from './process-killer';
import { WorkdirFactory } from './workdir-factory';
import {
  SDK_PY_PACKAGE,
  SDK_ROOT,
  collectEvents,
  makeSandboxEnv,
  spawnReq,
  waitPidDead,
  type SandboxTestEnv,
} from './testing/sandbox-harness';

/** 期望资产（S-5/S-4 六形态冻结契约——ts/py 双运行时同一套，K-01 §6 同源） */
interface Expected {
  id: string;
  ctx: unknown;
  exit: number;
  frames: unknown[];
}

const EXPECTED_DIR = path.join(SDK_ROOT, 'fixtures', 'expected');
const EXPECTED_SIX: Expected[] = ['s1-basic', 's2-compute', 's3-relative-import', 's4-error', 's5-branch', 's6-invalid-out'].map(
  (id) => JSON.parse(readFileSync(path.join(EXPECTED_DIR, `${id}.json`), 'utf8')) as Expected,
);

/** py fixture 文件名（id 中划线→下划线：s1-basic → s1_basic.py） */
const pyFixture = (id: string): string => id.replaceAll('-', '_') + '.py';

/** py sdkVersion（sdk/py/constella_sdk/__init__.py __version__——两包恒等 T4-12 面） */
const PY_SDK_VERSION = /__version__\s*=\s*"([^"]+)"/.exec(
  readFileSync(path.join(SDK_PY_PACKAGE, '__init__.py'), 'utf8'),
)![1]!;

/** 帧剥波动字段（result→runtime；error→stack——K-01 §6.2 同构剥除口径） */
function stripVolatile(frame: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...frame };
  if (copy.type === 'result') delete copy.runtime;
  if (copy.type === 'error') delete copy.stack;
  return copy;
}

/** 六形态断言（§6.1a py 侧：终帧恰一且末行＋exit 逐场景＋帧序列=期望 JSON） */
function assertSixContract(label: string, expected: Expected, frames: Array<Record<string, unknown>>, exitCode: number, stderrText: string): void {
  expect(frames.length, `${label}: stdout 至少含终帧`).toBeGreaterThan(0);
  const terminals = frames.filter((f) => f.type === 'result' || f.type === 'error');
  expect(terminals, `${label}: 终帧（result|error）恰一`).toHaveLength(1);
  expect(frames[frames.length - 1], `${label}: 终帧为末行`).toBe(terminals[0]);
  expect(exitCode, `${label}: exit 码（0=成功/1=脚本错误/2=装配错误）`).toBe(expected.exit);
  expect(frames.map(stripVolatile), `${label}: 帧序列剥 runtime/stack 后与期望 JSON 逐帧一致`).toStrictEqual(expected.frames);
  expect(stderrText.includes('"type":"result"') || stderrText.includes('"type":"error"'), `${label}: stderr 不承载协议`).toBe(false);
}

/** 轮询等待谓词真（超时抛错——TREE_READY/KillReport 异步到齐面） */
async function pollUntil(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const startedAt = Date.now();
  while (!cond()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`等待超时: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('py 链 · 协议三态（§6.1a py 侧——fixtures=T4-11 py 六形态复跑）', () => {
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
      `py 六形态：${expected.id}（帧序列=期望 JSON、exit=${expected.exit}）`,
      async () => {
        const sb = env.makeExecutor();
        const c = collectEvents(sb);
        const ctx = (expected.ctx ?? {}) as { params?: Record<string, unknown>; input?: unknown };
        await sb.spawnScript(
          spawnReq({
            lang: 'py',
            scriptPath: path.join('demo', '1.0.0', 'scripts', pyFixture(expected.id)),
            params: ctx.params ?? {},
            input: ctx.input ?? null,
            nodeRunId: `r-py:n-${expected.id}`,
          }),
        );
        const exit = await c.waitForExit(30_000);
        const stderrText = c.events.filter((e) => e.kind === 'stderr').map((e) => e.chunk ?? '').join('');
        assertSixContract(expected.id, expected, c.frames(), exit.code ?? -1, stderrText);
        // runtime 字段集与运行体判定（K-01 §1 py 槽位：electron 恒 None；node=python 版本）
        const term = c.frames().at(-1)!;
        if (term.type === 'result') {
          const runtime = (term as { runtime?: Record<string, unknown> }).runtime;
          expect(Object.keys(runtime ?? {}).sort()).toEqual(['electron', 'execPath', 'node', 'sdkVersion']);
          expect(runtime!.electron).toBe(null); // py 无 electron 对应物
          expect(runtime!.sdkVersion).toBe(PY_SDK_VERSION);
          expect(String(runtime!.execPath).toLowerCase().endsWith('python.exe')).toBe(true);
        }
      },
      45_000,
    );
  }

  it(
    'py entry 缺 run（ENTRY_NO_RUN）→ error 终帧＋exit 2（§6.1a 装配错误态）',
    async () => {
      const sb = env.makeExecutor();
      const c = collectEvents(sb);
      await sb.spawnScript(
        spawnReq({
          lang: 'py',
          scriptPath: path.join('demo', '1.0.0', 'scripts', 's1_basic.py'),
          entry: 'notRun', // 模块未导出该入口函数（getattr None≈ts undefined）
          nodeRunId: 'r-py:n-no-run',
        }),
      );
      const exit = await c.waitForExit(30_000);
      const frames = c.frames();
      const term = frames.at(-1) as { type: string; code: string; message: string };
      expect(term.type).toBe('error');
      expect(term.code).toBe('ENTRY_NO_RUN');
      expect(term.message).toContain('run');
      expect(exit.code).toBe(2);
    },
    45_000,
  );
});

describe('py 链 · env 断言面（§6.1d 传入 env 块键集严格相等＋§6.1e cwd·TEMP·TMP 三同）', () => {
  let env: SandboxTestEnv;
  beforeAll(() => {
    env = makeSandboxEnv();
  });
  afterAll(async () => {
    await env.makeExecutor().dispose().catch(() => undefined);
    env.dispose();
  });

  it('§6.1d 传入 env 块=白名单 5＋CONSTELLA_* 键集严格相等（-I 隔离=禁 PYTHON*；无 RUN_AS_NODE）', () => {
    const factory = new WorkdirFactory({ sandboxRoot: env.sandboxRoot });
    const layout = factory.create('r-py', 'n-env-unit');
    const py = new PyExecutor({ pyPackageDir: SDK_PY_PACKAGE });
    const spec = py.prepare(path.join(env.scripts['s1_basic.py']!), 'run', layout);
    const out = assembleChildEnv({
      mergedParams: { a: 1 },
      input: null,
      runId: 'r-py',
      nodeId: 'n-env-unit',
      workdir: layout,
      revealSecret: () => 'sk-x',
      req: spawnReq({ lang: 'py', scriptPath: 'x.py' }),
      executorEnv: spec.env, // py executorEnv=TEMP/TMP 三同覆盖（executor 末段合入）
    });
    // 键集合严格相等（S-4 ⑤ 传入块口径；libuv 11 注入集不在断言面）
    expect(Object.keys(out).sort()).toEqual(
      [
        'SystemRoot', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec',
        'CONSTELLA_RUN_ID', 'CONSTELLA_NODE_ID', 'CONSTELLA_CTX', 'CONSTELLA_VAULT_PATH',
        'CONSTELLA_LLM_BASE_URL', 'CONSTELLA_LLM_API_KEY',
      ].sort(),
    );
    expect(Object.keys(out).some((k) => k.toUpperCase().startsWith('PYTHON'))).toBe(false); // -I 隔离=禁 PYTHON*
    expect(out.ELECTRON_RUN_AS_NODE).toBeUndefined(); // py 链无 RUN_AS_NODE（ts 链专属）
    expect(out.CONSTELLA_CTX).toBe(JSON.stringify({ params: { a: 1 }, input: null }));
  });

  it(
    '§6.1d/§6.1e 子进程探针：cwd==TEMP==TMP==run 私有目录＋CONSTELLA_* 注入值＋PYTHON* 键集为空',
    async () => {
      env.llmSource.set('https://llm.example/v1', 'secret.ai.apiKey');
      const sb = env.makeExecutor();
      const c = collectEvents(sb);
      await sb.spawnScript(
        spawnReq({
          lang: 'py',
          scriptPath: path.join('demo', '1.0.0', 'scripts', 'env_probe_py.py'),
          params: { probe: 1 },
          nodeRunId: 'r-py:n-env',
        }),
      );
      const exit = await c.waitForExit(30_000);
      expect(exit.code).toBe(0);
      const term = c.frames().at(-1) as { out: { data: Record<string, unknown> } };
      const d = term.out.data;
      expect(d.runId).toBe('r-py');
      expect(d.nodeId).toBe('n-env');
      expect(d.llmBaseUrl).toBe('https://llm.example/v1');
      expect(d.hasApiKey).toBe(true); // reveal 注密明文已入 env（明文不入事件流——掩码面 ts 链 §6.1f 同口径已测）
      expect(d.ctxParams).toEqual({ probe: 1 });
      expect(d.hasSystemRoot).toBe(true);
      expect(d.pythonKeys).toEqual([]); // -I⇒-E：PYTHON* 通道不存在（传入块即无）
      // §6.1e 三同（S-4 ⑥）：cwd==TEMP==TMP==sandbox/<runId>/<nodeId>/（normcase 归一比）
      const nc = (v: unknown): string => path.normalize(String(v)).toLowerCase();
      expect(nc(d.cwd)).toBe(nc(path.join(env.sandboxRoot, 'r-py', 'n-env')));
      expect(nc(d.temp)).toBe(nc(d.cwd));
      expect(nc(d.tmp)).toBe(nc(d.cwd));
      expect(env.revealCalls).toContain('secret.ai.apiKey');
    },
    45_000,
  );
});

describe('py 链 · 三层树超时强杀（§6.1c：killTree 后记录 PID 全 DEAD、KillReport 残留=0）', () => {
  it(
    '三层 python 树 N6 超时→watchdog killTree（ProcessKiller 换装）→全灭＋survivors=[]',
    async () => {
      const env = makeSandboxEnv();
      const killer = new ProcessKiller();
      const reports: KillReport[] = [];
      let rootPid = 0;
      try {
        const sb = env.makeExecutor({
          killTree: (pid) =>
            killer.killTree(pid).then((r) => {
              reports.push(r);
              return r;
            }),
        });
        const c = collectEvents(sb);
        const res = await sb.spawnScript(
          spawnReq({
            lang: 'py',
            scriptPath: path.join('demo', '1.0.0', 'scripts', 'hang_tree.py'),
            timeoutMs: 4_000,
            nodeRunId: 'r-py:n-tree',
          }),
        );
        rootPid = res.pid;
        // 三层就绪（TREE_READY：role/pid/ppid/child_pid——children 继承 root stdout）
        await pollUntil(() => (c.stdoutText().match(/TREE_READY/g) ?? []).length >= 3, 20_000, '三层 TREE_READY');
        const byRole = new Map<string, { pid: number; ppid: number }>();
        for (const m of c.stdoutText().matchAll(/TREE_READY role=(\w+) pid=(\d+) ppid=(\d+)/g)) {
          byRole.set(m[1]!, { pid: Number(m[2]), ppid: Number(m[3]) });
        }
        expect([...byRole.keys()].sort()).toEqual(['child', 'grandchild', 'root']);
        const root = byRole.get('root')!;
        const child = byRole.get('child')!;
        const grandchild = byRole.get('grandchild')!;
        expect(child.ppid).toBe(root.pid); // 链路自证（spike S-4 同口径）
        expect(grandchild.ppid).toBe(child.pid);
        const recorded = [root.pid, child.pid, grandchild.pid];

        const exit = await c.waitForExit(30_000); // 超时强杀触发（观测按 code，S-4 ③）
        expect(exit.code).not.toBe(0);
        expect(exit.ms ?? 0).toBeGreaterThanOrEqual(4_000);
        await pollUntil(() => reports.length >= 1, 10_000, 'KillReport');

        // §6.1c 判据：killTree 后 tasklist 枚举记录 PID 全 DEAD＋KillReport 残留=0
        for (const pid of recorded) {
          expect(await tasklistAlive(pid), `记录 pid=${pid} 应 DEAD`).toBe(false);
        }
        expect(reports[0]!.survivors).toEqual([]);
        expect(reports[0]!.pid).toBe(rootPid);
        expect(await waitPidDead(rootPid, 5_000)).toBe(true);
      } finally {
        if (rootPid !== 0) await killer.killTree(rootPid).catch(() => undefined);
        await env.makeExecutor().dispose().catch(() => undefined);
        env.dispose();
      }
    },
    60_000,
  );
});
