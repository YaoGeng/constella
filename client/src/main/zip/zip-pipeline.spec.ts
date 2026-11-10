// TDD-C-08 §6 验收宿主（T5-06 导出半段；main 侧 node 直跑——`vitest run zip-pipeline` 过滤面）。
//
// 覆盖：§6.1a jszip 写→读字节级 roundtrip（store 档）／§6.1c central 目录零 `nodes/` 伪目录
// 条目（S-6 ②：createFolders:false 必须设在 file() 选项）；S-6 ① 写端 DOS 时间 UTC 自洽
// （DosTimeConverter 写侧）＋读侧 restoreLocal 换算口径；CRC32 自校验器（demo L2502-2510 移植，
// 02 §2.5「保留在 ZipPipeline 内作导出产物自校验」）；§6.6 secret 剥离（X-20：包内引用键
// grep 0 命中）；§6.8 P-3 收窄（jszip import 唯一面=client/src/main/zip/）＋版本锁 3.10.2。
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 as zlibCrc32 } from 'node:zlib';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import type { FlowDoc } from '@constella/shared/ipc';
import type { NodeDefinition as NodeDefinitionDsl } from '@constella/shared/dsl';
import { crc32 } from './crc32';
import { createDosTimeConverter } from './dos-time';
import { createZipExportPipeline, ZIP_EPOCH } from './export-pipeline';
import { createZipWriter, verifyZipSelfCheck, type ZipFileInput } from './zip-writer';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zip-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function put(rel: string, content: string): Promise<string> {
  const p = path.join(tmp, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, 'utf8');
  return p;
}

const enc = new TextEncoder();

// ————————————————————————————————————————————
// CRC32 自校验器（demo L2502-2510 移植）
// ————————————————————————————————————————————

