// ZipReader / ZipSecurityValidator（T5-07 / TDD-C-08 §3 组件行＋§1 三级防护 #4 设计值）——
// `vitest run zip-pipeline` 过滤面随行（main 侧 node 直跑）。
//
// 覆盖：§6.2 deflate 读兼容（jszip loadAsync 唯一读入口——S-6 ③，对照 demo reader L2561
// 静默跳过反例）；S-6 ① 历史包 DOS 时间读出面（restoreLocal 换算前提——demo buildZip
// L2513-2546 本地墙钟口径写包，spikes/s6 fixture 同源复刻）；§6.3 安全校验四用例
// （`../x` 路径穿越 / 501 条目 / 513KB 脚本 / manifest 非法 JSON → ZIP-UNSAFE-ENTRY / ZIP-INVALID）
// ＋ 12.2#4 其余限值（单文件 2MB / 总量 20MB / 绝对路径 / symlink 条目）。
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { createDosTimeConverter } from './dos-time';
import {
  ZIP_SECURITY_LIMITS,
  createZipSecurityValidator,
  type ZipSecurityEntry,
} from './zip-security-validator';
import { createZipReader } from './zip-reader';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zipread-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const enc = new TextEncoder();

// ————————————————————————————————————————————
// demo 历史包生成器（demo buildZip L2513-2546 同源复刻——spikes/s6-jszip/src/demo-zip.mjs
// 精简版：store 档＋UTF-8 文件名标志 0x0800＋**本地墙钟** DOS 时间 getHours/getFullYear）。
// ————————————————————————————————————————————
function demoBuildZip(files: readonly { name: string; str: string }[], now: Date): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const u8 = enc.encode(f.str);
    const name = enc.encode(f.name);
    const crc = crc32(u8);
    const sz = u8.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 文件名（S-6 互通规则 3）
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, sz, true);
    lh.setUint32(22, sz, true);
    lh.setUint16(26, name.length, true);
    parts.push(Buffer.from(lh.buffer), Buffer.from(name), Buffer.from(u8));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, sz, true);
    ch.setUint32(24, sz, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(Buffer.from(ch.buffer), Buffer.from(name));
    offset += 30 + name.length + sz;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  return Buffer.concat([...parts, ...central, Buffer.from(eocd.buffer)]);
}

async function putZip(rel: string, bytes: Buffer): Promise<string> {
  const p = path.join(tmp, rel);
  await writeFile(p, bytes);
  return p;
}

/** 合法四件套最小包条目（manifest 供 validator 全规则面消费） */
const VALID_MANIFEST = JSON.stringify({ kind: 'node', name: '示例包', version: '1.0.0' });

// ————————————————————————————————————————————
// ZipReader（S-6 ③：jszip loadAsync 唯一读入口；store+deflate 兼容；metas 含 DOS 时间面）
// ————————————————————————————————————————————

