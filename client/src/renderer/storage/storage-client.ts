// storageClient —— renderer 薄封装（T1-08；C-06 §3 renderer 行；02 §3.4）。
//
// 全 renderer 消费方的存储入口：invoke(op, args) → bridge（C-M1 preload 暴露的
// window.constella.storage.invoke——通道 handler 归 C-M1/P4，本卡以注入式 bridge 验收）。
// op/payload 类型=X-01（StorageInvokeReq 31 op 细型/StorageInvokeRes 结果映射）——
// 编译期即拒绝白名单外 op 与错形 args；错误统一 {code,message} IpcError（C-M1 序列化）。
import type { StorageInvokeReq, StorageInvokeRes, StorageOp } from '@constella/shared/ipc';

/** 按 op 取 args 形（无参 op=undefined——严格收窄） */
export type StorageInvokeArgs<T extends StorageOp> =
  Extract<StorageInvokeReq, { op: T }> extends { args: infer A } ? A : undefined;

/** IPC 桥（C-M1 preload 面的注入位；测试用 mock bridge） */
export interface StorageBridge {
  invoke(req: StorageInvokeReq): Promise<unknown>;
}

/** 薄客户端面（全 renderer 消费） */
export interface StorageClient {
  invoke<T extends StorageOp>(op: T, args: StorageInvokeArgs<T>): Promise<StorageInvokeRes<T>>;
}

/** 装配（bridge 由应用装配点注入——真实实现随 C-M1，P4） */
export function createStorageClient(bridge: StorageBridge): StorageClient {
  return {
    invoke<T extends StorageOp>(op: T, args: StorageInvokeArgs<T>): Promise<StorageInvokeRes<T>> {
      const req = (args === undefined ? { op } : { op, args }) as StorageInvokeReq;
      return bridge.invoke(req) as Promise<StorageInvokeRes<T>>;
    },
  };
}
