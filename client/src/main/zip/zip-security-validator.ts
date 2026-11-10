// ZipSecurityValidator —— zip 解析攻击面校验器（T5-07 / TDD-C-08 §3 组件行；02 §12.2#4
// 「设计值 03 冻结」的落点——三级防护 #4）。
//
// 六限值（02 §12.2#4 原文）：条目数 ≤500／单文件解压 ≤2MB／总量 ≤20MB／脚本 ≤512KB／
// `..`·绝对路径·symlink 条目拒绝→ZIP-UNSAFE-ENTRY；manifest JSON Schema 校验
// （源型=X-01 PackageManifest）→ZIP-INVALID。
//
// 双面跑（§3 复用处=inspect/commit 双跑）：
//   - validateMeta(metas)：解压前限值（条目数/单文件/总量/脚本/路径/symlink）——central 面输入
//     （zip 炸弹在解压前拦截）；
//   - validate(entries)：全规则=validateMeta 同规则（按解压实况）＋manifest.json 存在性/
//     JSON 合法性/顶层形（kind 字面量域＋name/version 非空——X-01 PackageManifest）。
import type { PackageKind, PackageManifest } from '@constella/shared/manifest';

/** 02 §12.2#4 设计值（03 冻结——常量导出为断言面） */
export const ZIP_SECURITY_LIMITS = {
  maxEntries: 500,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxScriptBytes: 512 * 1024,
} as const;

const PACKAGE_KINDS: readonly PackageKind[] = ['node', 'pack', 'flow'];

/** 校验器条目输入（metas 或 readAll 产物＋元信息合并形） */
export interface ZipSecurityEntry {
  name: string;
  size: number;
  compressedSize?: number;
  dir: boolean;
  unixPermissions?: number;
  /** 解压后数据（validate 全规则面；缺省仅按 size 限值判定） */
  data?: Uint8Array;
}

type SecurityCode = 'ZIP-INVALID' | 'ZIP-UNSAFE-ENTRY';

export type SecurityReport =
  | { ok: true }
  | { ok: false; code: SecurityCode; message: string };

const isSymlink = (unixPermissions: number | undefined): boolean =>
  unixPermissions !== undefined && (unixPermissions & 0o170000) === 0o120000; // S_IFLNK

/** 路径攻击面：`..` 段（正反斜杠）/绝对路径（POSIX / 与 Windows 盘符） */
function isUnsafeEntryName(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(name)) return true;
  return name.split(/[\\/]/).includes('..');
}

/** manifest 顶层形校验（X-01 PackageManifest 源型——kind 字面量域＋name/version 非空串） */
function checkManifestShape(raw: unknown): { ok: true; manifest: PackageManifest } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'manifest.json 顶层须为对象' };
  const m = raw as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !(PACKAGE_KINDS as readonly string[]).includes(m.kind)) {
    return { ok: false, message: `manifest.kind「${String(m.kind)}」不在 node/pack/flow 域（X-01 PackageKind）` };
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') return { ok: false, message: 'manifest.name 须为非空字符串' };
  if (typeof m.version !== 'string' || m.version.trim() === '') return { ok: false, message: 'manifest.version 须为非空字符串' };
  if (m.summary !== undefined && typeof m.summary !== 'string') return { ok: false, message: 'manifest.summary 须为字符串' };
  if (m.scripts !== undefined && (typeof m.scripts !== 'object' || m.scripts === null || Array.isArray(m.scripts))) {
    return { ok: false, message: 'manifest.scripts 须为 node→{file,lang,entry} 映射对象' };
  }
  return { ok: true, manifest: raw as PackageManifest };
}

/** 解压文本（manifest/解析面消费——UTF-8） */
export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export interface ZipSecurityValidator {
  /** 解压前限值面（central 元信息——zip 炸弹/路径/symlink/条目数/脚本大小） */
  validateMeta(metas: readonly ZipSecurityEntry[]): SecurityReport;
  /** 全规则面（＋manifest.json JSON/顶层形→ZIP-INVALID）；entries 可含解压数据 */
  validate(entries: readonly ZipSecurityEntry[]): SecurityReport;
}

export function createZipSecurityValidator(): ZipSecurityValidator {
  const checkLimits = (entries: readonly ZipSecurityEntry[]): SecurityReport => {
    if (entries.length > ZIP_SECURITY_LIMITS.maxEntries) {
      return {
        ok: false,
        code: 'ZIP-UNSAFE-ENTRY',
        message: `条目数 ${entries.length} 超限（≤${ZIP_SECURITY_LIMITS.maxEntries}，02 §12.2#4）`,
      };
    }
    let total = 0;
    for (const e of entries) {
      if (isUnsafeEntryName(e.name)) {
        return {
          ok: false,
          code: 'ZIP-UNSAFE-ENTRY',
          message: `条目名路径攻击面拒绝：${e.name}（.. 穿越/绝对路径，02 §12.2#4）`,
        };
      }
      if (isSymlink(e.unixPermissions)) {
        return {
          ok: false,
          code: 'ZIP-UNSAFE-ENTRY',
          message: `symlink 条目拒绝：${e.name}（Unix S_IFLNK，02 §12.2#4）`,
        };
      }
      const size = e.data?.byteLength ?? e.size;
      if (size > ZIP_SECURITY_LIMITS.maxFileBytes) {
        return {
          ok: false,
          code: 'ZIP-UNSAFE-ENTRY',
          message: `条目 ${e.name} 解压 ${size}B 超单文件上限（≤${ZIP_SECURITY_LIMITS.maxFileBytes}B）`,
        };
      }
      if (!e.dir && e.name.startsWith('scripts/') && size > ZIP_SECURITY_LIMITS.maxScriptBytes) {
        return {
          ok: false,
          code: 'ZIP-UNSAFE-ENTRY',
          message: `脚本 ${e.name} 解压 ${size}B 超脚本上限（≤${ZIP_SECURITY_LIMITS.maxScriptBytes}B）`,
        };
      }
      if (!e.dir) total += size;
    }
    if (total > ZIP_SECURITY_LIMITS.maxTotalBytes) {
      return {
        ok: false,
        code: 'ZIP-UNSAFE-ENTRY',
        message: `解压总量 ${total}B 超限（≤${ZIP_SECURITY_LIMITS.maxTotalBytes}B——zip 炸弹防护）`,
      };
    }
    return { ok: true };
  };

  return {
    validateMeta: checkLimits,
    validate(entries) {
      const limits = checkLimits(entries);
      if (!limits.ok) return limits;
      const manifest = entries.find((e) => e.name === 'manifest.json');
      if (manifest === undefined) {
        return { ok: false, code: 'ZIP-INVALID', message: '包内缺 manifest.json（四件套不完整）' };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(decodeUtf8(manifest.data ?? new Uint8Array()));
      } catch (err) {
        return {
          ok: false,
          code: 'ZIP-INVALID',
          message: `manifest.json 非法 JSON：${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const shape = checkManifestShape(raw);
      if (!shape.ok) return { ok: false, code: 'ZIP-INVALID', message: `manifest Schema 校验失败：${shape.message}` };
      return { ok: true };
    },
  };
}
