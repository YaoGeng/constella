// DraftZipBuilder —— workshop store 档组装器套件（T5-03 / TDD-C-07 §3 NodeDevAgent 行的组装半段；
// 03 L1101 v1.0e 对齐注：组装=renderer 手写 store 档组装器，零三方 zip 库依赖——C-08 §2 收窄面
// client/src/main/zip/ 不破；demo buildZip L2502-2517 同构参照）。
//
// 断言面：
//   - store 档结构（S-6 三强制项吸收：①UTC 自洽——DOS 时间取固定 ZIP_EPOCH 语义
//     〔1980-01-01 UTC，对齐 T5-06 export-pipeline ZIP_EPOCH 确定性口径〕②createFolders 语义
//     ——零目录条目、条目名集合与输入严格相等 ③store 档 method=0）；
//   - CRC32 ≡main 侧独立实现重算（crc32 查表法——demo L2502-2510）；
//   - roundtrip 经真读端（main ZipReader=三方 zip 库 loadAsync 唯一读入口——S-6 ③）＋真
//     ZipSecurityValidator：store 组装器产物被正式导入管线接受；
//   - 四件套组装形（T5-06 发布变体自包含形）：manifest{kind:'node',…,scripts 键=type}＋
//     nodes/<safeStem>.json{type,name,definition}＋scripts/＋config/＋deps/。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { crc32 } from '../../main/zip/crc32';
import { createZipReader } from '../../main/zip/zip-reader';
import { readCentralEntries } from '../../main/zip/zip-writer';
import { createZipSecurityValidator, decodeUtf8 } from '../../main/zip/zip-security-validator';
import {
  DRAFT_ZIP_EPOCH,
  assembleNodePackage,
  buildStoreZip,
  type DraftZipFile,
} from './draft-zip-builder';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-draft-zip-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '社媒' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: { lang: 'python', file: 'scripts/x.py', entry: 'run' },
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}

// ————————————————————————————————————————————
// buildStoreZip（低层 store 写档——demo buildZip L2502-2517 同构）
// ————————————————————————————————————————————

describe('draft-zip-builder：buildStoreZip（store 档＋零三方库）', () => {
  const FILES: DraftZipFile[] = [
    { name: 'manifest.json', data: '{"kind":"node","name":"示例","version":"1.0.0"}' },
    { name: 'nodes/小红书搜索.json', data: '{"type":"xhs.search"}' }, // UTF-8 文件名（中文保留）
    { name: 'scripts/xhs_search.py', data: 'PARAMS = {"query": "咖啡"}\n\ndef run(ctx):\n    return {}\n' },
  ];

  it('S-6 ②：条目名集合与输入严格相等（零目录条目）＋store 档 method=0', () => {
    const bytes = buildStoreZip(FILES);
    const entries = readCentralEntries(bytes); // main 侧读档（central 目录遍历）
    expect(entries.map((e) => e.name)).toEqual(FILES.map((f) => f.name));
    expect(entries.every((e) => !e.name.endsWith('/'))).toBe(true); // 无伪目录条目
    expect(entries.every((e) => e.method === 0)).toBe(true); // store 档（02 §2.5 写端 store）
  });

  it('CRC32 ≡main 侧独立实现重算＋尺寸一致（central 记录 vs crc32 查表法）', () => {
    const bytes = buildStoreZip(FILES);
    const enc = new TextEncoder();
    for (const entry of readCentralEntries(bytes)) {
      const file = FILES.find((f) => f.name === entry.name)!;
      const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
      expect(entry.crc).toBe(crc32(data));
      expect(entry.size).toBe(data.byteLength);
      expect(entry.compressedSize).toBe(entry.size); // store：压缩尺寸=原尺寸
    }
  });

  it('S-6 ①：DOS 时间=固定 ZIP_EPOCH 语义（1980-01-01 UTC——确定性产物）', () => {
    expect(DRAFT_ZIP_EPOCH).toEqual({ time: 0, date: 0x0021 }); // (0<<9)|(1<<5)|1
    const bytes = buildStoreZip(FILES);
    for (const e of readCentralEntries(bytes)) {
      expect(e.dosTime).toBe(DRAFT_ZIP_EPOCH.time);
      expect(e.dosDate).toBe(DRAFT_ZIP_EPOCH.date);
    }
  });

  it('确定性：同输入两次组装字节相同（checksum/幂等键消费面）', () => {
    expect(Buffer.compare(Buffer.from(buildStoreZip(FILES)), Buffer.from(buildStoreZip(FILES)))).toBe(0);
  });

  it('UTF-8 文件名标志（general purpose flag 0x0800）＋中文条目经 central 读回保留', () => {
    const bytes = buildStoreZip(FILES);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x04034b50); // 首局部文件头签名
    expect(dv.getUint16(6, true)).toBe(0x0800); // UTF-8 文件名标志（demo buildZip L2522 同位）
    expect(readCentralEntries(bytes).map((e) => e.name)).toContain('nodes/小红书搜索.json');
  });

  it('roundtrip 经真读端（main ZipReader＝三方 zip 库唯一读入口）＋真 ZipSecurityValidator 接受', async () => {
    const bytes = buildStoreZip(FILES);
    const archive = await createZipReader().openBytes(bytes);
    const entriesMap = await archive.readAll();
    expect([...entriesMap.keys()].sort()).toEqual([...FILES.map((f) => f.name)].sort());
    for (const f of FILES) expect(decodeUtf8(entriesMap.get(f.name)!)).toBe(f.data);

    const validator = createZipSecurityValidator();
    const entries = archive.metas().map((m) => ({ ...m, data: entriesMap.get(m.name)! }));
    expect(validator.validateMeta(archive.metas())).toEqual({ ok: true }); // 解压前限值
    expect(validator.validate(entries)).toEqual({ ok: true }); // 全规则（manifest JSON/顶层形）
  });

  it('二进制条目（Uint8Array data）按原字节入包', async () => {
    const payload = new Uint8Array([0, 1, 2, 255]);
    const bytes = buildStoreZip([{ name: 'scripts/bin.dat', data: payload }]);
    const entriesMap = await createZipReader().openBytes(bytes).then((a) => a.readAll());
    expect(entriesMap.get('scripts/bin.dat')).toEqual(payload);
  });
});

