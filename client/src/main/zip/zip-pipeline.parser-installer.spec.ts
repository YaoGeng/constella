// PackageParser / AssetInstaller（T5-07 / TDD-C-08 §3 组件行）——`vitest run zip-pipeline`
// 过滤面随行（main 侧 node 直跑）。
//
// 覆盖：§6.5 导入链语义 main 半段——未知 type 兜底 data.transform（demo L2623）/ noScript
// 判定（manifest.scripts＋包内实况——demo L2626-2630 hasFile 同构）/ scripts 映射核对按 type
// 消歧（T5-06 评审转交：导出侧同名不同 custom 型 scriptsMap 覆盖边角）；§6.4 commit 段——
// token=内容 SHA-256 复验拒调包／assetPackages hash 防重（同包二次导入恰一行）／definitions
// 同名同型覆盖（01 A-11.1）；落盘形=node-types/<type>/<ver>/{manifest,nodes,scripts,config,deps}
// （§4 资产目录布局）＋§6.1b 历史包 mtime restoreLocal 差=0。
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir, writeFile as writeFileNode } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { createPackageParser } from './package-parser';
import { createAssetInstaller } from './asset-installer';
import { createZipReader } from './zip-reader';
import { createZipSecurityValidator } from './zip-security-validator';
import { createDosTimeConverter } from './dos-time';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zipparse-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const enc = new TextEncoder();

async function put(rel: string, data: Uint8Array | string): Promise<string> {
  const p = path.join(tmp, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFileNode(p, data);
  return p;
}

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...partial,
  };
}

const XHS_DEF = defOf({
  type: 'xhs.search',
  meta: { name: '小红书搜索', icon: '📕', category: '社媒' },
  exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run', config: 'config/xhs_search.yaml' },
});

/** 已知类型面（生产=BUILTIN_TYPE_IDS ∪ definitions DAO loadAll 投影——注入形同构） */
const knownTypes = new Set<string>([...BUILTIN_TYPE_IDS]);
const hasType = (t: string): boolean => knownTypes.has(t);

function parserLogs(): { parser: ReturnType<typeof createPackageParser>; logs: string[][] } {
  const logs: string[][] = [];
  return { parser: createPackageParser({ hasType, log: (...a) => logs.push(a.map(String)) }), logs };
}

function entriesOf(files: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(files).map(([k, v]) => [k, enc.encode(v)]));
}

const manifest = (m: object): string => JSON.stringify({ version: '1.0.0', ...m });

// ————————————————————————————————————————————
// PackageParser（§6.5 main 半段）
// ————————————————————————————————————————————

