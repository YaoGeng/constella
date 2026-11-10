// main 侧 zip 管线域（T5-06 导出半段＋T5-07 导入半段 / TDD-C-08 §3 main：client/src/main/zip/）
// ——jszip 唯一 import 面（§6.8 收窄：换库只动 zip-writer/zip-reader 两组件、四件套形与
// CRC32 自校验器不变）。
export { crc32 } from './crc32';
export { createDosTimeConverter, type DosFields, type DosTimeConverter } from './dos-time';
export {
  createZipWriter,
  readCentralEntries,
  verifyZipSelfCheck,
  type CentralEntry,
  type ZipFileInput,
  type ZipWriteResult,
  type ZipWriter,
  type ZipWriterOptions,
} from './zip-writer';
export { createZipExportPipeline, ZIP_EPOCH, type ZipExportPipelineDeps } from './export-pipeline';
// ———— T5-07 导入半段（两段式 zip:import——inspect/commit）————
export { createZipReader, type ZipArchive, type ZipEntryMeta, type ZipReader } from './zip-reader';
export {
  ZIP_SECURITY_LIMITS,
  createZipSecurityValidator,
  decodeUtf8,
  type SecurityReport,
  type ZipSecurityEntry,
  type ZipSecurityValidator,
} from './zip-security-validator';
export {
  FALLBACK_TYPE,
  createPackageParser,
  type PackageParser,
  type PackageParserDeps,
  type ParsedNode,
  type ParsedPackage,
} from './package-parser';
export { createAssetInstaller, type AssetInstaller, type AssetInstallerDeps } from './asset-installer';
export { createZipImportPipeline, type ZipImportPipelineDeps } from './import-pipeline';
