// DraftZipBuilder —— workshop store 档组装器（T5-03 / TDD-C-07 §3 NodeDevAgent 行的组装半段）。
//   03 L1101 v1.0e 对齐注（2026-11-10 PM）：NodeDevAgent 内存 zip→导入链传入形态＝**bytes 直入
//   importArchiveBytes**——组装＝renderer 手写 store 档组装器（零三方 zip 库依赖：C-08 §2「三方 zip 库
//   import 收窄面=client/src/main/zip/」不破；demo buildZip L2502-2517 同构参照）；cache 临时文件
//   转 V2 扩展点（C-13 §2 同解同步）。
//
// S-6 三强制项吸收（T5-06 报告项——demo 参照非权威，正式口径在此落位）：
//   ① UTC 自洽：全部条目 DOS 时间取固定 DRAFT_ZIP_EPOCH（1980-01-01 UTC＝T5-06 export-pipeline
//      ZIP_EPOCH 确定性语义——同输入同产物字节，checksum/幂等键消费面）；
//   ② createFolders 语义：只写文件条目、零目录条目（条目名集合与输入严格相等）；
//   ③ 读端归 main ZipReader（三方 zip 库唯一读入口）——本组件只写；roundtrip 兼容性经真读端
//      ＋真 ZipSecurityValidator 集成测试保证（node-dev-agent.spec「真链集成」）。
// 结构＝demo buildZip 同构：局部文件头(30B)＋数据＋中央目录(46B)＋EOCD(22B)；store 档
// （method=0，02 §2.5「写端 store」）＋CRC32 查表法（demo L2502-2510）＋UTF-8 文件名标志
// （0x0800——中文名保留）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PackageManifest } from '@constella/shared/manifest';

// ————————————————————————————————————————————
// store 档 zip 写档（低层——demo buildZip L2513-2546 同构，产物 Uint8Array）
// ————————————————————————————————————————————

/** 待写文件（字符串按 UTF-8 编码；二进制原字节） */
export interface DraftZipFile {
  name: string;
  data: string | Uint8Array;
}

/** 确定性 DOS 时间（1980-01-01 00:00:00 UTC——T5-06 ZIP_EPOCH 语义；time=0/date=0x21） */
export const DRAFT_ZIP_EPOCH: { readonly time: number; readonly date: number } = {
  time: 0,
  date: (1 << 5) | 1, // ((1980-1980)<<9)|(1<<5)|1
};

const encoder = new TextEncoder();

let CRC_TABLE: Uint32Array | undefined;

/** CRC32 查表法（demo L2502-2510 移植——与 main/zip/crc32 同算法，写档内部自用） */
function crc32(u8: Uint8Array): number {
  if (CRC_TABLE === undefined) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]!) & 0xff]! ^ (c >>> 8); // demo L2508 同款 &255
  return ~c >>> 0;
}

/**
 * store 档 zip 组装（零三方 zip 库依赖）。确定性：DOS 时间固定 DRAFT_ZIP_EPOCH（S-6 ①）＋文件序=输入序
 * ——同输入两次组装字节相同。
 */
export function buildStoreZip(files: readonly DraftZipFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Array<{ nameBytes: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;

  for (const f of files) {
    const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(data);
    // 局部文件头（30B）：sig/version 20/UTF-8 flag/store/time/date/crc/size/size/namelen/extralen
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 文件名标志（demo L2522 同位）
    lh.setUint16(8, 0, true); // store 档（02 §2.5）
    lh.setUint16(10, DRAFT_ZIP_EPOCH.time, true);
    lh.setUint16(12, DRAFT_ZIP_EPOCH.date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.byteLength, true);
    lh.setUint32(22, data.byteLength, true);
    lh.setUint16(26, nameBytes.byteLength, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameBytes, data);
    central.push({ nameBytes, crc, size: data.byteLength, offset });
    offset += 30 + nameBytes.byteLength + data.byteLength;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const e of central) {
    // 中央目录头（46B）：sig/verMade 20/verNeed 20/flag/time/date/crc/size/size/namelen/…/offset
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); // store 档（显式落零——零初始化缓冲不依赖）
    cd.setUint16(12, DRAFT_ZIP_EPOCH.time, true);
    cd.setUint16(14, DRAFT_ZIP_EPOCH.date, true);
    cd.setUint32(16, e.crc, true);
    cd.setUint32(20, e.size, true);
    cd.setUint32(24, e.size, true);
    cd.setUint16(28, e.nameBytes.byteLength, true);
    cd.setUint32(42, e.offset, true);
    parts.push(new Uint8Array(cd.buffer), e.nameBytes);
    cdSize += 46 + e.nameBytes.byteLength;
  }

  // EOCD（22B）
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  parts.push(new Uint8Array(eocd.buffer));

  const out = new Uint8Array(cdStart + cdSize + 22); // 局部条目总量＋中央目录＋EOCD
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.byteLength;
  }
  return out;
}

