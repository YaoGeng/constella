// renderer storage 半段导出面（T1-08；C-06 §3 renderer 四行）。
export { createStorageClient } from './storage-client';
export type { StorageBridge, StorageClient, StorageInvokeArgs } from './storage-client';
export { IpcDefinitionStore } from './ipc-definition-store';
export type { NodeDefinitionStore } from './ipc-definition-store';
export { createSaveOrchestrator } from './save-orchestrator';
export type { SaveContext, SaveOrchestrator } from './save-orchestrator';
export { AutoSaveScheduler } from './auto-save-scheduler';
export type { AutoSaveSchedulerOptions } from './auto-save-scheduler';