describe('ZipReader（§6.1b/§6.2 前置）', () => {
  const reader = createZipReader();

  it('demo 历史包（store＋本地墙钟 DOS 时间）可读：内容字节级一致＋metas 面完整（S-6 ①）', async () => {
    // 本地墙钟 14:30:40（秒=偶数——DOS 时间 2s 粒度；spike 3a 复现值同源）
    const now = new Date(2026, 0, 15, 14, 30, 40);
    const zipPath = await putZip(
      'historic.zip',
      demoBuildZip(
        [
          { name: 'manifest.json', str: VALID_MANIFEST },
          { name: 'nodes/小红书搜索.json', str: JSON.stringify({ type: 'xhs.search', name: '小红书搜索', position: { x: 0, y: 0 }, params: { query: '咖啡' } }) },
          { name: 'scripts/🌟 emoji.py', str: 'def run(ctx):\n    return {}\n' },
        ],
        now,
      ),
    );
    const archive = await reader.open(zipPath);
    const entries = await archive.readAll();
    expect(Buffer.from(entries.get('scripts/🌟 emoji.py')!).toString('utf8')).toBe('def run(ctx):\n    return {}\n');
    expect(JSON.parse(Buffer.from(entries.get('nodes/小红书搜索.json')!).toString('utf8')).type).toBe('xhs.search');

    const metas = archive.metas();
    expect(metas.map((m) => m.name).sort()).toEqual(['manifest.json', 'nodes/小红书搜索.json', 'scripts/🌟 emoji.py'].sort());
    expect(metas.every((m) => m.method === 0)).toBe(true); // store 档（demo 写端口径）
    // S-6 ①：jszip 读出的 DOS 时间=UTC 墙钟错读——restoreLocal 换算后与 demo 写入时刻差=0
    const conv = createDosTimeConverter();
    for (const m of metas) {
      expect(m.date).toBeInstanceOf(Date);
      expect(conv.restoreLocal(m.date!.getTime())).toBe(now.getTime()); // 差=0（验收 §6.1b 时间项）
    }
  });

  it('deflate 重打包兼容（§6.2 / S-6 ③——对照 demo reader L2561 静默跳过反例）：第三方 deflate 包读回内容一致', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', VALID_MANIFEST, { createFolders: false });
    zip.file('nodes/A.json', JSON.stringify({ type: 'a.b', name: 'A', position: { x: 1, y: 2 }, params: { k: 'v' } }), { createFolders: false });
    zip.file('scripts/run.py', '# comment line to give deflate something to squeeze\n'.repeat(64), { createFolders: false });
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const zipPath = await putZip('deflate.zip', bytes);

    const archive = await reader.open(zipPath);
    const metas = archive.metas();
    expect(metas.every((m) => m.method === 8)).toBe(true); // 全 deflate（第三方工具重打包形态）
    const entries = await archive.readAll();
    expect(entries.size).toBe(3); // 零静默跳过（demo reader 对 deflate 条目全跳——替换点）
    expect(JSON.parse(Buffer.from(entries.get('manifest.json')!).toString('utf8')).name).toBe('示例包');
    expect(Buffer.from(entries.get('scripts/run.py')!).byteLength).toBe(enc.encode('# comment line to give deflate something to squeeze\n'.repeat(64)).byteLength);
    // read()：单条解压（store/deflate 统一入口）
    const one = await archive.read('nodes/A.json');
    expect(JSON.parse(Buffer.from(one).toString('utf8')).name).toBe('A');
  });

  it('§3 冻结组件级接口 read(path)：Map 全量（dir 条目跳过）', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', VALID_MANIFEST, { createFolders: false });
    // 显式目录条目（第三方打包常见）——readAll/ read 不产出
    zip.file('scripts/', '', { createFolders: false, dir: true });
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    const zipPath = await putZip('withdir.zip', bytes);
    const entries = await reader.read(zipPath);
    expect([...entries.keys()]).toEqual(['manifest.json']);
    const archive = await reader.open(zipPath);
    expect(archive.metas().some((m) => m.dir)).toBe(true); // metas 面保留 dir 标记（校验器输入）
  });

  it('非 zip 字节大声失败（EOCD 缺失）', async () => {
    const zipPath = await putZip('notazip.bin', Buffer.from('这不是 zip'));
    await expect(reader.open(zipPath)).rejects.toThrow(/EOCD|zip/i);
  });

  it('metas 以 central 原始名为权威（jszip 读端清洗 ../ 名——穿越检测不能依赖 jszip 键）', async () => {
    // 手工构造含 `../evil.json` 的包：jszip 写端（file() 清洗）与读端（loadAsync 键清洗）都造不出
    // /看不见该名——只有 central 目录保留原始名（readCentralEntries 面）。validator 串联拒之。
    const zipPath = await putZip(
      'traversal.zip',
      demoBuildZip(
        [
          { name: 'manifest.json', str: VALID_MANIFEST },
          { name: '../evil.json', str: 'x' },
        ],
        new Date(2026, 0, 15, 14, 30, 40),
      ),
    );
    const archive = await reader.open(zipPath);
    const names = archive.metas().map((m) => m.name);
    expect(names).toContain('../evil.json'); // 原始名（非 jszip 清洗后的 evil.json）
    const validator = createZipSecurityValidator();
    const report = validator.validateMeta(archive.metas());
    expect(report).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
  });
});

// ————————————————————————————————————————————
// ZipSecurityValidator（02 §12.2#4 设计值——03 §1 冻结；§6.3 安全四用例）
// ————————————————————————————————————————————

