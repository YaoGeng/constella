// head-run main —— electron 真头跑入口（T4-18 / TDD-C-M1 §6.2a~d＋T4-05 §6.2 补跑宿主）。
//
// 由 head-run-harness 经 esbuild 打包为 CJS 后以真 electron 二进制拉起（S-3 工程链：
// 本机 client/node_modules/electron/dist/electron.exe；CI/新机须 node install.js）。
// 组装＝真件全链：CdpSessionManager（真 BrowserWindow/webContents.debugger）＋CdpBridge（真 ws）＋
// CdpPortPool（真探活）＋IpcGateway（真 ipcMain.handle 注册——cdp:* 六通道 mock 解除冒烟）＋
// ViewerWindowManager（T4-13 查看窗原语）。
//
// 控制面：127.0.0.1 ws（ephemeral 口经 stdout `@@CTRL@@` ready 行回传——规避 Electron stdin 依赖）；
// 协议=单帧 {id,cmd,args} → {id,ok,result}｜{id,ok:false,error:{code,message}}。
// 清理：quit 命令（销毁全部 lane 窗＋关桥＋关 http 服务→app.exit(0)）＋180s 全局看门狗兜底。
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { CdpBridge, createWssServer } from '../cdp-bridge';
import { CdpSessionManager, type CdpBrowserWindowConstructor } from '../cdp-session-manager';
import { InMemoryLanesLedger } from '../lanes-ledger';
import { CdpPortPool } from '../port-pool';
import { IpcGateway } from '../../ipc/ipc-gateway';
import { serializeError } from '../../ipc/serialize-error';
import type { BrowserWindowConstructor } from '../../runtime/electron-api';
import { ViewerWindowManager } from '../../runtime/viewer-windows';

const CTRL_PREFIX = '@@CTRL@@';
const WATCHDOG_MS = 180_000;

