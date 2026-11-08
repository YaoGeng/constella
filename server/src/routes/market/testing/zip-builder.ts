/**
 * 测试支撑：内存 zip 构建器（仅测试消费——非业务代码）。
 * store/deflate 两档、可指定 unix mode（symlink 拒收用例需要 S_IFLNK 位）、可注入任意条目名
 * （`..`/绝对路径/超量条目等恶意包用例）。与 manifest-guard 的只读解析器互为对端。
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntrySpec {
  name: string;
  data?: Buffer;
  method?: "store" | "deflate";
  /** unix mode 位（默认 0o100644 regular file；symlink 用例传 0o120777） */
  unixMode?: number;
}

/** DOS 时间字段（固定值即可——内容与时间无关） */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function buildZip(specs: readonly ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const spec of specs) {
    const nameBuf = Buffer.from(spec.name, "utf8");
    const isDirectory = spec.name.endsWith("/");
    const raw = spec.data ?? Buffer.alloc(0);
    const method = spec.method === "deflate" && !isDirectory ? 8 : 0;
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    localParts.push(localHeader, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((((spec.unixMode ?? 0o100644) & 0xffff) * 0x10000) >>> 0, 38); // 32 位有符号左移会溢出——乘法+>>>0
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }

  const cdSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/** 标准四件套样本 zip（manifest + nodes + scripts；C-08 §1 zip 形） */
export function samplePackageZip(options: {
  kind?: "node" | "pack" | "flow";
  name?: string;
  version?: string;
  nodes?: Array<{ type: string; kind?: "builtin" | "custom"; category?: string }>;
  manifestOverride?: string;
  extraEntries?: ZipEntrySpec[];
  method?: "store" | "deflate";
}): Buffer {
  const manifest = {
    kind: options.kind ?? "node",
    name: options.name ?? "样本包",
    summary: "测试样本",
    version: options.version ?? "1.0.0",
    ...(options.nodes && options.nodes.some((n) => n.kind === "custom")
      ? {
          scripts: Object.fromEntries(
            options.nodes
              .filter((n) => n.kind === "custom")
              .map((n, i) => [n.type, { file: `scripts/${i}.py`, lang: "python" as const, entry: "run" }]),
          ),
        }
      : {}),
  };
  const nodeEntries = (options.nodes ?? []).map((n) => ({
    name: `nodes/${n.type.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
    data: Buffer.from(
      JSON.stringify({
        type: n.type,
        kind: n.kind ?? "custom",
        meta: { name: n.type, icon: "x", category: n.category ?? "逻辑" },
      }),
      "utf8",
    ),
    method: options.method,
  }));
  const scriptEntries = (options.nodes ?? [])
    .filter((n) => (n.kind ?? "custom") === "custom")
    .map((n, i) => ({ name: `scripts/${i}.py`, data: Buffer.from("# test script\n", "utf8"), method: options.method }));
  return buildZip([
    {
      name: "manifest.json",
      data: Buffer.from(options.manifestOverride ?? JSON.stringify(manifest), "utf8"),
      method: options.method,
    },
    ...nodeEntries,
    ...scriptEntries,
    ...(options.extraEntries ?? []),
  ]);
}