// ————————————————————————————————————————————
// 四件套组装（T5-06 发布变体自包含形——manifest＋nodes/*.json＋scripts/＋config/＋deps/）
// ————————————————————————————————————————————

/** 脚本资产（N4 ExecSpec 同源三字段＋源码——run(ctx) 契约＋PARAMS 默认值表由生成侧保证） */
export interface NodePackageScript {
  /** zip 包内相对路径（如 "scripts/xhs_search.py"——与 definition.exec.file 同值） */
  file: string;
  lang: 'python' | 'ts';
  entry: string;
  code: string;
}

/** config/deps 条目（file=包内相对路径；content=原文） */
export interface NodePackageFileEntry {
  file: string;
  content: string;
}

export interface NodePackageParts {
  /** N1~N8 定义（草稿自检已过——C-02 validateDefinition） */
  definition: NodeDefinition;
  /** 脚本资产（缺省=弱节点 exec=null：manifest 无 scripts 键、包内无 scripts/ 条目） */
  script?: NodePackageScript;
  /** config/*.yaml（可选） */
  config?: NodePackageFileEntry;
  /** deps/ 声明（可选） */
  deps?: NodePackageFileEntry;
  /** 实例参数预填（nodes/*.json params 层——导入链落节点/入库消费；空对象不落键） */
  params?: Record<string, unknown>;
  /** manifest.name 覆盖（缺省=definition.meta.name） */
  manifestName?: string;
}

export interface AssembledNodePackage {
  /** store 档 zip 字节（确认前只在内存——adopt 后直入 importArchiveBytes） */
  bytes: Uint8Array;
  /** 四件套清单面（manifest.json 同形——草稿卡清单展示/断言） */
  manifest: PackageManifest;
  /** 组装文件清单（roundtrip/审计面） */
  files: DraftZipFile[];
}

/** 节点名→安全文件名段（T5-06 export-pipeline 同款——非法字符→_；中文名保留，UTF-8 文件名） */
function safeStem(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_') || 'node';
}

/**
 * 四件套组装（发布变体自包含形——T5-06 L201-204 同构）：manifest.json（scripts 映射键=类型
 * ——包无实例，PackageParser byType 直映消歧）＋nodes/<safeStem(meta.name)>.json
 * {type,name,definition[,params]}＋scripts/＋config/＋deps/。
 */
export function assembleNodePackage(parts: NodePackageParts): AssembledNodePackage {
  const def = parts.definition;
  const manifest: PackageManifest = {
    kind: 'node',
    name: parts.manifestName ?? def.meta.name,
    version: def.packageVersion, // D-11：首发 1.0.0（V1 单版本覆盖更新）
    ...(parts.script !== undefined
      ? { scripts: { [def.type]: { file: parts.script.file, lang: parts.script.lang, entry: parts.script.entry } } }
      : {}),
  };
  const params = parts.params ?? {};
  const files: DraftZipFile[] = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    {
      name: `nodes/${safeStem(def.meta.name)}.json`,
      data: JSON.stringify(
        {
          type: def.type,
          name: def.meta.name,
          definition: def, // 自包含定义（导入侧 definitions.upsert 输入——C-08 AssetInstaller）
          ...(Object.keys(params).length > 0 ? { params } : {}),
        },
        null,
        2,
      ),
    },
  ];
  if (parts.script !== undefined) files.push({ name: parts.script.file, data: parts.script.code });
  if (parts.config !== undefined) files.push({ name: parts.config.file, data: parts.config.content });
  if (parts.deps !== undefined) files.push({ name: parts.deps.file, data: parts.deps.content });
  return { bytes: buildStoreZip(files), manifest, files };
}
