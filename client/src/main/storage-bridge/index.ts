// main/storage-bridge 域导出面（T4-20 / TDD-C-M1 §3 StorageService 组件行＋§1 矩阵
// storage:invoke／zip:* 行——C-06 持久层与 C-M1 服务层的桥接层）。
// 消费方：AppRuntime 生产装配（production-assembly.ts——五服务组合根接线）。
export {
  FACTORY_RESET_DIR_NAMES,
  StorageService,
  type StorageServiceAppFace,
  type StorageServiceDeps,
} from './storage-service';
export { registerStorageInvokeChannel, type StorageServiceChannelFace } from './storage-channels';
export {
  ZipError,
  registerZipChannels,
  type ZipExportPipeline,
  type ZipImportPipeline,
  type ZipPipelines,
} from './zip-channels';