// ————————————————————————————————————————————
// assembleNodePackage（四件套组装——T5-06 发布变体自包含形）
// ———————————————————————————————————————————

describe('draft-zip-builder：assembleNodePackage（四件套形——发布变体自包含）', () => {
  const DEF = defOf({
    type: 'xhs.search',
    meta: { name: '小红书搜索', icon: '📕', category: '社媒', description: '关键词搜索笔记' },
    exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
  });

  it('全件：manifest（scripts 键=type）＋nodes/<safeStem(meta.name)>.json 自包含定义＋scripts/＋config/＋deps/', async () => {
    const pkg = assembleNodePackage({
      definition: DEF,
      script: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run', code: 'def run(ctx):\n    return {}\n' },
      config: { file: 'config/xhs_search.yaml', content: 'query: 咖啡\n' },
      deps: { file: 'deps/requirements.txt', content: 'requests>=2.0\n' },
      params: { query: '咖啡' },
    });
    expect(pkg.manifest).toEqual({
      kind: 'node',
      name: '小红书搜索',
      version: '1.0.0',
      scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
    });

    const entriesMap = await createZipReader().openBytes(pkg.bytes).then((a) => a.readAll());
    expect([...entriesMap.keys()].sort()).toEqual(
      ['config/xhs_search.yaml', 'deps/requirements.txt', 'manifest.json', 'nodes/小红书搜索.json', 'scripts/xhs_search.py'].sort(),
    );
    // nodes/*.json＝{type,name,definition}（发布变体自包含形——T5-06 L201 同构）＋实例参数预填层
    const nodeEntry = JSON.parse(decodeUtf8(entriesMap.get('nodes/小红书搜索.json')!)) as Record<string, unknown>;
    expect(nodeEntry.type).toBe('xhs.search');
    expect(nodeEntry.name).toBe('小红书搜索');
    expect(nodeEntry.definition).toEqual(DEF);
    expect(nodeEntry.params).toEqual({ query: '咖啡' });
    // manifest.json 与 summary 同源
    expect(JSON.parse(decodeUtf8(entriesMap.get('manifest.json')!))).toEqual(pkg.manifest);
    // 真导入管线安全校验面（roundtrip 前置——真链集成断言在 node-dev-agent.spec）
    const archive = await createZipReader().openBytes(pkg.bytes);
    expect(createZipSecurityValidator().validate(archive.metas().map((m) => ({ ...m, data: entriesMap.get(m.name)! }))).ok).toBe(true);
  });

  it('空 params 不落键（nodes/*.json 无 params 字段）；deps 缺省随脚本语言（ts→deps/package.json）', async () => {
    const pkg = assembleNodePackage({
      definition: { ...DEF, exec: { lang: 'ts', file: 'scripts/xhs_search.ts', entry: 'run' } },
      script: { file: 'scripts/xhs_search.ts', lang: 'ts', entry: 'run', code: 'export async function run(ctx) { return {}; }\n' },
      deps: { file: 'deps/package.json', content: '{"dependencies":{}}' },
    });
    const entriesMap = await createZipReader().openBytes(pkg.bytes).then((a) => a.readAll());
    const nodeEntry = JSON.parse(decodeUtf8(entriesMap.get('nodes/小红书搜索.json')!)) as Record<string, unknown>;
    expect('params' in nodeEntry).toBe(false);
    expect(pkg.manifest.scripts).toEqual({ 'xhs.search': { file: 'scripts/xhs_search.ts', lang: 'ts', entry: 'run' } });
  });

  it('无脚本节点（弱节点）：manifest 无 scripts 键、包内无 scripts/ 条目（noScript 判定输入）', async () => {
    const weak = { ...DEF, exec: null };
    const pkg = assembleNodePackage({ definition: weak });
    expect(pkg.manifest.scripts).toBeUndefined();
    const entriesMap = await createZipReader().openBytes(pkg.bytes).then((a) => a.readAll());
    expect([...entriesMap.keys()].sort()).toEqual(['manifest.json', 'nodes/小红书搜索.json'].sort());
  });

  it('确定性：同 parts 两次组装字节相同（DOS 时间固定＋文件序稳定）', () => {
    const parts = {
      definition: DEF,
      script: { file: 'scripts/xhs_search.py', lang: 'python' as const, entry: 'run', code: 'def run(ctx):\n    return {}\n' },
    };
    expect(Buffer.compare(Buffer.from(assembleNodePackage(parts).bytes), Buffer.from(assembleNodePackage(parts).bytes))).toBe(0);
  });
});
