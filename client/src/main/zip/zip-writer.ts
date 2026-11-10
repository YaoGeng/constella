// ZipWriter —— main 侧 zip 写组件（T5-06 / TDD-C-08 §3 ZipWriter 组件行；client 唯一
// jszip import 处之一——§6.8 收窄面 client/src/main/zip/）。
//
// S-6 三强制项落点：
//   ② `createFolders:false` 必须设在 jszip.file() 选项上（generateAsync 同名选项实测无效，
//      否则 central 目录多出 `nodes/` 等伪空文件条目——实测多 8 条）；写后自校验强制
//      「条目名集合与输入严格相等、零目录条目」，伪条目即抛。
//   ① 写端 UTC 自洽免换算：per-file `date` 经 jszip getUTC* 口径编码，写后以
//      DosTimeConverter.dosFields（UTC）比对 central 记录——写读自洽。
//   ③ 读端统一 jszip 归 ZipReader（T5-07）；本组件只写。
// store 档（02 §2.5「写端 store」）＋CRC32 自校验器（demo L2502-2510 移植，./crc32——
// central 记录与独立实现重算一致，02 §2.5「保留在 ZipPipeline 内作导出产物自校验」）。
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { crc32 } from './crc32';
import { createDosTimeConverter } from './dos-time';

/** 待写文件（字符串按 UTF-8 编码；二进制原字节） */
export interface ZipFileInput {
  name: string;
  data: string | Uint8Array;
}

export interface ZipWriteResult {
  /** 产物字节（与写盘内容一致——checksum/幂等键消费面） */
  bytes: Buffer;
  /** central 目录条目数（===输入文件数，自校验保证） */
  entries: number;
}

/** central 目录条目（自校验/测试断言面；偏移量单位=字节） */
export interface CentralEntry {
  name: string;
  crc: number;
  /** 压缩方法（store=0） */
  method: number;
  compressedSize: number;
  size: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
}

export interface ZipWriterOptions {
  /** per-file DOS 时间（缺省=当前时刻；确定性产物传固定值——见 export-pipeline ZIP_EPOCH） */
  date?: Date;
}

export interface ZipWriter {
  /** 组件级接口（§3 冻结形）：组装→store 档字节→CRC32/伪目录/时间三重自校验→写盘 */
  write(files: readonly ZipFileInput[], savePath: string, opts?: ZipWriterOptions): Promise<ZipWriteResult>;
  /** 字节产物面（✅ 02 v1.0f〔T5-11〕）：与 write 同构组装＋三重自校验——**不写盘**
   * （zip:export 字节变体消费；发布上传链 multipart 免文件读回） */
  build(files: readonly ZipFileInput[], opts?: ZipWriterOptions): Promise<ZipWriteResult>;
}

const encoder = new TextEncoder();

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data;
}

/** EOCD → central 目录遍历（demo readZip L2548-2570 骨架；本组件只读目录不展开数据） */
export function readCentralEntries(bytes: Uint8Array): CentralEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = bytes.length - 22;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (; i >= min; i--) if (dv.getUint32(i, true) === 0x06054b50) break;
  if (i < min) throw new Error('ZipWriter 自校验失败：不是有效的 zip（EOCD 缺失）');
  const count = dv.getUint16(i + 10, true);
  const cdOff = dv.getUint32(i + 16, true);
  const td = new TextDecoder();
  const out: CentralEntry[] = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) break;
    out.push({
      method: dv.getUint16(p + 10, true),
      crc: dv.getUint32(p + 16, true),
      compressedSize: dv.getUint32(p + 20, true),
      size: dv.getUint32(p + 24, true),
      name: td.decode(bytes.subarray(p + 46, p + 46 + dv.getUint16(p + 28, true))),
      dosTime: dv.getUint16(p + 12, true),
      dosDate: dv.getUint16(p + 14, true),
      localHeaderOffset: dv.getUint32(p + 42, true),
    });
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

/**
 * 导出产物自校验（02 §2.5）：central 条目数/名字一一对应（零伪目录条目——S-6 ②）、
 * CRC32 ≡独立实现重算、store 档 method=0、DOS 时间≡DosTimeConverter（UTC 自洽——S-6 ①）。
 * 任一不符即抛（write() 内部调用；测试可独立调用断言篡改检出）。
 */
export async function verifyZipSelfCheck(
  bytes: Uint8Array,
  files: readonly ZipFileInput[],
): Promise<CentralEntry[]> {
  const entries = readCentralEntries(bytes);
  if (entries.length !== files.length) {
    throw new Error(
      `ZipWriter 自校验失败：central 目录条目 ${entries.length} ≠ 输入文件 ${files.length}` +
        `（疑似伪目录条目：${entries.filter((e) => !files.some((f) => f.name === e.name)).map((e) => e.name).join('、')}）`,
    );
  }
  for (const f of files) {
    const e = entries.find((x) => x.name === f.name);
    if (e === undefined) throw new Error(`ZipWriter 自校验失败：central 目录缺条目 ${f.name}`);
    if (e.name.endsWith('/')) throw new Error(`ZipWriter 自校验失败：伪目录条目 ${e.name}（S-6 ②）`);
    if (e.method !== 0) throw new Error(`ZipWriter 自校验失败：${f.name} 非 store 档（method=${e.method}）`);
    const want = crc32(toBytes(f.data));
    if (e.crc !== want) {
      throw new Error(`ZipWriter 自校验失败：${f.name} CRC32 不一致（central=${e.crc.toString(16)} 重算=${want.toString(16)}）`);
    }
    if (e.size !== toBytes(f.data).byteLength || e.compressedSize !== e.size) {
      throw new Error(`ZipWriter 自校验失败：${f.name} 尺寸不一致`);
    }
  }
  return entries;
}

export function createZipWriter(): ZipWriter {
  /** 组装＋自校验公共段（write/build 共用——S-6 三强制项唯一实现） */
  async function assemble(files: readonly ZipFileInput[], date: Date): Promise<ZipWriteResult> {
    const zip = new JSZip();
    for (const f of files) {
      // S-6 ②：createFolders:false 必须设在 file() 选项（generateAsync 同名选项实测无效）
      zip.file(f.name, f.data, { createFolders: false, date });
    }
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
    // 三重自校验（条目/CRC32/store 档）＋写端 UTC 自洽（central ≡ dosFields(date)——S-6 ①）
    const entries = await verifyZipSelfCheck(bytes, files);
    const want = createDosTimeConverter().dosFields(date);
    for (const e of entries) {
      if (e.dosTime !== want.time || e.dosDate !== want.date) {
        throw new Error(`ZipWriter 自校验失败：${e.name} DOS 时间非 UTC 口径（S-6 ①）`);
      }
    }
    return { bytes, entries: entries.length };
  }

  return {
    async write(files, savePath, opts) {
      const { bytes, entries } = await assemble(files, opts?.date ?? new Date());
      await writeFile(savePath, bytes);
      return { bytes, entries };
    },
    async build(files, opts) {
      // v1.0f 字节面：不落盘（调用方持字节——发布上传链）
      return assemble(files, opts?.date ?? new Date());
    },
  };
}
