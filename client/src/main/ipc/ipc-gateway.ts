// IpcGateway——24 通道注册基座（T4-14 / TDD-C-M1 §3 IpcGateway 行；接管 T4-13 domain-channels
// 的 InvokeRegistry 缺省注册面与 serializeDomainError 先驱——错误序列化归一至 serialize-error.ts）。
//
// 职责（§3 组件行）：24 通道注册（21 r→m invoke＝ipcMain.handle 统一半段＋3 m→r 推送 sender 面）、
// payload 校验（源型=X-01 9 域 payload；失败复用 02 §6.1 VALIDATION-FAILED）、{code,message}
// 统一序列化（§1 错误序列化铁律）、preload 白名单半段之 main 侧对端。
//
// 注册面约束：
//   - register 只收 21 r→m invoke 通道（ns/method 白名单=IPC_INVOKE_CHANNELS——24 通道冻结，
//     不得新增/改名）；推送通道经 register → 装配错误（方向面分离）；
//   - zip:export / zip:import 装配位预留——通道可注册、两段式/双变体 payload 校验已就位；
//     handler 骨架随 T4-20（StorageService 桥接收口）、管线注入随 C-08（P5 波）。
//
// 五服务业务 handler 不在本卡实装（StorageService=T4-20／SecretVault=T4-15／Sandbox=T4-16/17／
// Cdp=T4-18／Cron=T4-19）——本网关只提供统一注册/校验/序列化基座。
import { IPC_INVOKE_CHANNELS, IPC_PUSH_CHANNELS } from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';
import type { IpcMainLike, WebContentsLike } from '../runtime/electron-api';
import { toIpcRejection } from './serialize-error';
import { validateInvokePayload, type IpcInvokeChannel } from './payload-schemas';

const INVOKE_WHITELIST: ReadonlySet<string> = new Set(IPC_INVOKE_CHANNELS);
const PUSH_WHITELIST: ReadonlySet<string> = new Set(IPC_PUSH_CHANNELS);

/** r→m handler 形（payload=校验后值；同步/异步均可） */
export type IpcInvokeHandler = (payload: unknown) => unknown | Promise<unknown>;

export interface IpcGatewayDeps {
  /** ipcMain.handle 注册面（生产=真实 ipcMain；测试=mock） */
  ipcMain: Pick<IpcMainLike, 'handle'>;
  /**
   * m→r 推送目标（主窗 webContents 解析器）。未就绪（主窗未建/已毁）→ 静默丢弃
   * （fire-and-forget 无错误语义，§1 铁律）。
   */
  webContents?: () => Pick<WebContentsLike, 'send'> | undefined;
}

/**
 * IpcGateway（C-M1 §3）：
 *   register(ch, handler)  21 r→m 通道统一注册（payload 校验→handler→错误 {code,message} 序列化）
 *   handle(ch, handler)    InvokeRegistry 面（T4-13 注入位同形——AppRuntime 域通道等经此挂载）
 *   send(ch, payload)      3 m→r 推送 sender 面（run:scriptEvent/cron:fired/app:confirmClose；
 *                          fire-and-forget 无错误语义）
 */
export class IpcGateway implements InvokeRegistry {
  private readonly registered = new Set<string>();

  constructor(private readonly deps: IpcGatewayDeps) {}

  /** r→m invoke 通道注册（白名单外/推送通道/重复注册 → main 侧装配错误，非 IPC 错误） */
  register(channel: string, handler: IpcInvokeHandler): void {
    if (PUSH_WHITELIST.has(channel)) {
      throw new Error(`IpcGateway.register：${channel} 为 m→r 推送通道（fire-and-forget），不经 invoke 注册`);
    }
    if (!INVOKE_WHITELIST.has(channel)) {
      throw new Error(`IpcGateway.register：非白名单 r→m 通道（24 通道冻结，02 §3.4/X-01 IPC_CHANNELS）：${channel}`);
    }
    if (this.registered.has(channel)) {
      throw new Error(`IpcGateway.register：重复注册 ${channel}（同 ipcMain.handle 语义）`);
    }
    this.registered.add(channel);
    this.deps.ipcMain.handle(channel, async (_event: unknown, payload?: unknown) => {
      const parsed = validateInvokePayload(channel as IpcInvokeChannel, payload);
      if (!parsed.ok) {
        throw toIpcRejection({
          code: 'VALIDATION-FAILED',
          message: `payload 校验失败（${channel}）：${parsed.errors.join('；')}`,
        });
      }
      try {
        return await handler(parsed.value);
      } catch (err) {
        throw toIpcRejection(err);
      }
    });
  }

  /** InvokeRegistry 面（T4-13 domain-channels 消费形——register 别名） */
  handle(channel: Parameters<IpcGateway['register']>[0], handler: IpcInvokeHandler): void {
    this.register(channel, handler);
  }

  /** m→r 推送（3 推送通道白名单；目标未就绪静默丢弃——无错误语义） */
  send(channel: string, payload: unknown): void {
    if (!PUSH_WHITELIST.has(channel)) {
      throw new Error(`IpcGateway.send：非白名单 m→r 推送通道（3 推送面冻结，02 §3.4）：${channel}`);
    }
    const wc = this.deps.webContents?.();
    if (wc === undefined) return;
    wc.send(channel, payload);
  }
}