describe('crc32（demo L2502-2510 移植）', () => {
  it('标准向量：空串=0／fox 句=0x414FA339', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('与 node:zlib.crc32 逐字节一致（全字节值 256B＋随机文本）', () => {
    const seq = new Uint8Array(256);
    for (let i = 0; i < 256; i++) seq[i] = i;
    expect(crc32(seq)).toBe(zlibCrc32(seq));
    const text = enc.encode('星丛导出包自校验——中文/emoji 🌟 与 \\slash "quote" 混排');
    expect(crc32(text)).toBe(zlibCrc32(text));
  });
});

// ————————————————————————————————————————————
// DosTimeConverter（S-6 ①：写端 UTC 自洽免换算；读侧换算归导入半段 T5-07 消费）
// ————————————————————————————————————————————

describe('DosTimeConverter（S-6 ①）', () => {
  const conv = createDosTimeConverter();

  it('写侧 dosFields=UTC 口径（jszip getUTC* 同构——写读自洽免换算）', () => {
    // demo 历史包写入口径对照：本地墙钟 14:30:40 → time=0x73D4（spike 3a 复现值）
    const d = new Date(Date.UTC(2026, 10, 8, 14, 30, 40));
    expect(conv.dosFields(d)).toEqual({ time: (14 << 11) | (30 << 5) | (40 >> 1), date: ((2026 - 1980) << 9) | (11 << 5) | 8 });
  });

  it('读侧 restoreLocal：UTC 墙钟读值减本机偏移还原真实时刻（demo 历史包）', () => {
    // demo 写本地 14:30:40 → jszip 读出 Date=UTC 14:30（墙钟错读）；还原=该读值减本机 UTC 偏移
    const utcMs = Date.UTC(2026, 0, 15, 14, 30, 40);
    expect(conv.restoreLocal(utcMs)).toBe(new Date(2026, 0, 15, 14, 30, 40).getTime());
  });
});

// ————————————————————————————————————————————
// ZipWriter（S-6 ②③＋§6.1a/c；store 档＋CRC32 自校验）
// ————————————————————————————————————————————

describe('ZipWriter（§6.1a/c＋S-6 ②）', () => {
  const writer = createZipWriter();
  const fixedDate = new Date(Date.UTC(2026, 10, 8, 14, 30, 40));

  const sampleFiles: readonly ZipFileInput[] = [
    { name: 'manifest.json', data: '{"kind":"flow","name":"采集"}' },
    { name: 'nodes/小红书搜索.json', data: JSON.stringify({ type: 'xhs.search', params: { query: '咖啡' } }) },
    { name: 'scripts/🌟 emoji.py', data: '# -*- coding: utf-8 -*-\ndef run(ctx): return {}\n' },
    { name: 'binary.bin', data: new Uint8Array(4096).map((_, i) => i & 0xff) },
  ];

  it('写→读字节级 roundtrip（store 档；UTF-8 文件名/中文内容/二进制）', async () => {
    const savePath = path.join(tmp, 'roundtrip.zip');
    const { bytes } = await writer.write(sampleFiles, savePath, { date: fixedDate });
    // 写盘字节＝返回字节；jszip 读回逐条内容字节级一致（§6.1a）
    expect((await readFile(savePath)).equals(bytes)).toBe(true);
    const zip = await JSZip.loadAsync(bytes);
    for (const f of sampleFiles) {
      const got = await zip.file(f.name)?.async('uint8array');
      expect(got).toBeDefined();
      const want = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      expect(Buffer.from(got!).equals(Buffer.from(want))).toBe(true);
    }
  });

  it('central 目录零伪目录条目——条目名集合与输入严格相等（S-6 ②：createFolders:false 在 file() 选项）', async () => {
    const { bytes } = await writer.write(sampleFiles, path.join(tmp, 'nofolders.zip'), { date: fixedDate });
    const entries = await verifyZipSelfCheck(bytes, sampleFiles); // 内部断言条目数与名字一一对应
    expect(entries.map((e) => e.name).sort()).toEqual(sampleFiles.map((f) => f.name).sort());
    expect(entries.every((e) => e.method === 0)).toBe(true); // store 档（§2.5 写端 store）
    expect(entries.some((e) => e.name.endsWith('/'))).toBe(false); // 零目录条目（对照 S-6 实测多 8 条反例）
  });

  it('CRC32 自校验：central 记录≡独立实现重算；期望不符即抛（02 §2.5 导出产物自校验）', async () => {
    const { bytes } = await writer.write(sampleFiles, path.join(tmp, 'crc.zip'), { date: fixedDate });
    const entries = await verifyZipSelfCheck(bytes, sampleFiles);
    for (const e of entries) {
      const src = sampleFiles.find((f) => f.name === e.name)!;
      const want = typeof src.data === 'string' ? enc.encode(src.data) : src.data;
      expect(e.crc).toBe(crc32(want));
    }
    // 篡改期望（模拟产物损坏/错包）→ 自校验抛错
    const wrong: readonly ZipFileInput[] = sampleFiles.map((f) =>
      f.name === 'manifest.json' ? { name: f.name, data: '{"kind":"pack"}' } : f,
    );
    await expect(verifyZipSelfCheck(bytes, wrong)).rejects.toThrow(/CRC32/);
  });

  it('写端 DOS 时间=UTC 自洽（central 字段≡DosTimeConverter.dosFields，S-6 ①）', async () => {
    const { bytes } = await writer.write(sampleFiles, path.join(tmp, 'dostime.zip'), { date: fixedDate });
    const entries = await verifyZipSelfCheck(bytes, sampleFiles);
    const want = createDosTimeConverter().dosFields(fixedDate);
    expect(entries.every((e) => e.dosTime === want.time && e.dosDate === want.date)).toBe(true);
  });

  it('同输入同日期→包字节确定（SHA-256 幂等键前提）', async () => {
    const a = await writer.write(sampleFiles, path.join(tmp, 'det-a.zip'), { date: ZIP_EPOCH });
    const b = await writer.write(sampleFiles, path.join(tmp, 'det-b.zip'), { date: ZIP_EPOCH });
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });
});

// ————————————————————————————————————————————
// zip:export 管线——流程变体（§1 通道表＋§4 四件套/X-01 manifest 源型）
// ————————————————————————————————————————————

function defOf(partial: Partial<NodeDefinitionDsl> & Pick<NodeDefinitionDsl, 'type'>): NodeDefinitionDsl {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '自定义' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}

const DEFS: NodeDefinitionDsl[] = [
  defOf({
    type: 'data.transform',
    kind: 'builtin',
    meta: { name: '数据变换', icon: '🔧', category: '数据' },
    exec: null,
  }),
  defOf({
    type: 'xhs.search',
    meta: { name: '小红书搜索', icon: '📕', category: '社媒' },
    paramsSchema: [
      { k: 'apiKey', t: 'secret', storage: 'safeStorage' },
      { k: 'query', t: 'text' },
    ],
    exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run', config: 'config/xhs_search.yaml' },
  }),
  defOf({
    type: 'ai.summarize',
    meta: { name: 'AI 摘要', icon: '🤖', category: 'AI' },
    paramsSchema: [{ k: 'modelKey', t: 'secret' }],
    exec: { lang: 'ts', file: 'scripts/summarize.ts', entry: 'run' },
  }),
];

const FLOW: FlowDoc = {
  id: 'f1',
  name: '小红书采集',
  edges: [],
  nodes: [
    {
      id: 'n1',
      type: 'xhs.search',
      name: '小红书搜索',
      position: { x: 0, y: 0 },
      params: { apiKey: 'secret.param.node-n1.apiKey', query: '咖啡' },
    },
    {
      id: 'n2',
      type: 'xhs.search',
      name: '小红书搜索',
      position: { x: 200, y: 0 },
      params: { apiKey: 'secret.param.node-n2.apiKey', query: '奶茶' },
    },
    {
      id: 'n3',
      type: 'data.transform',
      name: '数据变换',
      position: { x: 400, y: 0 },
      params: { expr: 'x.trim()' },
      noScript: true,
    },
    {
      id: 'n4',
      type: 'ai.summarize',
      name: 'AI 摘要',
      position: { x: 600, y: 0 },
      params: { modelKey: 'secret.param.node-n4.modelKey' },
    },
  ],
};

async function makePipeline(): Promise<ReturnType<typeof createZipExportPipeline>> {
  await put(path.join('node-types', 'xhs.search', '1.0.0', 'scripts', 'xhs_search.py'), 'def run(ctx):\n    return {}\n');
  await put(path.join('node-types', 'xhs.search', '1.0.0', 'config', 'xhs_search.yaml'), 'limit: 20\n');
  await put(path.join('node-types', 'ai.summarize', '1.0.0', 'scripts', 'summarize.ts'), 'export function run(ctx) { return {}; }\n');
  const defs = new Map(DEFS.map((d) => [d.type, d]));
  const flows = new Map<string, FlowDoc>([['f1', FLOW]]);
  return createZipExportPipeline({
    getFlow: (id) => flows.get(id),
    getDefinition: (type) => defs.get(type),
    nodeTypesRoot: path.join(tmp, 'node-types'),
  });
}

async function readZipEntries(zipPath: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const out = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    out.set(name, await entry.async('string'));
  }
  return out;
}