describe('PackageParser', () => {
  it('nodes/*.json 解析＋scripts 映射核对：有映射且有文件→scriptRef；manifest 缺映射或包内缺文件→noScript 点名', () => {
    const { parser } = parserLogs();
    const parsed = parser.parse(
      entriesOf({
        'manifest.json': manifest({
          kind: 'flow',
          name: '采集',
          scripts: {
            搜索: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' },
            缺文件节点: { file: 'scripts/ghost.py', lang: 'python', entry: 'run' },
          },
        }),
        'nodes/搜索.json': JSON.stringify({ type: 'xhs.search', name: '搜索', position: { x: 0, y: 0 }, params: { query: '咖啡' }, definition: XHS_DEF }),
        'nodes/缺文件节点.json': JSON.stringify({ type: 'xhs.search', name: '缺文件节点', position: { x: 100, y: 0 }, params: {}, definition: { ...XHS_DEF } }),
        'nodes/无映射节点.json': JSON.stringify({ type: 'xhs.search', name: '无映射节点', position: { x: 200, y: 0 }, params: {}, definition: { ...XHS_DEF } }),
        'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
        'config/xhs_search.yaml': 'limit: 20\n',
      }),
    );
    const byName = new Map(parsed.nodes.map((n) => [n.name, n]));
    expect(byName.get('搜索')!.scriptRef).toEqual({ file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' });
    expect(byName.get('搜索')!.noScript).toBe(false);
    // manifest 有映射但包内缺 scripts 文件（包内实况）→ noScript
    expect(byName.get('缺文件节点')!.noScript).toBe(true);
    // manifest 无映射 → noScript
    expect(byName.get('无映射节点')!.noScript).toBe(true);
    expect(parsed.noScript).toEqual(['无映射节点', '缺文件节点']); // 点名（demo L2637 warn 面）
    expect(parsed.categories).toEqual(['社媒']); // custom 定义 meta.category（perms 推导输入）
    expect(parsed.definitions).toEqual([XHS_DEF]);
  });

  it('scripts 映射核对按 type 消歧（T5-06 评审转交）：同名节点不同 custom 型——映射值 file 与该节点定义 exec.file 不符则不认', () => {
    const { parser } = parserLogs();
    const otherDef = defOf({
      type: 'other.type',
      exec: { lang: 'ts', file: 'scripts/other.ts', entry: 'run' },
    });
    const parsed = parser.parse(
      entriesOf({
        // 导出侧边角：同名「双型」节点，流程变体 scriptsMap 只剩最后写入者（export-pipeline L170）
        'manifest.json': manifest({
          kind: 'flow',
          name: '同名双型',
          scripts: { 双名: { file: 'scripts/other.ts', lang: 'ts', entry: 'run' } },
        }),
        'nodes/双名-a.json': JSON.stringify({ type: 'xhs.search', name: '双名', position: { x: 0, y: 0 }, params: {}, definition: XHS_DEF }),
        'nodes/双名-b.json': JSON.stringify({ type: 'other.type', name: '双名', position: { x: 50, y: 50 }, params: {}, definition: otherDef }),
        'scripts/other.ts': 'export function run(ctx) { return {}; }\n',
      }),
    );
    const xhsNode = parsed.nodes.find((n) => n.type === 'xhs.search')!;
    const otherNode = parsed.nodes.find((n) => n.type === 'other.type')!;
    // 「双名」映射的 file=other.ts 与 xhs.search 定义 exec.file 不符 → xhs 节点不认（noScript）
    expect(xhsNode.noScript).toBe(true);
    expect(otherNode.noScript).toBe(false); // other.type 与映射 file 一致 → 认
    expect(otherNode.scriptRef).toEqual({ file: 'scripts/other.ts', lang: 'ts', entry: 'run' });
  });

  it('发布变体（kind=node/pack）：映射键=类型直映；definition 恒在', () => {
    const { parser } = parserLogs();
    const parsed = parser.parse(
      entriesOf({
        'manifest.json': manifest({ kind: 'node', name: '搜索节点', scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } } }),
        'nodes/小红书搜索.json': JSON.stringify({ type: 'xhs.search', name: '小红书搜索', definition: XHS_DEF }),
        'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
      }),
    );
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]!.scriptRef).toEqual({ file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' });
    expect(parsed.nodes[0]!.noScript).toBe(false);
  });

  it('未知 type 兜底 data.transform（demo L2623）：type 不在已知集且无 definition 随包→替换＋warn 点名；内置/已知型不兜底', () => {
    const { parser, logs } = parserLogs();
    const parsed = parser.parse(
      entriesOf({
        'manifest.json': manifest({ kind: 'flow', name: '混杂' }),
        'nodes/幽灵.json': JSON.stringify({ type: 'ghost.unknown', name: '幽灵', position: { x: 0, y: 0 }, params: { a: 1 } }),
        'nodes/内置.json': JSON.stringify({ type: 'data.transform', name: '内置', position: { x: 0, y: 40 }, params: {} }),
      }),
    );
    const ghost = parsed.nodes.find((n) => n.name === '幽灵')!;
    expect(ghost.type).toBe('data.transform'); // 兜底（demo L2623）
    expect(ghost.params).toEqual({ a: 1 });
    expect(parsed.nodes.find((n) => n.name === '内置')!.type).toBe('data.transform'); // 已知型原样
    expect(logs.some((l) => l.join(' ').includes('ghost.unknown') && l.join(' ').includes('data.transform'))).toBe(true);
    // 随包 definition 的新类型=已知（不兜底——定义将入库）
    const parsed2 = parserLogs().parser.parse(
      entriesOf({
        'manifest.json': manifest({ kind: 'node', name: '新类型' }),
        'nodes/新.json': JSON.stringify({ type: 'brand.new', name: '新', definition: defOf({ type: 'brand.new' }) }),
      }),
    );
    expect(parsed2.nodes[0]!.type).toBe('brand.new');
  });

  it('nodes/*.json 非法 JSON 或缺 type→ZIP-INVALID 点名条目；manifest.scripts 值形不符→ZIP-INVALID', () => {
    const { parser } = parserLogs();
    expect(() =>
      parser.parse(entriesOf({ 'manifest.json': manifest({ kind: 'flow', name: 'x' }), 'nodes/bad.json': '{oops' })),
    ).toThrowError(expect.objectContaining({ code: 'ZIP-INVALID' }));
    expect(() =>
      parser.parse(entriesOf({ 'manifest.json': manifest({ kind: 'flow', name: 'x' }), 'nodes/缺型.json': JSON.stringify({ name: '缺型' }) })),
    ).toThrowError(/缺型/);
    expect(() =>
      parser.parse(
        entriesOf({
          'manifest.json': manifest({ kind: 'flow', name: 'x', scripts: { n: { file: 'scripts/a.py', lang: 'ruby', entry: 'run' } } }),
          'nodes/n.json': JSON.stringify({ type: 'xhs.search', name: 'n', definition: XHS_DEF }),
        }),
      ),
    ).toThrowError(/lang/);
  });

  it('缺 nodes/*.json 条目→ZIP-INVALID（demo L2617「包内没有 nodes/*.json」同构）', () => {
    const { parser } = parserLogs();
    expect(() => parser.parse(entriesOf({ 'manifest.json': manifest({ kind: 'flow', name: '空' }) }))).toThrowError(
      expect.objectContaining({ code: 'ZIP-INVALID' }),
    );
  });
});