describe('ZipSecurityValidator（§6.3 四用例＋其余限值）', () => {
  const validator = createZipSecurityValidator();

  const entryOf = (name: string, opts: Partial<ZipSecurityEntry> = {}): ZipSecurityEntry => ({
    name,
    size: 16,
    compressedSize: 16,
    dir: false,
    ...opts,
  });
  const manifestEntry = (str = VALID_MANIFEST): ZipSecurityEntry => ({
    name: 'manifest.json',
    size: enc.encode(str).byteLength,
    compressedSize: 16,
    dir: false,
    data: enc.encode(str),
  });

  it('设计值冻结面（02 §12.2#4「设计值 03 冻结」）：条目 500／单文件 2MB／总量 20MB／脚本 512KB', () => {
    expect(ZIP_SECURITY_LIMITS.maxEntries).toBe(500);
    expect(ZIP_SECURITY_LIMITS.maxFileBytes).toBe(2 * 1024 * 1024);
    expect(ZIP_SECURITY_LIMITS.maxTotalBytes).toBe(20 * 1024 * 1024);
    expect(ZIP_SECURITY_LIMITS.maxScriptBytes).toBe(512 * 1024);
  });

  it('§6.3 用例一：条目名 `../x` 路径穿越 → ZIP-UNSAFE-ENTRY', () => {
    const report = validator.validateMeta([manifestEntry(), entryOf('../evil.json')]);
    expect(report).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    if (!report.ok) expect(report.message).toContain('../evil.json');
  });

  it('§6.3 用例二：条目 501 → ZIP-UNSAFE-ENTRY（≤500 拒；恰 500 过）', () => {
    const entries = [manifestEntry()];
    for (let i = 0; i < 499; i++) entries.push(entryOf(`nodes/n${i}.json`));
    expect(entries).toHaveLength(500);
    expect(validator.validateMeta(entries)).toMatchObject({ ok: true }); // 恰 500 过界
    entries.push(entryOf('nodes/one-too-many.json'));
    const report = validator.validateMeta(entries);
    expect(report).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    if (!report.ok) expect(report.message).toContain('501');
  });

  it('§6.3 用例三：脚本 513KB → ZIP-UNSAFE-ENTRY（≤512KB 拒；512KB 恰过）', () => {
    expect(
      validator.validateMeta([manifestEntry(), entryOf('scripts/big.py', { size: 513 * 1024 })]),
    ).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    expect(
      validator.validateMeta([manifestEntry(), entryOf('scripts/big.py', { size: 512 * 1024 })]),
    ).toMatchObject({ ok: true });
  });

  it('§6.3 用例四：manifest 非法 JSON → ZIP-INVALID', () => {
    const report = validator.validate([manifestEntry('{kind:node 不是 json')]);
    expect(report).toMatchObject({ ok: false, code: 'ZIP-INVALID' });
  });

  it('单文件解压 >2MB → ZIP-UNSAFE-ENTRY（scripts/ 外资产同样受限）', () => {
    expect(
      validator.validateMeta([manifestEntry(), entryOf('config/huge.yaml', { size: 2 * 1024 * 1024 + 1 })]),
    ).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
  });

  it('总量 >20MB → ZIP-UNSAFE-ENTRY（Σ 解压尺寸——zip 炸弹）', () => {
    const entries = [manifestEntry()];
    for (let i = 0; i < 15; i++) entries.push(entryOf(`nodes/big${i}.json`, { size: 2 * 1024 * 1024 - 1024 })); // 每条 <2MB 但合计 >20MB
    expect(validator.validateMeta(entries)).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
  });

  it('绝对路径条目（POSIX / 与 Windows 盘符）→ ZIP-UNSAFE-ENTRY', () => {
    expect(validator.validateMeta([manifestEntry(), entryOf('/etc/passwd')])).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    expect(validator.validateMeta([manifestEntry(), entryOf('C:\\Windows\\evil.dll')])).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    // 内层 `..` 段同样拒（含反斜杠变体）
    expect(validator.validateMeta([manifestEntry(), entryOf('nodes/../../evil.json')])).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    expect(validator.validateMeta([manifestEntry(), entryOf('nodes\\..\\..\\evil.json')])).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
  });

  it('symlink 条目（Unix S_IFLNK external attrs）→ ZIP-UNSAFE-ENTRY', () => {
    expect(
      validator.validateMeta([manifestEntry(), entryOf('scripts/run.py', { unixPermissions: 0o120777 })]),
    ).toMatchObject({ ok: false, code: 'ZIP-UNSAFE-ENTRY' });
    // 常规权限位不误伤
    expect(
      validator.validateMeta([manifestEntry(), entryOf('scripts/run.py', { unixPermissions: 0o100644 })]),
    ).toMatchObject({ ok: true });
  });

  it('manifest 缺失 / kind 越界 / name·version 缺失 → ZIP-INVALID（X-01 PackageManifest 顶层形）', () => {
    expect(validator.validate([entryOf('nodes/a.json')])).toMatchObject({ ok: false, code: 'ZIP-INVALID' }); // 缺 manifest.json
    expect(validator.validate([manifestEntry(JSON.stringify({ kind: 'virus', name: 'x', version: '1.0.0' }))])).toMatchObject({ ok: false, code: 'ZIP-INVALID' });
    expect(validator.validate([manifestEntry(JSON.stringify({ kind: 'node', version: '1.0.0' }))])).toMatchObject({ ok: false, code: 'ZIP-INVALID' }); // 缺 name
    expect(validator.validate([manifestEntry(JSON.stringify({ kind: 'node', name: 'x' }))])).toMatchObject({ ok: false, code: 'ZIP-INVALID' }); // 缺 version
  });

  it('合法包双面全绿（validateMeta 解压前／validate 全规则——inspect/commit 双跑面）', () => {
    const entries = [
      manifestEntry(JSON.stringify({ kind: 'flow', name: '采集', version: '1.0.0', scripts: { 搜索: { file: 'scripts/s.py', lang: 'python', entry: 'run' } } })),
      entryOf('nodes/搜索.json', { size: 64, data: enc.encode('{}') }),
      entryOf('scripts/s.py', { size: 32, data: enc.encode('def run(ctx): return {}') }),
    ];
    expect(validator.validateMeta(entries)).toMatchObject({ ok: true });
    expect(validator.validate(entries)).toMatchObject({ ok: true });
  });
});
