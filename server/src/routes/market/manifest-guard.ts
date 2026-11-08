/**
 * ManifestGuard（TDD-S-02 §3；T2-06）：处理序②③——zip 解包安全校验 + manifest Zod 解析 + perms 推导
 * + semver 工具（首发 1.0.0/须大于既有最大 的比较器；规则裁定在 PublishPipeline）。
 * 安全规则＝02 §12.2#4 设计值（server 侧执行）：条目 ≤500、单文件解压 ≤2MB、总量 ≤20MB、
 * 脚本 ≤512KB、`..`/绝对路径/symlink 条目拒绝、manifest JSON Schema 校验（源型=X-01 PackageManifest）。
 * 零新依赖：zip 只读解析用 node:buffer + node:zlib（store/deflate；ZIP64 拒收——上限内无需支持）。
 */
import { inflateRawSync } from "node:zlib";
import type { PermLabel } from "@constella/shared/dto";
import type { PackageManifest } from "@constella/shared/manifest";
import { ApiError } from "../../kernel/errors.js";
import { manifestSchema } from "./market.schemas.js";

/**
 * ⚠ 上报（值常量本地冻结副本）：X-01 shared 包 exports 仅含 types 条件（无 import/default），
 * 运行时无法跨包 import 值常量（vitest/vite 解析报 not exported；既有 shared-smoke 仅编译期冒烟）。
 * 以下两集合为封闭冻结集，副本与 X-01 constants 同源逐项一致：
 * - BUILTIN_TYPE_IDS（01 PRD-A4-01 清单冻结 12 type）
 * - PERM_LABELS（六标签封闭集，顺序＝X-01 constants/perms.ts）
 */
const BUILTIN_TYPE_IDS: readonly string[] = [
  "trigger.manual",
  "trigger.cron",
  "cdp.open",
  "cdp.extract",
  "cdp.click",
  "http.request",
  "ai.llm",
  "data.transform",
  "logic.branch",
  "delay",
  "file.write",
  "human.review",
];
const PERM_LABELS: readonly PermLabel[] = ["CDP", "网络", "文件", "AI", "交互", "社媒"];

// ---- 设计值常量（02 §12.2#4）----
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024; // ① zip 总量 ≤20MB（含解压总量上限同值）
export const MAX_ENTRIES = 500;
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 单文件解压 ≤2MB
export const MAX_SCRIPT_BYTES = 512 * 1024; // 脚本 ≤512KB（scripts/ 目录内文件）

/** 类目→权限标签映射（与 C-05 PermDeriver 同源：五类目同名直映、数据→文件、未命中不产生；builtin 不计） */
const PERM_BY_CATEGORY: Readonly<Record<string, PermLabel>> = {
  CDP: "CDP",
  网络: "网络",
  AI: "AI",
  交互: "交互",
  社媒: "社媒",
  数据: "文件",
};

/** perms 推导（server 复核存 Package.perms，02 §12.2#1）；输出按六标签封闭集顺序（确定性） */
export function derivePerms(categories: readonly string[]): PermLabel[] {
  const hit = new Set<PermLabel>();
  for (const category of categories) {
    const label = PERM_BY_CATEGORY[category];
    if (label) hit.add(label);
  }
  return PERM_LABELS.filter((label) => hit.has(label));
}

/** 包内容非法（02 §6.1 业务码 → 400，映射表见 kernel/errors.ts） */
function fileInvalid(message: string): never {
  throw new ApiError("MARKET-FILE-INVALID", message);
}

// ---- zip 只读解析 ----

