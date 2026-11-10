// main 侧 zip 管线域（T5-06 / TDD-C-08 §3 main：client/src/main/zip/）——jszip 唯一 import 面
// （§6.8 收窄：换库只动 zip-writer/（未来 zip-reader），四件套形与 CRC32 自校验器不变）。
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
