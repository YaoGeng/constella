// IpcDefinitionStore —— C-05 NodeDefinitionStore 的 IPC 实现（T1-08；C-06 §3 renderer 行）。
//
// 签名=async 定稿（✅ M4 P2-7 收口；C-05 卡已同步）。接口本体（NodeDefinitionStore）随
// T1-09 RegistryCore 卡落 client/src/renderer/node-registry/——此处按冻结签名结构实现，
// C-05 装配注入时结构类型即兼容（P-3：本文件不 import C-05/C-01）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { StorageClient } from './storage-client';

/** C-05 §1 接口形（async 定稿冻结——T1-09 落正式声明，本结构对齐） */
export interface NodeDefinitionStore {
  loadAllDefinitions(): Promise<NodeDefinition[]>;
  upsertDefinition(doc: NodeDefinition): Promise<void>;
}

/** 经 storage:invoke definitions 域读写定义（C-05 DefinitionLoader 的生产装配注入位） */
export class IpcDefinitionStore implements NodeDefinitionStore {
  constructor(private readonly client: StorageClient) {}

  async loadAllDefinitions(): Promise<NodeDefinition[]> {
    return await this.client.invoke('definitions.loadAll', undefined);
  }

  async upsertDefinition(doc: NodeDefinition): Promise<void> {
    await this.client.invoke('definitions.upsert', { doc });
  }
}
