// SaveOrchestrator —— 保存编排（T1-08；C-06 §3 renderer 行；demo L1637-1649 doSave 同源）。
//
// doSave(silent, ctx)：serialize（注入——P-3 不 import C-01/flowStore）→ flows.save（缺 id 时
// 先 flows.create）→ onSaved(versionId)（=换 snapshot 基线＋temporal 清栈，动作在 flowStore，
// 02 §3.3）。label 映射：silent=true→自动保存（AutoSaveScheduler 链路）/false→手动保存
// （header 按钮）。失败路径：save/create 抛错原样上抛（onSaved 不触发，基线不动）。
import type { FlowDoc, FlowVersionLabel } from '@constella/shared/ipc';
import type { StorageClient } from './storage-client';

/** 保存上下文（序列化器/回调由 flowStore 注入——P-3） */
export interface SaveContext {
  serialize(): FlowDoc;
  onSaved(versionId: string): void;
}

export interface SaveOrchestrator {
  doSave(silent: boolean, ctx: SaveContext): Promise<void>;
}

export function createSaveOrchestrator(client: StorageClient): SaveOrchestrator {
  return {
    async doSave(silent: boolean, ctx: SaveContext): Promise<void> {
      const doc = ctx.serialize();
      const label: FlowVersionLabel = silent ? '自动保存' : '手动保存';
      // 新画布首存：先建流程（flows.create 打「初始版本」），再保存首版
      const id =
        doc.id ?? (await client.invoke('flows.create', { name: doc.name })).id;
      const { versionId } = await client.invoke('flows.save', {
        id,
        name: doc.name,
        nodes: doc.nodes,
        edges: doc.edges,
        label,
      });
      ctx.onSaved(versionId);
    },
  };
}
