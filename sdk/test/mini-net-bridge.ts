// T5-12b 测试基建：极简 net 桥 mock（RFC6455 文本帧 ws 服务端——node:http upgrade ＋
// 手写帧收发；sdk 域不得引第三方 ws 包〔check-sdk-deps 红线〕，仅实现本 SDK 客户端所需
// 子集：握手 accept 计算/客户端帧解掩码/FIN 文本帧/ping→pong/close 镜像）。
// 应答语义=NetProxyBridge 的 fake（T0-07 统一帧形）：按 params.url 精确匹配脚本化
// {ok:true,result}｜{ok:false,error}；mode 提供超时/关闭面形态（silent=不应答、
// close-on-message=收帧即断）。ts 契约测试（vitest 进程）与 isomorphism.mjs（node 直跑、
// 同时服务 ts/py 两侧子进程）共用。
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket as TcpSocket } from 'node:net';

/** 桥线形成功 result（T5-12a PM 缺省③：{status,statusText,headers,bodyB64}） */
export interface MiniNetResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyB64: string;
}

export type MiniNetReply =
  | { ok: true; result: MiniNetResult }
  | { ok: false; error: { code: string; message: string } };

export interface MiniNetBridgeOptions {
  /** url→应答脚本表（params.url 精确匹配；未匹配→默认 NET-DENIED，镜像白名单语义） */
  replies?: Record<string, MiniNetReply>;
  /** silent=收帧不应答（超时面）；close-on-message=收帧即断连（关闭面）；close-after-reply=应答一帧后断连（重连面） */
  mode?: 'normal' | 'silent' | 'close-on-message' | 'close-after-reply';
}

export interface MiniNetBridge {
  url: string;
  /** 已完成握手的连接数（连接复用判据：N 次 fetch 应只开 1 连接） */
  connections: number;
  /** 收到的请求帧面（id/params 快照） */
  requests: Array<{ id: number; params: Record<string, unknown> }>;
  close(): Promise<void>;
}

/** utf8 文本→桥线形 bodyB64（测试期望构造用） */
export function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 服务端文本帧（不掩码——RFC6455 服务端义务） */
function serverTextFrame(payload: Buffer): Buffer {
  const len = payload.length;
  const head: Buffer =
    len < 126
      ? Buffer.from([0x81, len])
      : len < 65536
        ? Buffer.concat([Buffer.from([0x81, 126]), Buffer.alloc(2)])
        : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(8)]);
  if (len >= 126 && len < 65536) head.writeUInt16BE(len, 2);
  else if (len >= 65536) head.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([head, payload]);
}

/** 服务端 close 帧（opcode 0x8，空载荷即可） */
const serverCloseFrame = Buffer.from([0x88, 0x00]);

/** 客户端帧流式解析（客户端帧必掩码——RFC6455 §5.3） */
class ClientFrameReader {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  /** 取下一完整帧；不完整返回 null。返回 {opcode, payload, fin, masked} */
  next(): { opcode: number; payload: Buffer; fin: boolean } | null {
    const buf = this.buf;
    if (buf.length < 2) return null;
    const fin = (buf[0]! & 0x80) !== 0;
    const opcode = buf[0]! & 0x0f;
    const masked = (buf[1]! & 0x80) !== 0;
    let len = buf[1]! & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(0x7fffffff)) throw new Error('帧长超限');
      len = Number(big);
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return null;
    let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const mask = buf.subarray(offset, offset + 4);
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i]! ^ mask[i % 4]!;
      payload = unmasked;
    }
    this.buf = buf.subarray(offset + maskLen + len);
    return { opcode, payload, fin };
  }
}

/** 启动 mini net 桥（127.0.0.1 随机端口） */
export function startMiniNetBridge(options: MiniNetBridgeOptions = {}): Promise<MiniNetBridge> {
  const sockets = new Set<TcpSocket>();
  const state: MiniNetBridge = {
    url: '',
    connections: 0,
    requests: [],
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((req, res) => {
    // 非 upgrade 请求：协议外——426 拒绝（本桥仅服务 ws 握手）
    res.writeHead(426).end();
  });
  server.on('upgrade', (req, socket) => {
    // http 'upgrade' 事件签名收窄为 stream.Duplex——upgraded socket 实为 net.Socket（TCP 选项面）
    const sock = socket as TcpSocket;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || key === '') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );
    sockets.add(sock);
    state.connections += 1;
    sock.setNoDelay(true);
    const reader = new ClientFrameReader();
    let message: Buffer | null = null; // 分片累积（FIN 前跨帧拼接）
    socket.on('data', (chunk: Buffer) => {
      reader.push(chunk);
      for (;;) {
        let frame: { opcode: number; payload: Buffer; fin: boolean } | null = null;
        try {
          frame = reader.next();
        } catch {
          socket.destroy();
          return;
        }
        if (frame === null) break;
        const { opcode, payload, fin } = frame;
        if (opcode === 0x8) {
          socket.write(serverCloseFrame); // close 镜像（客户端主动收尾）
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); // ping→pong
          continue;
        }
        if (opcode === 0xa) continue; // pong（本桥不发 ping）——忽略
        if (opcode === 0x1 || opcode === 0x2) message = payload;
        else if (opcode === 0x0 && message !== null) message = Buffer.concat([message, payload]);
        else continue; // 协议外首帧——丢弃
        if (!fin) continue; // 分片：等 continuation FIN
        const text = (message ?? Buffer.alloc(0)).toString('utf8');
        message = null;
        handleText(sock, text);
      }
    });
    const drop = (): void => {
      sockets.delete(sock);
    };
    sock.on('close', drop);
    sock.on('error', drop);
  });

  const handleText = (socket: import('node:stream').Duplex, text: string): void => {
    let rec: unknown;
    try {
      rec = JSON.parse(text);
    } catch {
      socket.destroy(); // 畸形 JSON 无 id——无帧可应（宿主同口径）
      return;
    }
    const id = (rec as { id?: unknown })?.id;
    if (typeof id !== 'number') {
      socket.destroy();
      return;
    }
    const params = (rec as { params?: unknown })?.params;
    const url = typeof (params as { url?: unknown })?.url === 'string' ? (params as { url: string }).url : '';
    state.requests.push({ id, params: typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {} });
    if (options.mode === 'close-on-message') {
      socket.destroy();
      return;
    }
    if (options.mode === 'silent') return; // 不应答——客户端超时面
    const reply = options.replies?.[url] ?? {
      ok: false as const,
      error: { code: 'NET-DENIED', message: `域名白名单外默认拒绝: ${url}` }, // 未脚本化 url=默认拒（白名单镜像）
    };
    socket.write(serverTextFrame(Buffer.from(JSON.stringify({ id, ...reply }), 'utf8')));
    if (options.mode === 'close-after-reply') {
      socket.write(serverCloseFrame); // 应答一帧后断连（重连面形态——实例生命周期内首答即关）
      socket.end();
    }
  };

  return new Promise<MiniNetBridge>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('mini 桥监听地址异常'));
        return;
      }
      state.url = `ws://127.0.0.1:${addr.port}`;
      state.close = async () => {
        for (const s of sockets) s.destroy();
        await new Promise<void>((res) => server.close(() => res()));
      };
      resolve(state);
    });
  });
}