// ————————————————————————————————————————————
// AssetInstaller（§6.4 commit 段＋§6.1b 落盘 mtime＋§4 资产目录布局）
// ————————————————————————————————————————————

interface PkgRow {
  nodeType: string;
  pkgVersion: string;
  contentHash: string;
  dir: string;
  manifest: unknown;
}
function makeInstallerDao(): {
  definitions: NodeDefinition[];
  assetPackages: PkgRow[];
  definitionsDao: { upsert(doc: NodeDefinition): void };
  assetPackagesDao: {
    upsert(a: PkgRow): { id: string; reused: boolean };
  };
} {
  const definitions: NodeDefinition[] = [];
  const assetPackages: PkgRow[] = [];
  return {
    definitions,
    assetPackages,
    definitionsDao: {
      upsert(doc) {
        const i = definitions.findIndex((d) => d.type === doc.type);
        if (i >= 0) definitions[i] = doc;
        else definitions.push(doc);
      },
    },
    assetPackagesDao: {
      // 同构 AssetPackagesDao（content_hash 幂等键——命中复用不重复登记）
      upsert(a) {
        const hit = assetPackages.find((p) => p.contentHash === a.contentHash);
        if (hit !== undefined) return { id: `pkg-${assetPackages.indexOf(hit)}`, reused: true };
        assetPackages.push(a);
        return { id: `pkg-${assetPackages.length - 1}`, reused: false };
      },
    },
  };
}

async function buildZip(
  files: Record<string, string>,
  opts: { compression?: 'STORE' | 'DEFLATE'; date?: Date } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) {
    zip.file(name, data, { createFolders: false, ...(opts.date ? { date: opts.date } : {}) });
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: opts.compression ?? 'STORE' }));
}

const PKG_FILES: Record<string, string> = {
  'manifest.json': manifest({ kind: 'node', name: '示例资产', scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } } }),
  'nodes/小红书搜索.json': JSON.stringify({ type: 'xhs.search', name: '小红书搜索', position: { x: 12, y: 34 }, params: { query: '咖啡' }, definition: XHS_DEF }),
  'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
  'config/xhs_search.yaml': 'limit: 20\n',
  'deps/requirements.txt': 'httpx>=0.27\n',
};

function makeInstaller(dao: ReturnType<typeof makeInstallerDao>, nodeTypesRoot = path.join(tmp, 'node-types')) {
  return {
    installer: createAssetInstaller({
      reader: createZipReader(),
      validator: createZipSecurityValidator(),
      parser: createPackageParser({ hasType }),
      nodeTypesRoot,
      definitions: dao.definitionsDao,
      assetPackages: dao.assetPackagesDao,
    }),
    nodeTypesRoot,
  };
}