describe('zip:export 管线——流程变体', () => {
  it('四件套成型＋res={file,count,scripts}；deps 按语言（demo L2591-2592）', async () => {
    const pipeline = await makePipeline();
    const savePath = path.join(tmp, 'flow.zip');
    const res = await pipeline({ flowId: 'f1', savePath });
    expect(res).toEqual({
      file: savePath,
      count: 4,
      scripts: [
        { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' },
        { file: 'scripts/summarize.ts', lang: 'ts', entry: 'run' },
      ],
    });
    const entries = await readZipEntries(savePath);
    // manifest＋nodes×4（同名去重）＋scripts×2（同型去重）＋config＋deps 按语言
    expect([...entries.keys()].sort()).toEqual(
      [
        'manifest.json',
        'nodes/小红书搜索.json',
        'nodes/小红书搜索-2.json',
        'nodes/数据变换.json',
        'nodes/AI 摘要.json',
        'scripts/xhs_search.py',
        'scripts/summarize.ts',
        'config/xhs_search.yaml',
        'deps/requirements.txt',
        'deps/package.json',
      ].sort(),
    );
    // manifest=X-01 PackageManifest 源型（kind/name/version/scripts 映射）
    const manifest = JSON.parse(entries.get('manifest.json')!) as {
      kind: string;
      name: string;
      version: string;
      scripts: Record<string, { file: string; lang: string; entry: string }>;
    };
    expect(manifest.kind).toBe('flow');
    expect(manifest.name).toBe('小红书采集');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.scripts).toEqual({
      小红书搜索: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' },
      'AI 摘要': { file: 'scripts/summarize.ts', lang: 'ts', entry: 'run' },
    });
    // 资产内容与自注册资产目录同源（02 §8.4）
    expect(entries.get('scripts/xhs_search.py')).toContain('def run(ctx)');
    expect(entries.get('config/xhs_search.yaml')).toBe('limit: 20\n');
    expect(entries.get('deps/requirements.txt')).toBe('# 自研节点脚本依赖 [AI 生成]\nhttpx>=0.27\npyyaml>=6.0\n');
    expect(JSON.parse(entries.get('deps/package.json')!).dependencies['@constella/sdk']).toBe('^1.0.0');
  });

  it('X-20：secret 型参数值整键剥离——包内 grep 引用键 0 命中；schema 声明随定义保留（§6.6）', async () => {
    const pipeline = await makePipeline();
    const savePath = path.join(tmp, 'secret.zip');
    await pipeline({ flowId: 'f1', savePath });
    const entries = await readZipEntries(savePath);
    const allBytes = [...entries.entries()].map(([name, body]) => name + body).join('\n');
    expect(allBytes.includes('secret.param')).toBe(false); // 引用键 0 命中（含明文掩码面全零）
    expect(allBytes.includes('sk-')).toBe(false);
    const n1 = JSON.parse(entries.get('nodes/小红书搜索.json')!) as {
      params: Record<string, unknown>;
      definition?: { paramsSchema: { k: string; t: string }[] };
    };
    expect(n1.params).toEqual({ query: '咖啡' }); // secret 键整键剔除
    // 「仅保 schema 声明」：自定义定义随包、paramsSchema 中 secret 字段声明仍在
    expect(n1.definition?.paramsSchema).toEqual([
      { k: 'apiKey', t: 'secret', storage: 'safeStorage' },
      { k: 'query', t: 'text' },
    ]);
  });

  it('nodes/*.json 剥离 id·noScript（demo L2580）；内置类型定义不随包、自定义随包', async () => {
    const pipeline = await makePipeline();
    const savePath = path.join(tmp, 'strip.zip');
    await pipeline({ flowId: 'f1', savePath });
    const entries = await readZipEntries(savePath);
    const builtin = JSON.parse(entries.get('nodes/数据变换.json')!) as Record<string, unknown>;
    expect('id' in builtin).toBe(false);
    expect('noScript' in builtin).toBe(false);
    expect('definition' in builtin).toBe(false); // 内置 12 平台自带定义
    expect(builtin.params).toEqual({ expr: 'x.trim()' });
    const custom = JSON.parse(entries.get('nodes/AI 摘要.json')!) as Record<string, unknown>;
    expect(custom.type).toBe('ai.summarize');
    expect('definition' in custom).toBe(true);
  });

  it('缺流程→ZIP-FLOW-NOT-FOUND；空流程→ZIP-WRITE-FAILED（主侧兜底——renderer 首道拒绝 demo L2575）', async () => {
    const pipeline = await makePipeline();
    await expect(pipeline({ flowId: 'nope', savePath: path.join(tmp, 'x.zip') })).rejects.toMatchObject({
      code: 'ZIP-FLOW-NOT-FOUND',
    });
    const empty = createZipExportPipeline({
      getFlow: () => ({ id: 'e', name: '空', nodes: [], edges: [] }),
      getDefinition: () => undefined,
      nodeTypesRoot: path.join(tmp, 'node-types'),
    });
    await expect(empty({ flowId: 'e', savePath: path.join(tmp, 'x.zip') })).rejects.toMatchObject({
      code: 'ZIP-WRITE-FAILED',
    });
  });

  it('脚本资产缺失→ZIP-WRITE-FAILED 点名缺失文件（资产完整性大声失败）', async () => {
    const defs = new Map(DEFS.map((d) => [d.type, d]));
    const pipeline = createZipExportPipeline({
      getFlow: () => FLOW,
      getDefinition: (t) => defs.get(t),
      nodeTypesRoot: path.join(tmp, 'node-types-EMPTY'), // 资产根为空目录
    });
    await expect(pipeline({ flowId: 'f1', savePath: path.join(tmp, 'x.zip') })).rejects.toMatchObject({
      code: 'ZIP-WRITE-FAILED',
      message: expect.stringContaining('scripts/xhs_search.py'),
    });
  });
});

