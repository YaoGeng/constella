// app-head-run main —— T4-20 启动/退出全序 electron 头跑冒烟宿主（组收尾一）。
//
// 与 cdp/testing/head-run-main.ts 同协议（@@CTRL@@ ready 行＋127.0.0.1 控制 ws＋180s 看门狗），
// 但组装＝**生产装配同构**：经 production-assembly.ts（单一来源——main/index.ts 同函数）真件
// 五服务（真 StorageLayer/better-sqlite3＋safeStorage＋真 BrowserWindow/debugger＋真 ws 桥＋
// 真 CronScheduler/SandboxExecutor）。本文件只做三件事：
//   1) argv/时钟/端口段/脚本资产等冒烟注入位接线；
//   2) ipcMain 记录包装（控制面 invoke 走与生产同一 IpcGateway 校验/序列化链）；
//   3) 观察面（steps/channels/fires/pidAlive/windowCount/nextFire/shutdown）。
//
// 控制命令（{id,cmd,args}→{id,ok,result}）：invoke／steps／channels／clockSet／clockNow／
// fires／nextFire／windowCount／spawnPid 假脚注入由启动期 seed（node-types/smoke.hang）／
// pidAlive／dbWalExists／shutdownNow／quit。
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { assembleProductionRuntime, type ProductionAssembly } from '../production-assembly';
import { serializeError } from '../../ipc/serialize-error';
import { adaptElectronDialog, type IpcMainLike } from '../electron-api';

const CTRL_PREFIX = '@@CTRL@@';
const WATCHDOG_MS = 240_000;

