// TsExecutor 组件用例（T4-16 / TDD-C-M1 §3 TsExecutor 行＋S-5 ①④⑤ 配置冻结面；
// 端到端 spawn 复现链见 sandbox-chain.spec〔双运行时口径〕）。
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TsExecutor } from './ts-executor';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..', '..', '..');
const SDK_SRC = path.resolve(CLIENT_ROOT, '..', 'sdk', 'src');
const SDK_MODULES = { sdk: path.join(SDK_SRC, 'index.ts'), bootstrap: path.join(SDK_SRC, 'bootstrap.ts') };

function makeEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), 'constella-tsexec-'));
  return {
    dir,
    dispose: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* 尽力清理 */
      }
    },
  };
}

/** 最小 S-5 脚本（import SDK 形态——值导入 run） */
const S1_LIKE = "import { run } from '@constella/sdk';\nexport { run };\n";

describe('TsExecutor（esbuild cjs/node24/linked＋entry 生成＋RUN_AS_NODE）', () => {
  it('writeEntry：S-5 冻结形（boot＋相对 import＋入口函数名）', () => {
    const env = makeEnv();
    try {
      const ex = new TsExecutor({ sdkModules: SDK_MODULES });
      const script = path.join(env.dir, 'script.ts');
      writeFileSync(script, S1_LIKE, 'utf8');
      const entry = path.join(env.dir, 'gen', 'entry.ts');
      ex.writeEntry(script, entry, 'run');
      const rel = path.relative(path.join(env.dir, 'gen'), script).replaceAll('\\', '/');
      expect(readFileSync(entry, 'utf8')).toBe(
        [
          '// Constella SandboxExecutor 生成 entry（S-5 冻结形——勿手改）',
          "import { boot } from '@constella/sdk/bootstrap';",
          `import * as m from '${rel}';`,
          'boot(m.run);',
          '',
        ].join('\n'),
      );
      // 非 run 入口名（X-01 ExecSpec.entry）与成员访问形
      ex.writeEntry(script, path.join(env.dir, 'gen', 'entry2.ts'), 'main');
      expect(readFileSync(path.join(env.dir, 'gen', 'entry2.ts'), 'utf8')).toContain('boot(m.main);');
    } finally {
      env.dispose();
    }
  });

  it('prepare：bundle 产出（cjs＋linked .map＋sourceMappingURL）＋spawn 规格三件', async () => {
    const env = makeEnv();
    try {
      const ex = new TsExecutor({ sdkModules: SDK_MODULES });
      const script = path.join(env.dir, 'script.ts');
      writeFileSync(script, S1_LIKE, 'utf8');
      const entry = path.join(env.dir, 'scripts', 'entry.ts');
      ex.writeEntry(script, entry, 'run');
      const spec = await ex.prepare(script, entry);
      const bundle = path.join(env.dir, 'scripts', 'bundle.cjs');
      expect(spec.cmd).toBe(process.execPath);
      expect(spec.args).toEqual(['--enable-source-maps', bundle]); // S-5 ⑤ 内建 source map 形参
      expect(spec.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' }); // S-5 ④ 显式注入
      expect(existsSync(bundle)).toBe(true);
      expect(existsSync(`${bundle}.map`)).toBe(true); // sourcemap:'linked' 外置 .map
      const text = readFileSync(bundle, 'utf8');
      expect(text).toContain('//# sourceMappingURL=bundle.cjs.map'); // linked 注释
      expect(text).toContain('SDK_CAP_UNAVAILABLE'); // cjs 产物（SDK bootstrap+caps 已内联打包）
    } finally {
      env.dispose();
    }
  });

  it('prepare 产物经 node 直跑：CONSTELLA_CTX 注入 → result 终帧＋exit 0（S-5 ①② 链路核）', async () => {
    const env = makeEnv();
    try {
      const ex = new TsExecutor({ sdkModules: SDK_MODULES });
      const script = path.join(env.dir, 'script.ts');
      writeFileSync(script, S1_LIKE, 'utf8');
      const entry = path.join(env.dir, 'scripts', 'entry.ts');
      ex.writeEntry(script, entry, 'run');
      const spec = await ex.prepare(script, entry);
      const res = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
        const child = spawn(spec.cmd, spec.args, {
          cwd: env.dir,
          env: { ...spec.env, CONSTELLA_CTX: JSON.stringify({ params: {}, input: { n: 42 } }) },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let out = '';
        child.stdout.on('data', (d) => {
          out += d;
        });
        child.on('close', (code) => resolve({ code, stdout: out }));
      });
      expect(res.code).toBe(0);
      const frames = res.stdout
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(frames.at(-1)!.type).toBe('result');
      expect((frames.at(-1) as { out?: unknown }).out).toEqual({ data: { n: 42 } });
    } finally {
      env.dispose();
    }
  }, 20_000);
});