describe('AssetInstaller（commit 段）', () => {
  it('token=内容 SHA-256 复验：不符拒（ZIP-UNSAFE-ENTRY——防 inspect→commit 间调包）', async () => {
    const dao = makeInstallerDao();
    const { installer } = makeInstaller(dao);
    const zipPath = await put('pkg-a.zip', await buildZip(PKG_FILES));
    const bytes = readFileSync(zipPath);
    const goodToken = createHash('sha256').update(bytes).digest('hex');
    await expect(installer.commit(zipPath, '0'.repeat(64))).rejects.toMatchObject({ code: 'ZIP-UNSAFE-ENTRY' });
    expect(dao.assetPackages).toHaveLength(0);
    expect(dao.definitions).toHaveLength(0); // 零登记
    const res = await installer.commit(zipPath, goodToken); // 正确 token 通过
    expect(res.nodes).toHaveLength(1);
  });

  it('commit→解包落盘 node-types/<type>/<ver>/ 四件套＋definitions.upsert＋assetPackages 登记（dir=落盘目录）', async () => {
    const dao = makeInstallerDao();
    const root = path.join(tmp, 'node-types-install');
    const { installer } = makeInstaller(dao, root);
    const zipPath = await put('pkg-b.zip', await buildZip(PKG_FILES));
    const bytes = readFileSync(zipPath);
    const res = await installer.commit(zipPath, createHash('sha256').update(bytes).digest('hex'));

    // ImportedNode=FlowNode 形（id/type/name/position/params）
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]).toMatchObject({ type: 'xhs.search', name: '小红书搜索', position: { x: 12, y: 34 }, params: { query: '咖啡' } });
    expect(typeof res.nodes[0]!.id).toBe('string');
    expect(res.noScript).toEqual([]);

    // §4 资产目录布局：node-types/xhs.search/1.0.0/{manifest.json,nodes/,scripts/,config/,deps/}
    const dir = path.join(root, 'xhs.search', '1.0.0');
    expect(readdirSync(dir).sort()).toEqual(['config', 'deps', 'manifest.json', 'nodes', 'scripts']);
    expect(readFileSync(path.join(dir, 'scripts', 'xhs_search.py'), 'utf8')).toBe(PKG_FILES['scripts/xhs_search.py']!);
    expect(readFileSync(path.join(dir, 'config', 'xhs_search.yaml'), 'utf8')).toBe('limit: 20\n');

    expect(dao.definitions).toEqual([XHS_DEF]);
    expect(dao.assetPackages).toHaveLength(1);
    expect(dao.assetPackages[0]).toMatchObject({
      nodeType: 'xhs.search',
      pkgVersion: '1.0.0',
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      dir,
    });
  });

  it('同包二次导入：asset_packages 恰一行（hash 防重）；同型新定义包覆盖 definitions（01 A-11.1）', async () => {
    const dao = makeInstallerDao();
    const { installer } = makeInstaller(dao);
    const zipPath = await put('pkg-c.zip', await buildZip(PKG_FILES));
    const bytes = readFileSync(zipPath);
    const token = createHash('sha256').update(bytes).digest('hex');
    await installer.commit(zipPath, token);
    await installer.commit(zipPath, token); // 同包二次导入
    expect(dao.assetPackages).toHaveLength(1); // 恰一行（hash 防重）

    // 同型新定义包（内容变=新 hash=新包行）→ definitions 同名同型覆盖
    const v2Def = { ...XHS_DEF, meta: { ...XHS_DEF.meta, name: '小红书搜索 v2' } };
    const zipPath2 = await put(
      'pkg-c2.zip',
      await buildZip({
        ...PKG_FILES,
        'nodes/小红书搜索.json': JSON.stringify({ type: 'xhs.search', name: '小红书搜索', position: { x: 0, y: 0 }, params: {}, definition: v2Def }),
      }),
    );
    const bytes2 = readFileSync(zipPath2);
    await installer.commit(zipPath2, createHash('sha256').update(bytes2).digest('hex'));
    expect(dao.assetPackages).toHaveLength(2); // 不同内容=新 hash=新行（内容寻址）
    expect(dao.definitions).toHaveLength(1); // 同 type 覆盖
    expect(dao.definitions[0]!.meta.name).toBe('小红书搜索 v2');
  });

  it('§6.1b 历史包口径落盘 mtime=restoreLocal 还原（DosTimeConverter——差=0 断言）', async () => {
    const dao = makeInstallerDao();
    const root = path.join(tmp, 'node-types-mtime');
    const { installer } = makeInstaller(dao, root);
    // demo 历史包写入口径=本地墙钟读数编码 DOS 字段：墙钟 14:30:40 → DOS 编码 14:30:40（UTC 位）
    const wallClock = new Date(2026, 0, 15, 14, 30, 40); // 本地 14:30:40（真实时刻）
    const historicLike = new Date(Date.UTC(2026, 0, 15, 14, 30, 40)); // jszip 按 UTC 编码 14:30:40
    const zipPath = await put('pkg-mtime.zip', await buildZip(PKG_FILES, { date: historicLike }));
    await installer.commit(zipPath, createHash('sha256').update(readFileSync(zipPath)).digest('hex'));
    const script = path.join(root, 'xhs.search', '1.0.0', 'scripts', 'xhs_search.py');
    const mtimeMs = statSync(script).mtimeMs;
    expect(mtimeMs).toBe(createDosTimeConverter().restoreLocal(historicLike.getTime()));
    // 还原后与写包机真实墙钟时刻差=0（DOS 2s 粒度内——14:30:40 秒=偶数故精确相等）
    expect(mtimeMs).toBe(wallClock.getTime());
  });

  it('noScript 节点照常导入（实例 noScript=true；定义原样 upsert——运行闸拦截归 C-03）', async () => {
    const dao = makeInstallerDao();
    const { installer } = makeInstaller(dao);
    const zipPath = await put(
      'pkg-noscript.zip',
      await buildZip({
        'manifest.json': manifest({ kind: 'node', name: '缺脚本包' }), // 无 scripts 映射
        'nodes/小红书搜索.json': JSON.stringify({ type: 'xhs.search', name: '小红书搜索', position: { x: 0, y: 0 }, params: {}, definition: XHS_DEF }),
      }),
    );
    const bytes = readFileSync(zipPath);
    const res = await installer.commit(zipPath, createHash('sha256').update(bytes).digest('hex'));
    expect(res.noScript).toEqual(['小红书搜索']);
    expect(res.nodes[0]!.noScript).toBe(true);
    expect(dao.definitions).toEqual([XHS_DEF]); // 定义 exec 原样（demo 语义：定义保留 bundle）
  });

  it('deflate 重打包（§6.2）：第三方工具 deflate 压缩包导入成功且内容一致', async () => {
    const dao = makeInstallerDao();
    const root = path.join(tmp, 'node-types-deflate');
    const { installer } = makeInstaller(dao, root);
    const bytes = await buildZip(PKG_FILES, { compression: 'DEFLATE' });
    const zipPath = await put('pkg-deflate.zip', bytes);
    const res = await installer.commit(zipPath, createHash('sha256').update(bytes).digest('hex'));
    expect(res.nodes[0]!.params).toEqual({ query: '咖啡' });
    expect(readFileSync(path.join(root, 'xhs.search', '1.0.0', 'scripts', 'xhs_search.py'), 'utf8')).toBe(
      'def run(ctx):\n    return {}\n',
    );
  });

  it('纯内置节点流程包（无 custom 定义）：零落盘零登记，节点照常返回', async () => {
    const dao = makeInstallerDao();
    const root = path.join(tmp, 'node-types-builtin');
    const { installer } = makeInstaller(dao, root);
    const zipPath = await put(
      'pkg-builtin.zip',
      await buildZip({
        'manifest.json': manifest({ kind: 'flow', name: '纯内置' }),
        'nodes/变换.json': JSON.stringify({ type: 'data.transform', name: '变换', position: { x: 0, y: 0 }, params: { expr: 'x' } }),
      }),
    );
    const res = await installer.commit(zipPath, createHash('sha256').update(readFileSync(zipPath)).digest('hex'));
    expect(res.nodes[0]!.type).toBe('data.transform');
    expect(dao.assetPackages).toHaveLength(0); // 无类型可挂 FK——不登记（02 §7.1 node_type FK）
    expect(dao.definitions).toHaveLength(0);
    expect(() => readdirSync(root)).toThrow(); // 零落盘
  });
});
