// fake 能力桥宿主（T4-16 caps bound 补跑留痕面）：T0-07 冻结帧协议的 ws 端点替身——
// ns/method 双白名单＋net 域名白名单拒 NET-DENIED（拒绝事件日志可见）＋loopback-only＋
// 禁 permessage-deflate（同 CdpBridge 口径）。
//
// ⚠ 宿主归属核对（03 C-M1 §3）：NetProxyBridge 本体（PortPool net 段 9321–9420/域名白名单
// N1 推导/拒绝事件落日志表）不在 T4-16——本替身仅覆盖「env 注入端点→子进程 ws 客户端→帧
// 往返→NET-DENIED」协议面；真宿主联测登记 T4-20/P5（CdpBridge 本体已由 T4-18 交付，其
// lane 端点直挂=SandboxExecutor cdpEndpointOf 装配位）。SDK 侧 caps 绑定客户端=K-01 §3
// caps 行（T4-12 后续），本面以子进程内全局 WebSocket 直连覆盖同帧形。
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_CDP_METHODS, BRIDGE_ERROR_CODES } from '@constella/shared/ipc';

const CDP_METHODS: ReadonlySet<string> = new Set(BRIDGE_CDP_METHODS);

export interface FakeBridgeHandle {
  url: string;
  /** 拒绝事件台账（02 §12.1：白名单外默认拒绝——拒绝事件日志可见断言面） */
  denials: Array<{ domain: string; url: string }>;
  close(): Promise<void>;
}

/**
 * 起 fake 双 ns 桥（cdp: method 白名单＋固定应答；net: 域名白名单外 → NET-DENIED）。
 * 端口=系统分配（真宿主 net 段 9321–9420 策略归 NetProxyBridge 本体——见文件头留痕）。
 */
export async function startFakeCapabilityBridge(options: {
  allowDomains: string[];
}): Promise<FakeBridgeHandle> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      wss.removeListener('error', reject);
      resolve();
    });
  });
  const address = wss.address() as { port: number };
  const denials: FakeBridgeHandle['denials'] = [];

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data) => {
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return; // 畸形帧无 id 不应（协议面同 CdpBridge）
      }
      const send = (payload: unknown): void => ws.send(JSON.stringify(payload));
      const errFrame = (code: string, message: string): void =>
        send({ id: rec.id, ok: false, error: { code, message } });
      if (typeof rec.id !== 'number') return errFrame(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, '帧缺 number id');
      if (rec.ns === 'cdp') {
        if (typeof rec.method !== 'string' || !CDP_METHODS.has(rec.method)) {
          return errFrame(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `method 白名单外：${String(rec.method)}`);
        }
        if (rec.method === 'Runtime.evaluate') {
          return send({ id: rec.id, ok: true, result: { result: { value: 2 } } });
        }
        return send({ id: rec.id, ok: true, result: {} });
      }
      if (rec.ns === 'net') {
        if (rec.method !== 'fetch') {
          return errFrame(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `method 白名单外：${String(rec.method)}`);
        }
        const params = (rec.params ?? {}) as { url?: unknown };
        const raw = typeof params.url === 'string' ? params.url : '';
        let domain = '';
        try {
          domain = new URL(raw).hostname;
        } catch {
          return errFrame(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `非法 url: ${raw}`);
        }
        if (!options.allowDomains.includes(domain)) {
          denials.push({ domain, url: raw }); // 拒绝事件台账（日志可见面）
          return errFrame(BRIDGE_ERROR_CODES.NET_DENIED, `域名白名单外默认拒绝: ${domain}`);
        }
        return send({ id: rec.id, ok: true, result: { status: 200, url: raw, via: 'fake-net-bridge' } });
      }
      return errFrame(BRIDGE_ERROR_CODES.BRIDGE_BAD_FRAME, `ns 白名单外：${String(rec.ns)}`);
    });
  });

  return {
    url: `ws://127.0.0.1:${address.port}`,
    denials,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients as Set<WebSocket>) client.close();
        wss.close(() => resolve());
      }),
  };
}