/** 临时诊断日志（CONSTELLA_HEADRUN_DEBUG=<file> 时逐事件追加——主循环阻塞/连接接入定位用） */
const DEBUG_LOG = process.env.CONSTELLA_HEADRUN_DEBUG;
function dbg(line: string): void {
  if (DEBUG_LOG === undefined) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${Date.now()} [${process.pid}] ${line}\n`);
  } catch {
    /* ignore */
  }
}
if (DEBUG_LOG !== undefined) {
  setInterval(() => dbg('heartbeat'), 1_000).unref?.();
}

/** argv 解析：--user-data=<dir>（partition 落盘隔离）/ --pool-first/--pool-last（端口段注入） */
function argValue(name: string): string | undefined {
  const hit = process.argv.find((s) => s.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.split('=').slice(1).join('=');
}

const userData = argValue('user-data');
if (userData === undefined) {
  console.error('[head-run] --user-data=<dir> 必填');
  app.exit(2);
  throw new Error('--user-data=<dir> 必填');
}
app.setPath('userData', userData);
app.disableHardwareAcceleration(); // 隐藏自动化窗口无需 GPU；规避 GrShaderCache 损坏崩溃（S-3）
// S-3 坑②兜底（T4-13 AppRuntime 同语义复刻）：destroyRun 销毁全部 lane 窗后窗口数归零不退 app——
// 退出只由 quit 命令/看门狗控制（§6.2b 回归前提）。
app.on('window-all-closed', () => {
  /* no-op：覆盖 Electron 默认 quit */
});

setTimeout(() => {
  console.error('[head-run] global watchdog fired, exit 2');
  app.exit(2);
}, WATCHDOG_MS).unref();

/** 最小测试页（S-3 判据 3 同源：按钮点击后状态文本递增——extract/click 断言靶） */
const PAGE_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><title>t418-cdp-target</title></head><body>',
  '<h1>constella head-run target</h1>',
  '<button id="btn" type="button">click-me</button>',
  '<span id="status">before-click</span>',
  '<script>',
  'var n = 0;',
  'document.getElementById("btn").addEventListener("click", function () {',
  '  n += 1;',
  '  document.getElementById("status").textContent = "after-click-" + n;',
  '});',
  '</script></body></html>',
].join('\n');

function startHttpServer(): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(PAGE_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

interface CtrlRequest {
  id: number;
  cmd: string;
  args?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const { server, origin } = await startHttpServer();

  // —— 真件组装（生产装配=index.ts 装配位同构；T4-20 组收尾接入）——
  const poolFirst = Number(argValue('pool-first') ?? '0');
  const poolLast = Number(argValue('pool-last') ?? '0');
  const portPool =
    poolFirst > 0 && poolLast > 0 ? new CdpPortPool({ first: poolFirst, last: poolLast }) : new CdpPortPool();
  const bridge = new CdpBridge(async (options) => {
    const server = await createWssServer(options);
    dbg(`bridge listening port=${options.port}`);
    server.onConnection(() => dbg(`bridge conn port=${options.port}`));
    return server;
  });
  const viewers = new ViewerWindowManager(BrowserWindow as unknown as BrowserWindowConstructor);
  const manager = new CdpSessionManager({
    browserWindow: BrowserWindow as unknown as CdpBrowserWindowConstructor,
    bridge,
    portPool,
    viewers,
    lanes: new InMemoryLanesLedger(), // T4-20 注入 C-06 dao.lanes 前的装配位
    flowIdOfRun: (runId) => `flow-of-${runId}`, // T4-20 注入 runs DAO 前的装配位（隔离不弱化）
    processMetrics: () => app.getAppMetrics(), // laneMemory 数据源（app 进程度表按 OS pid 关联）
  });

  // IpcGateway：真 ipcMain.handle 注册（通道真面）＋记录包装层 listener 供控制面 invoke
  // （经同一校验/序列化链——payload 校验〔VALIDATION-FAILED〕与 {code,message} 序列化全真）。
  const recorded = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
  const gateway = new IpcGateway({
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void => {
        ipcMain.handle(channel, listener as never);
        recorded.set(channel, listener as (event: unknown, payload?: unknown) => Promise<unknown>);
      },
    },
  });
  await manager.init({ registry: gateway });

  let quitting = false;
  async function dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    dbg(`dispatch ${cmd} ${JSON.stringify(args).slice(0, 160)}`);
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
      case 'bridgeEndpoint':
        return { endpoint: bridge.endpointOf(String(args.laneKey)) };
      case 'windowCount':
        return { count: BrowserWindow.getAllWindows().length };
      case 'viewerCount':
        return { count: viewers.openCount };
      case 'laneMemory':
        return { lanes: await manager.laneMemory() };
      case 'poolAvailable':
        return { available: portPool.available };
      case 'registeredChannels':
        return { channels: [...recorded.keys()] };
      case 'quit': {
        quitting = true;
        await manager.destroyAllLaneWindows();
        await bridge.closeAll();
        // http server 收口：closeAllConnections 清 keep-alive 连接（否则 close() 挂起等连接自然结束）
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

  // —— 控制面 ws（ephemeral 口经 stdout ready 行回传）——
  const ctrl = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
  dbg(`assembled; http=${origin}`);
  ctrl.on('connection', (ws: WebSocket) => {
    dbg('ctrl connection');
    ws.on('message', (data) => {
      void (async () => {
        let req: CtrlRequest;
        try {
          req = JSON.parse(String(data)) as CtrlRequest;
        } catch {
          return; // 协议外帧丢弃
        }
        let body: string;
        try {
          body = JSON.stringify({ id: req.id, ok: true, result: await dispatch(req.cmd, req.args ?? {}) });
        } catch (err) {
          body = JSON.stringify({
            id: req.id,
            ok: false,
            error: { code: 'HEAD-RUN-CTRL-FAILED', message: err instanceof Error ? err.message : String(err) },
          });
        }
        if (!quitting) ws.send(body);
      })();
    });
  });
  await new Promise<void>((r) => ctrl.once('listening', r));
  const ctrlPort = (ctrl.address() as { port: number }).port;

  console.log(`${CTRL_PREFIX}${JSON.stringify({ event: 'ready', origin, control: `ws://127.0.0.1:${ctrlPort}`, channels: [...recorded.keys()] })}`);
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('[head-run] FATAL', err);
  app.exit(1);
});
