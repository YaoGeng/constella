// secret:* 三通道 handler（T4-15 / TDD-C-M1 §1 矩阵 secret:set/get/del 行）。
//
// 语义冻结（§1 矩阵）：
//   secret:set  r→m  {key,value?} → {ok}（safeStorage 加密入 vault.bin；value 缺省按 ''——自拟项③）
//   secret:get  r→m  {key} → {value}（未命中 in-band {value:null}——非 reject）
//   secret:del  r→m  {key} → {ok}（幂等）
//   错误：safeStorage 不可用 → SECRET-UNAVAILABLE（vault 降级态，§1 矩阵）；payload 形状 →
//   VALIDATION-FAILED（IpcGateway/payload-schemas 通道面——T4-14 既有，本文件不重叠）。
//
// 注册面：InvokeRegistry——SecretVault.init 经 AppRuntime 启动序挂载（缺省 IpcGateway；
// AppRuntimeDeps.invokeRegistry 测试注入位同 T4-13 冻结缝）。
import {
  IPC_CHANNELS,
  type SecretDelReq,
  type SecretDelRes,
  type SecretGetReq,
  type SecretGetRes,
  type SecretSetReq,
  type SecretSetRes,
} from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';
import type { SecretVault } from './secret-vault';

/** 通道面消费的 vault 面 */
export type SecretVaultChannelFace = Pick<SecretVault, 'set' | 'get' | 'del'>;

/** 注册 secret:set/get/del 三通道（SecretVault.init 调用；重复注册由 IpcGateway 拒绝） */
export function registerSecretChannels(vault: SecretVaultChannelFace, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.secretSet, (payload) => {
    const req = payload as SecretSetReq; // 形状已过 payload-schemas（T4-14 通道面）
    vault.set(req.key, req.value ?? ''); // 自拟项③：value 可缺 → ''
    return { ok: true } satisfies SecretSetRes;
  });
  registry.handle(IPC_CHANNELS.secretGet, (payload) => {
    const req = payload as SecretGetReq;
    return { value: vault.get(req.key) } satisfies SecretGetRes; // 未命中 in-band {value:null}
  });
  registry.handle(IPC_CHANNELS.secretDel, (payload) => {
    const req = payload as SecretDelReq;
    vault.del(req.key);
    return { ok: true } satisfies SecretDelRes; // 幂等
  });
}