// ————————————————————————————————————————————
// zip:export 管线——发布打包变体（02 v1.0b §3.4：{types[],savePath,meta}→{filePath,checksum}）
// ————————————————————————————————————————————

describe('zip:export 管线——发布打包变体（C-09 Publisher 消费）', () => {
  it('勾选类型集→四件套＋SHA-256 checksum=产物字节哈希；kind=pack', async () => {
    const pipeline = await makePipeline();
    const savePath = path.join(tmp, 'pkg.zip');
    const res = await pipeline({ types: ['xhs.search', 'ai.summarize'], savePath, meta: { name: '社媒工具包' } });
    const bytes = await readFile(savePath);
    expect(res).toEqual({ filePath: savePath, checksum: createHash('sha256').update(bytes).digest('hex') });
    const entries = await readZipEntries(savePath);
    const manifest = JSON.parse(entries.get('manifest.json')!) as { kind: string; name: string };
    expect(manifest.kind).toBe('pack');
    expect(manifest.name).toBe('社媒工具包');
    // 发布物自包含：每类型一 nodes/*.json（含定义）＋脚本资产＋deps 双语言
    expect(entries.has('nodes/小红书搜索.json')).toBe(true);
    expect(entries.has('nodes/AI 摘要.json')).toBe(true);
    expect(entries.has('scripts/xhs_search.py')).toBe(true);
    expect(entries.has('deps/requirements.txt')).toBe(true);
    expect(entries.has('deps/package.json')).toBe(true);
    // 发布物同受 X-20 约束：schema 声明在、secret 值零命中
    expect([...entries.values()].join('\n').includes('secret.param')).toBe(false);
  });

  it('单类型→kind=node；checksum 幂等（同输入两次导出同哈希——幂等键）', async () => {
    const pipeline = await makePipeline();
    const resOf = async (savePath: string): Promise<string> => {
      const res = await pipeline({ types: ['xhs.search'], savePath, meta: { name: '搜索' } });
      if (!('checksum' in res)) throw new Error('打包变体应回 checksum');
      return res.checksum;
    };
    expect(await resOf(path.join(tmp, 'p1.zip'))).toBe(await resOf(path.join(tmp, 'p2.zip')));
    const entries = await readZipEntries(path.join(tmp, 'p1.zip'));
    expect(JSON.parse(entries.get('manifest.json')!).kind).toBe('node');
  });

  it('未知类型→ZIP-WRITE-FAILED 点名', async () => {
    const pipeline = await makePipeline();
    await expect(
      pipeline({ types: ['ghost.type'], savePath: path.join(tmp, 'g.zip'), meta: { name: '幽灵包' } }),
    ).rejects.toMatchObject({ code: 'ZIP-WRITE-FAILED', message: expect.stringContaining('ghost.type') });
  });
});

// ————————————————————————————————————————————
// §6.8 P-3 收窄＋版本锁（S-6 冻结 3.10.2）
// ————————————————————————————————————————————

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = path.join(dir, ent);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(ent)) out.push(p);
  }
  return out;
}

describe('§6.8 P-3 收窄＋版本锁', () => {
  const clientRoot = path.resolve(__dirname, '..', '..', '..'); // client/src/main/zip → client
  const srcRoot = path.join(clientRoot, 'src');

  it('jszip import 唯一面=client/src/main/zip/（grep -rln "jszip" client/src 收窄）', () => {
    const offenders = listFiles(srcRoot).filter((f) => readFileSync(f, 'utf8').includes('jszip'));
    const zipDir = path.join(srcRoot, 'main', 'zip');
    expect(offenders.every((f) => f.startsWith(zipDir + path.sep) || f === zipDir)).toBe(true);
  });

  it('client/package.json jszip=3.10.2 精确版（S-6 冻结）', () => {
    const pkg = JSON.parse(readFileSync(path.join(clientRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies.jszip).toBe('3.10.2');
  });
});