interface ZipEntry {
  name: string;
  data: Buffer;
  isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CDE_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;
const ZIP64_FLAG = 0xffff;

/** 解析并安全校验 zip（规则见文件头）；返回全部条目（含目录条目，data 为空 Buffer） */
function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) fileInvalid("not a zip archive");

  // EOCD 回扫（尾部 22B + 注释区上限 64KB）
  let eocdOffset = -1;
  const scanFloor = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) fileInvalid("missing zip end-of-central-directory");

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (entryCount === ZIP64_FLAG || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    fileInvalid("zip64 archives are not supported");
  }
  if (entryCount > MAX_ENTRIES) fileInvalid(`too many entries (>${MAX_ENTRIES})`);

  const entries: ZipEntry[] = [];
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDE_SIGNATURE) {
      fileInvalid("corrupt zip central directory");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const externalAttrs = buf.readUInt32LE(offset + 38);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");

    // 条目名安全：`..` 段/绝对路径/盘符/反斜杠/NUL 一律拒绝（02 §12.2#4）
    if (
      name.length === 0 ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.includes("\0") ||
      name.split("/").some((segment) => segment === ".." || segment === ".")
    ) {
      fileInvalid(`unsafe entry name: ${JSON.stringify(name)}`);
    }
    // symlink 条目拒绝（unix mode 高 16 位 S_IFLNK=0xA000）
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      fileInvalid(`symlink entry is not allowed: ${JSON.stringify(name)}`);
    }

    const isDirectory = name.endsWith("/");
    if (!isDirectory) {
      if (method !== 0 && method !== 8) fileInvalid(`unsupported compression method (${method})`);
      if (uncompressedSize > MAX_FILE_BYTES) fileInvalid(`file too large (>${MAX_FILE_BYTES}B): ${name}`);
      if (name.startsWith("scripts/") && uncompressedSize > MAX_SCRIPT_BYTES) {
        fileInvalid(`script too large (>${MAX_SCRIPT_BYTES}B): ${name}`);
      }
    }

    if (!isDirectory) {
      // 本地头定位数据段（data descriptor 情形下本地头 sizes 可能为 0，以中央目录为准）
      if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== LFH_SIGNATURE) {
        fileInvalid("corrupt zip local header");
      }
      const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      if (dataStart + compressedSize > buf.length) fileInvalid("truncated zip entry data");
      const rawData = buf.subarray(dataStart, dataStart + compressedSize);
      let data: Buffer;
      if (method === 0) {
        data = Buffer.from(rawData);
      } else {
        try {
          data = inflateRawSync(rawData, { maxOutputLength: MAX_FILE_BYTES + 1 });
        } catch {
          fileInvalid(`entry failed safety inflate: ${name}`);
        }
      }
      if (data.length !== uncompressedSize) fileInvalid(`entry size mismatch: ${name}`);
      entries.push({ name, data, isDirectory: false });
    } else {
      entries.push({ name, data: Buffer.alloc(0), isDirectory: true });
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** nodes/*.json 形（lenient——定义校验本体归 C-02，本处只取 perms 推导所需键） */
interface NodeDefinitionLike {
  type?: unknown;
  kind?: unknown;
  meta?: { category?: unknown } | undefined;
}

/** nodes/*.json 收集非内置类目（builtin 不计=01 A-13.1「只选内置类型→无特殊权限」） */
function collectCategories(entries: readonly ZipEntry[]): string[] {
  const categories: string[] = [];
  for (const entry of entries) {
    if (!/^nodes\/[^/]+\.json$/.test(entry.name)) continue;
    let node: NodeDefinitionLike;
    try {
      node = JSON.parse(entry.data.toString("utf8")) as NodeDefinitionLike;
    } catch {
      fileInvalid(`invalid node definition JSON: ${entry.name}`);
    }
    if (typeof node !== "object" || node === null) fileInvalid(`invalid node definition: ${entry.name}`);
    const isBuiltin =
      node.kind === "builtin" ||
      (typeof node.type === "string" && (BUILTIN_TYPE_IDS as readonly string[]).includes(node.type));
    if (isBuiltin) continue;
    const category = node.meta?.category;
    if (typeof category === "string" && category.length > 0) categories.push(category);
  }
  return categories;
}

export interface InspectResult {
  manifest: PackageManifest;
  perms: PermLabel[];
  /** zip 字节数（归档大小=用户下载体积；PackageVersion.sizeBytes 口径） */
  sizeBytes: number;
}

/** 处理序②③：解包安全 + manifest Zod + perms 推导（大小/类型①与 checksum 幂等由 PublishPipeline 前置） */
export function inspectZip(buf: Buffer): InspectResult {
  const entries = readZipEntries(buf);

  const totalBytes = entries.reduce((sum, e) => sum + e.data.length, 0);
  if (totalBytes > MAX_ARCHIVE_BYTES) fileInvalid(`decompressed total exceeds ${MAX_ARCHIVE_BYTES}B`);

  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  if (!manifestEntry) fileInvalid("missing manifest.json");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch {
    fileInvalid("manifest.json is not valid JSON");
  }
  const parsed = manifestSchema.safeParse(manifestJson);
  if (!parsed.success) fileInvalid(`manifest.json schema violation: ${parsed.error.issues[0]?.message ?? ""}`);

  const perms = derivePerms(collectCategories(entries));
  return { manifest: parsed.data, perms, sizeBytes: buf.length };
}

// ---- semver 工具（D-11：首发 1.0.0、后续须大于既有最大）----

/** 归一化：容忍前导 v（D-11 记法「首发 v1.0.0」），存档/对象键统一去 v */
export function normalizeSemver(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

/** 解析为 [major,minor,patch]（正则已在 manifestSchema 保证形状） */
function parseSemver(semver: string): [number, number, number] {
  const [major, minor, patch] = semver.split(".").map((part) => Number.parseInt(part, 10));
  return [major, minor, patch];
}

/** 比较：a>b → 正；a<b → 负；相等 → 0 */
export function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}
