// head-run harness —— node 侧真 electron 拉起/控制/清理（T4-18；S-3 工程链）。
//
// 职责：esbuild 打包 head-run-main.ts（external 仅 electron——shared/ws 全内联，规避 dist 产物
// 对 @constella/shared 的运行期解析依赖）→ spawn 真 electron 二进制（client/node_modules/electron/
// dist/electron.exe；CI/新机须先 node node_modules/electron/install.js）→ 等 stdout `@@CTRL@@`
// ready 行（origin＋控制面 ws 端点）→ JSON-RPC over ws（{id,cmd,args}→{id,ok,...}）→
// quit＋强杀兜底（taskkill /PID /T /F——win32 冻结口径，S-4）＋临时目录清理。
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..', '..', '..', '..'); // src/main/cdp/testing → client
const CTRL_PREFIX = '@@CTRL@@';

function electronBinary(): string {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const p = path.join(CLIENT_ROOT, 'node_modules', 'electron', 'dist', exe);
  if (!fs.existsSync(p)) {
    throw new Error(`electron 二进制不在位：${p}——先 node node_modules/electron/install.js（S-3 工程链）`);
  }
  return p;
}

export interface HeadRunOptions {
  /** userData 目录（partition 落盘隔离；跨进程持久化用例两阶段传同目录） */
  userData: string;
  /** 端口段注入（耗尽用例等；缺省=9221–9320） */
  poolRange?: { first: number; last: number };
  /** ready 等待上限 ms（缺省 60s——冷启动含 Windows Defender 首扫余量） */
  readyTimeoutMs?: number;
  /** 入口文件覆盖（T4-20：缺省=本目录 head-run-main.ts；runtime 冒烟传 testing/app-head-run-main.ts） */
  entry?: string;
  /**
   * bundle external 追加（T4-20：缺省仅 electron；runtime 冒烟需加 better-sqlite3〔原生模块〕
   * 与 esbuild〔spawn 期转译服务二进制〕——运行期自 client/node_modules 解析）
   */
  externals?: string[];
}

export interface InvokeResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export interface HeadRunHandle {
  pid: number;
  /** 测试页 origin（内置 http server） */
  origin: string;
  /** 已注册通道名（真 ipcMain.handle 注册冒烟面） */
  channels: string[];
  /** 控制命令 */
  control<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** 经 IpcGateway 包装层的真通道 invoke（校验/序列化全真） */
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<InvokeResult<T>>;
  /** 退出：quit 命令→等进程退出→超时 taskkill /T /F 兜底 */
  quit(): Promise<void>;
}

interface ReadyLine {
  event: 'ready';
  origin: string;
  control: string;
  channels: string[];
}

/** 拉起一个真 electron head-run 实例 */
export async function launchHeadRun(label: string, opts: HeadRunOptions): Promise<HeadRunHandle> {
  fs.mkdirSync(opts.userData, { recursive: true });
  const outfile = path.join(CLIENT_ROOT, 'dist', 'headrun', `cdp-head-run-${label}.js`);
  await build({
    entryPoints: [opts.entry !== undefined ? path.resolve(HERE, opts.entry) : path.join(HERE, 'head-run-main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron', ...(opts.externals ?? [])],
    sourcemap: false,
    minify: false,
    logLevel: 'silent',
    absWorkingDir: CLIENT_ROOT,
  });

  const args = [outfile, `--user-data=${opts.userData}`];
  if (opts.poolRange !== undefined) {
    args.push(`--pool-first=${opts.poolRange.first}`, `--pool-last=${opts.poolRange.last}`);
  }
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.ELECTRON_RUN_AS_NODE; // 必须：缺省按 Electron main 语义
  const child: ChildProcess = spawn(electronBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'], env });

  const stderrTail: string[] = [];
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => {
    stderrTail.push(d);
    if (stderrTail.length > 40) stderrTail.shift();
  });

  // ready 行（stdout @@CTRL@@ 前缀——其余输出忽略）
  const ready = await new Promise<ReadyLine>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `head-run ready 超时：\nstderr 尾部：\n${stderrTail.join('')}`,
          ),
        ),
      opts.readyTimeoutMs ?? 60_000,
    );
    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.includes(CTRL_PREFIX)) continue;
        const payload = JSON.parse(line.slice(line.indexOf(CTRL_PREFIX) + CTRL_PREFIX.length)) as ReadyLine;
        clearTimeout(timer);
        resolve(payload);
        return;
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`head-run 进程提前退出（code=${code}）\nstderr 尾部：\n${stderrTail.join('')}`));
    });
  });

  // 控制 ws 客户端
  const ws = new WebSocket(ready.control);
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('控制 ws 连接超时（15s）')), 15_000)),
  ]);
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextId = 1;
  ws.on('message', (data) => {
    const frame = JSON.parse(String(data)) as { id: number; ok: boolean; result?: unknown; error?: { message: string } };
    const waiter = pending.get(frame.id);
    if (waiter === undefined) return;
    pending.delete(frame.id);
    if (frame.ok) waiter.resolve(frame.result);
    else waiter.reject(new Error(frame.error?.message ?? 'head-run 控制命令失败'));
  });

  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? 0));
  });

  const control = async <T>(cmd: string, argsMap: Record<string, unknown> = {}): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      // 控制面 30s 硬超时：无界等待会把任何卡死放大成套件级挂起
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`head-run 控制命令超时（30s）：${cmd}`));
      }, 30_000);
      pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, cmd, args: argsMap }));
    });
  };

  const hardKill = async (): Promise<void> => {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    await exited;
  };

  return {
    pid: child.pid ?? -1,
    origin: ready.origin,
    channels: ready.channels,
    control,
    invoke: (channel, payload) => control('invoke', { channel, payload }),
    async quit(): Promise<void> {
      try {
        await Promise.race([
          control('quit'),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('quit 超时')), 10_000)),
        ]);
      } catch {
        /* 退到强杀兜底 */
      }
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 8_000))]);
      await hardKill();
      // 同 userData 复启（跨进程持久化用例）前的结算窗：让 OS 释放 profile 锁/清扫游离子进程，
      // 避免第二实例与残留锁竞争（并行全套件下实测必要）。
      await new Promise((r) => setTimeout(r, 1_000));
    },
  };
}

/** 临时 userData 目录清理（partition 目录含 Chromium 锁文件——延迟重试 best-effort） */
export async function removeDir(dir: string): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