/** argv 解析（同 head-run-main 口径） */
function argValue(name: string): string | undefined {
  const hit = process.argv.find((s) => s.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.split('=').slice(1).join('=');
}

const userData = argValue('user-data');
if (userData === undefined) {
  console.error('[app-head-run] --user-data=<dir> 必填');
  app.exit(2);
  throw new Error('--user-data=<dir> 必填');
}
/** 窄化承托（函数边界外的非空——上方守卫已 throw） */
const userDir: string = userData;
app.setPath('userData', userDir);
app.disableHardwareAcceleration(); // 冒烟窗无需 GPU（S-3 同口径）
// S-3 坑②兜底＝AppRuntime 内建覆盖（生产同构，非本文件补丁）。

setTimeout(() => {
  console.error('[app-head-run] global watchdog fired, exit 2');
  app.exit(2);
}, WATCHDOG_MS).unref();

/** 冒烟假钟（clockSet/clockNow 控制面驱动——CronScheduler deps.now 注入缝） */
const clock = { now: Date.now() };

/** 挂起脚本资产（退出序 killTree 断言靶）：永不 settle 的 ts 节点脚本 */
const SMOKE_NODE_TYPE = 'smoke.hang';
function seedHangingScript(): void {
  const scriptDir = path.join(userDir, 'node-types', SMOKE_NODE_TYPE, '1.0.0', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'main.ts'),
    [
      '// T4-20 冒烟挂起靶（退出序 killTree 断言——勿改：永不 settle 保持进程存活）',
      'export async function run(): Promise<never> {',
      '  return new Promise(() => {});',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function startHttpServer(): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>t420-smoke-target</title><h1>ok</h1>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

/** 装配产物（recorded/steps/fires=控制面观察位；assembly=生产五服务） */
interface Boot {
  assembly: ProductionAssembly;
  recorded: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>;
  steps: string[];
  fires: Array<{ flowId: string; at: number }>;
}

/**
 * 生产装配（与 main/index.ts 同函数——单一来源）＋冒烟注入位。**须在 app ready 前调用**
 * （随后的 startup() 首步 registerSchemesAsPrivileged 是 ready 前置——S-1 ③；本函数自身
 * 只构造不启动）。
 */
function createBoot(): Boot {
  const poolFirst = Number(argValue('pool-first') ?? '0');
  const poolLast = Number(argValue('pool-last') ?? '0');

  // ipcMain 记录包装：控制面 invoke 走生产同一注册 listener（IpcGateway 校验/序列化链全真）
  const recorded = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const recordingIpcMain: IpcMainLike = {
    handle: (channel, listener): void => {
      ipcMain.handle(channel, listener as never);
      recorded.set(channel, listener as (event: unknown, ...args: unknown[]) => Promise<unknown>);
    },
    once: (channel, listener) => ipcMain.once(channel, listener as never),
    removeListener: (channel, listener) => ipcMain.removeListener(channel, listener as never),
  };

  // CJS bundle 语境：__dirname=client/dist/headrun（harness 打包落位）→ 上溯两级=client 根
  const CLIENT_ROOT = path.resolve(__dirname, '..', '..');
  const REPO_ROOT = path.resolve(CLIENT_ROOT, '..');
  const steps: string[] = [];
  const fires: Array<{ flowId: string; at: number }> = [];
  const assembly: ProductionAssembly = assembleProductionRuntime({
    electron: {
      app,
      BrowserWindow,
      protocol,
      net,
      dialog: adaptElectronDialog(dialog),
      shell,
      ipcMain: recordingIpcMain,
    },
    safeStorage,
    appControl: {
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
      getAppMetrics: () => app.getAppMetrics(),
    },
    rendererDir: path.join(CLIENT_ROOT, 'dist', 'renderer'), // 产物缺省仅在（加载失败不拦启动）
    preloadPath: path.join(CLIENT_ROOT, 'dist', 'preload', 'index.js'),
    userDataDir: userDir,
    sdkModules: {
      sdk: path.join(REPO_ROOT, 'sdk', 'src', 'index.ts'),
      bootstrap: path.join(REPO_ROOT, 'sdk', 'src', 'bootstrap.ts'),
    },
    pyPackageDir: path.join(REPO_ROOT, 'sdk', 'py'),
    cronTickMs: 100, // 冒烟：tick 加速（分钟边界判定仍由表达式+假钟驱动）
    cronNow: () => clock.now,
    ...(poolFirst > 0 && poolLast > 0 ? { cdpPortRange: { first: poolFirst, last: poolLast } } : {}),
    onStep: (step) => steps.push(step),
  });
  // cron:fired 观察面（生产接线=assembly 内 onFired→IpcGateway.send；此处附加订阅仅记录）
  assembly.cron.onFired((flowId) => fires.push({ flowId, at: clock.now }));
  return { assembly, recorded, steps, fires };
}

async function main(boot: Boot): Promise<void> {
  const { assembly, recorded, steps, fires } = boot;
  const { server, origin } = await startHttpServer();
  seedHangingScript();

  let quitting = false;
  async function dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case 'invoke': {
        const channel = String(args.channel);
        const handler = recorded.get(channel);
        if (handler === undefined) throw new Error(`未注册通道：${channel}`);
        try {
          return { ok: true, result: await handler({}, args.payload) };
        } catch (err) {
          return { ok: false, error: serializeError(err) };
        }
      }
      case 'steps':
        return { steps: [...steps] };
      case 'channels':
        return { channels: [...recorded.keys()] };
      case 'clockSet':
        clock.now = Number(args.ms);
        return { now: clock.now };
      case 'clockNow':
        return { now: clock.now };
      case 'fires':
        return { fires: [...fires] };
      case 'nextFire':
        return { at: assembly.cron.nextFire(String(args.flowId))?.getTime() ?? null };
      case 'windowCount':
        return { count: BrowserWindow.getAllWindows().length };
      case 'pidAlive':
        try {
          process.kill(Number(args.pid), 0);
          return { alive: true };
        } catch {
          return { alive: false };
        }
      case 'spawnSmokeReq':
        return {
          req: {
            nodeRunId: 'r-smoke:n-hang',
            lang: 'ts',
            // scriptPath 语义=相对 node-types 根（02 §12.2#3 白名单根——不带 node-types/ 前缀）
            scriptPath: `${SMOKE_NODE_TYPE}/1.0.0/scripts/main.ts`,
            entry: 'run',
            params: {},
            input: null,
            timeoutMs: 0, // 不武装看门狗——挂到退出序 killTree
            retries: 0,
          },
        };
      case 'dbWalExists':
        return { exists: fs.existsSync(path.join(userDir, 'constella.db-wal')) };
      case 'shutdownNow': {
        await assembly.runtime.shutdown(); // 退出序全序（before-quit 同方法——观察面读取）
        return { steps: [...steps] };
      }
      case 'quit': {
        quitting = true;
        // http 收口（keep-alive 清理——cdp head-run 同口径）
        await Promise.race([
          new Promise<void>((r) => server.close(() => r())),
          new Promise<void>((r) => setTimeout(r, 2_000)),
        ]);
        (server as unknown as { closeAllConnections?(): void }).closeAllConnections?.();
        setImmediate(() => app.exit(0));
        return { ok: true };
      }
      default:
        throw new Error(`未知命令：${cmd}`);
    }
  }

  const ctrl = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
  ctrl.on('connection', (ws: WebSocket) => {
    ws.on('message', (data) => {
      void (async () => {
        let req: { id: number; cmd: string; args?: Record<string, unknown> };
        try {
          req = JSON.parse(String(data)) as { id: number; cmd: string; args?: Record<string, unknown> };
        } catch {
          return;
        }
        let body: string;
        try {
          body = JSON.stringify({ id: req.id, ok: true, result: await dispatch(req.cmd, req.args ?? {}) });
        } catch (err) {
          body = JSON.stringify({
            id: req.id,
            ok: false,
            error: { code: 'APP-HEAD-RUN-CTRL-FAILED', message: err instanceof Error ? err.message : String(err) },
          });
        }
        if (!quitting) ws.send(body);
      })();
    });
  });
  await new Promise<void>((r) => ctrl.once('listening', r));
  const ctrlPort = (ctrl.address() as { port: number }).port;

  console.log(
    `${CTRL_PREFIX}${JSON.stringify({
      event: 'ready',
      origin,
      control: `ws://127.0.0.1:${ctrlPort}`,
      channels: [...recorded.keys()],
    })}`,
  );
}

// ———— 启动流（生产时序同构：装配与 startup 发起在 ready 前——S-1 ③协议注册先行；————
// ———— startup 内部自等 whenReady；控制面在启动序完成后开放）                          ————
const boot = createBoot();
const started = boot.assembly.runtime.startup();
void started
  .then(() => main(boot))
  .catch((err: unknown) => {
    console.error('[app-head-run] FATAL', err);
    app.exit(1);
  });
