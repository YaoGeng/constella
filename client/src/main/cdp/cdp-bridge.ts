// CdpBridge —— main 内 webContents.debugger↔ws 命令代理（T4-18 / TDD-C-M1 §3 CdpBridge 行；
// T0-06/T0-07 会签收口细目）。实现=main 侧 `ws` 包（MIT，S-9 复验通过；本卡锁 8.18.2）。
//
// 端点形（03 §1 冻结结论）：每 lane 一口——ws://127.0.0.1:<lanePort>（PortPool 9221–9320 分配），
// 子进程 ctx.browser 绑定（CONSTELLA_CDP_WS）与 renderer CommandTransport（T4-05）同桥同安全面
// （方案 A，M4 PM 裁决 3）。帧协议=T0-07 冻结形（X-01 ./ipc bridge.ts）：
//   文本帧 JSON {"id",ns:'cdp',"method","params"} → {"id",ok:true,result}｜{"id",ok:false,error:{code,message}}；
//   id 连接内单调递增（客户端义务）、无服务端推送帧（V1.0）；仅监听 127.0.0.1（02 §12.3）；
//   服务端禁用 permessage-deflate（py 侧极简客户端前提）。
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_CDP_METHODS, BRIDGE_ERROR_CODES } from '@constella/shared/ipc';

/** cdp 桥 method 白名单集合（T0-07 冻结 9 项） */
const METHOD_WHITELIST: ReadonlySet<string> = new Set(BRIDGE_CDP_METHODS);

