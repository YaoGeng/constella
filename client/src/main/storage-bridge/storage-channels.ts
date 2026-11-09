// storage:invoke 通道 handler（T4-20 / TDD-C-M1 §1 矩阵 storage:invoke 行＋§3 StorageService 行）。
//
// 语义冻结（§1 矩阵）：{op,args} → C-06 ops 白名单（9 域 31 op）——不接受任意 SQL；
// 未知 op → IPC-UNKNOWN-OP／args 校验失败 → VALIDATION-FAILED／DAO 业务码透传（T1-07
// StorageOpsRegistry 三段已全落，本通道只做透传桥）。payload 通道级形状（{op: 非空 string,
// args?: 普通对象}）已过 IpcGateway/payload-schemas（T4-14 通道面），本文件不重叠。
import { IPC_CHANNELS, type StorageInvokeReq } from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';

/** 通道面消费的 StorageService 面（§3 `handle(op,args)`） */
export type StorageServiceChannelFace = { handle(op: string, args?: unknown): unknown };

/** 注册 storage:invoke（StorageService.init 调用；重复注册由 IpcGateway 拒绝） */
export function registerStorageInvokeChannel(face: StorageServiceChannelFace, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.storageInvoke, (payload) => {
    const req = payload as StorageInvokeReq; // 形状已过 payload-schemas（T4-14 通道面）
    const args = (req as { args?: unknown }).args;
    return face.handle(req.op, args);
  });
}