/** 命令靶（=会话 webContents.debugger 的 sendCommand 面；会话销毁后 provider 返回 undefined） */
export interface CdpCommandTarget {
  sendCommand(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** 命令靶解析器（逐帧解析：会话存活→靶；销毁→undefined→CDP-SESSION-NOT-FOUND） */
export type CdpCommandTargetProvider = () => CdpCommandTarget | undefined;

/** ws 服务端监听参数（loopback-only＋perMessageDeflate:false 由本桥冻结——工厂不可放宽） */
export interface BridgeListenOptions {
  host: '127.0.0.1';
  port: number;
  perMessageDeflate: false;
}

/** 单连接文本帧面（协议归本桥、传输归工厂） */
export interface BridgeSocket {
  onMessage(handler: (data: string) => void): void;
  send(text: string): void;
}

/** 已绑定的 ws 服务端（连接接入面＋收口面） */
export interface BoundBridgeServer {
  onConnection(handler: (socket: BridgeSocket) => void): void;
  close(): Promise<void>;
}

export type BridgeServerFactory = (options: BridgeListenOptions) => Promise<BoundBridgeServer>;

interface LaneEntry {
  port: number;
  server: BoundBridgeServer;
  targetProvider: CdpCommandTargetProvider;
}

/** 失败帧（T0-07 冻结形：{"id",ok:false,error:{code,message}}） */
function errorFrame(id: number, code: string, message: string): string {
  return JSON.stringify({ id, ok: false, error: { code, message } });
}

/** 缺省工厂：ws 包服务端绑定（EADDRINUSE → reject {code:'EADDRINUSE'}——调用方跳号重试面） */
export async function createWssServer(options: BridgeListenOptions): Promise<BoundBridgeServer> {
  const wss = new WebSocketServer({
    host: options.host,
    port: options.port,
    perMessageDeflate: options.perMessageDeflate, // false（T0-07：py 侧极简客户端前提）
  });
  await new Promise<void>((resolve, reject) => {
    const onErr = (err: NodeJS.ErrnoException): void =>
      reject({ code: err.code ?? 'EADDRINUSE', message: err.message });
    wss.once('error', onErr);
    wss.once('listening', () => {
      wss.removeListener('error', onErr);
      resolve();
    });
  });
  return {
    onConnection: (handler) => {
      wss.on('connection', (ws: WebSocket) => {
        handler({
          onMessage: (h) => {
            ws.on('message', (data) => h(String(data)));
          },
          send: (text) => ws.send(text),
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients as Set<WebSocket>) client.close();
        wss.close(() => resolve());
      }),
  };
}

/** CdpBridge 消费面（CdpSessionManager 依赖注入位——单测 fake/真实现同构） */
export interface CdpBridgeFace {
  openLane(laneKey: string, preferredPort: number, targetProvider: CdpCommandTargetProvider): Promise<number>;
  closeLane(laneKey: string): Promise<void>;
  closeAll(): Promise<void>;
  endpointOf(laneKey: string): string;
  readonly laneCount: number;
}

/**
 * CdpBridge（§3 组件行）：lane 粒度 ws 端点管理＋帧代理。
 * openLane(laneKey, preferredPort, targetProvider)——绑定成功返回实际端口；
 * 端口被外部占用 reject {code:'EADDRINUSE'}（调用方 markBusy＋次号重试——创建前探活冲突跳号）。
 */
export class CdpBridge implements CdpBridgeFace {
  private readonly lanes = new Map<string, LaneEntry>();

  constructor(private readonly createServer: BridgeServerFactory = createWssServer) {}

  /** 开 lane 桥端点（绑定失败 reject——EADDRINUSE 由调用方跳号） */
  async openLane(laneKey: string, preferredPort: number, targetProvider: CdpCommandTargetProvider): Promise<number> {
    const server = await this.createServer({ host: '127.0.0.1', port: preferredPort, perMessageDeflate: false });
    const entry: LaneEntry = { port: preferredPort, server, targetProvider };
    this.lanes.set(laneKey, entry);
    server.onConnection((socket) => {
      socket.onMessage((data) => {
        void this.handleFrame(entry, data, socket);
      });
    });
    return preferredPort;
  }

  /** 单帧代理：白名单（ns+method）→ 靶解析 → sendCommand → 成功/失败帧（T0-07 逐字对端） */
  private async handleFrame(entry: LaneEntry, data: string, socket: BridgeSocket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // 畸形 JSON 无 id——无帧可应（连接保持；客户端超时兜底）
    }
    const badFrame = (message: string): void => {
      if (typeof (parsed as { id?: unknown })?.id === 'number') {
        socket.send(errorFrame((parsed as { id: number }).id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, message));
      }
    };
    if (typeof parsed !== 'object' || parsed === null) return badFrame('帧须为 JSON 对象');
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== 'number') return badFrame('帧缺 number id');
    if (rec.ns !== 'cdp') {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `ns 白名单外：${String(rec.ns)}`));
    }
    if (typeof rec.method !== 'string' || !METHOD_WHITELIST.has(rec.method)) {
      return void socket.send(
        errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `method 白名单外：${String(rec.method)}`),
      );
    }
    if (typeof rec.params !== 'object' || rec.params === null || Array.isArray(rec.params)) {
      return void socket.send(errorFrame(rec.id, BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, 'params 须为 JSON 对象'));
    }
    const target = entry.targetProvider();
    if (target === undefined) {
      return void socket.send(
        errorFrame(rec.id, BRIDGE_ERROR_CODES.CDP_SESSION_NOT_FOUND, 'lane 会话不存在或已销毁'),
      );
    }
    try {
      const result = await target.sendCommand(rec.method, rec.params as Record<string, unknown>);
      socket.send(JSON.stringify({ id: rec.id, ok: true, result }));
    } catch (err) {
      socket.send(
        errorFrame(
          rec.id,
          BRIDGE_ERROR_CODES.CDP_COMMAND_FAILED,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  /** lane 桥端点（§3 `endpointOf(laneKey)`；未开 lane → 空串） */
  endpointOf(laneKey: string): string {
    const entry = this.lanes.get(laneKey);
    return entry === undefined ? '' : `ws://127.0.0.1:${entry.port}`;
  }

  /** 关 lane 端点（未开 lane=无操作；关 server＋断连——在途请求由客户端超时兜底） */
  async closeLane(laneKey: string): Promise<void> {
    const entry = this.lanes.get(laneKey);
    if (entry === undefined) return;
    this.lanes.delete(laneKey);
    await entry.server.close();
  }

  /** 关全部 lane 端点（退出序） */
  async closeAll(): Promise<void> {
    const entries = [...this.lanes.values()];
    this.lanes.clear();
    await Promise.all(entries.map((e) => e.server.close()));
  }

  get laneCount(): number {
    return this.lanes.size;
  }
}
