// zip:import 两段式管线集成（T5-07 / TDD-C-08 §1 通道表 zip:import 行＋§6.4 验收）——
// `vitest run zip-pipeline` 过滤面随行（main 侧 node 直跑；真 StorageLayer/DAO——FK/幂等真语义）。
//
// 覆盖 §6.4：inspect 后取消 → definitions/asset_packages/落盘三路零写入（12.2#2——第四路
// library/画布归 renderer 编排面，见 zip-pipeline.import-orchestrator.spec）；commit token 与
// 文件 hash 不符 → 拒绝；同包二次导入 → asset_packages 恰一行（hash 防重）＋definitions 同名
// 同型覆盖（01 A-11.1）。另覆盖 inspect 响应形（X-01 ZipImportInspectRes：summary+token，
// token=内容 SHA-256）与 ZipError 序列化面（code/message）。
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { StorageLayer } from '../storage/storage-layer';
import { createAssetInstaller } from './asset-installer';
import { createPackageParser } from './package-parser';
import { createZipImportPipeline } from './import-pipeline';
import { createZipReader } from './zip-reader';
import { createZipSecurityValidator } from './zip-security-validator';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zipimport-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));


interface Ctx {
  pipeline: ReturnType<typeof createZipImportPipeline>;
  layer: StorageLayer;
  dispose(): Promise<void>;
}

function defOf(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type'>): NodeDefinition {
  return {
    kind: 'custom',
    meta: { name: partial.type, icon: '✨', category: '社媒' },
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
  exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
});

async function openCtx(rel: string): Promise<Ctx> {
  const dir = path.join(tmp, rel);
  await mkdir(dir, { recursive: true });
  const layer = new StorageLayer(SQLITE_ENGINE);
  layer.open(dir);
  const nodeTypesRoot = path.join(dir, 'node-types');
  const defsByType = new Map(layer.dao.definitions.loadAll().map((d) => [d.type, d]));
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || defsByType.has(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);
  const pipeline = createZipImportPipeline({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    installer: createAssetInstaller({
      reader: createZipReader(),
      validator: createZipSecurityValidator(),
      parser: createPackageParser({ hasType }),
      nodeTypesRoot,
      definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
      assetPackages: {
        upsert: (args) => layer.dao.assetPackages.upsert(args),
      },
    }),
  });
  return {
    pipeline,
    layer,
    dispose: async () => {
      layer.close();
    },
  };
}

async function buildZip(files: Record<string, string>, compression: 'STORE' | 'DEFLATE' = 'STORE'): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { createFolders: false });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression }));
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const PKG_FILES: Record<string, string> = {
  'manifest.json': JSON.stringify({
    kind: 'node',
    name: '示例资产',
    version: '1.0.0',
    scripts: { 'xhs.search': { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
  }),
  'nodes/小红书搜索.json': JSON.stringify({
    type: 'xhs.search',
    name: '小红书搜索',
    position: { x: 12, y: 34 },
    params: { query: '咖啡' },
    definition: XHS_DEF,
  }),
  'scripts/xhs_search.py': 'def run(ctx):\n    return {}\n',
};

async function put(rel: string, bytes: Uint8Array): Promise<string> {
  const p = path.join(tmp, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes);
  return p;
}

describe('zip:import 两段式管线（§1 通道行＋§6.4）', () => {
  it('inspect：summary＋token（=内容 SHA-256）——不落盘不入库（12.2#2 三路零写入）', async () => {
    const ctx = await openCtx('inspect-cancel');
    try {
      const zipPath = await put('inspect-cancel/pkg.zip', await buildZip(PKG_FILES));
      const bytes = readFileSync(zipPath);
      const res = await ctx.pipeline({ path: zipPath, phase: 'inspect' });
      if (!('token' in res)) throw new Error('inspect 应回 {nodes,noScript,categories,manifest,token}');
      // X-01 ZipImportInspectRes 冻结形
      expect(res.nodes).toHaveLength(1);
      expect((res.nodes[0] as { type: string }).type).toBe('xhs.search');
      expect(res.noScript).toEqual([]);
      expect(res.categories).toEqual(['社媒']); // perms 推导输入（renderer derivePerms 同源消费）
      expect(res.manifest).toMatchObject({ kind: 'node', name: '示例资产', version: '1.0.0' });
      expect(res.token).toBe(sha256(bytes)); // token=内容 SHA-256（commit 复验防调包）
      // 三路零写入（第四路 library/画布=renderer 编排面）
      expect(ctx.layer.dao.definitions.loadAll()).toHaveLength(12); // 仅内置种子
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(0);
      expect(() => readdirSync(path.join(tmp, 'inspect-cancel', 'node-types'))).toThrow(); // 零落盘
    } finally {
      await ctx.dispose();
    }
  });

  it('commit：token 复验→落盘＋definitions/assetPackages 入库（X-01 ZipImportCommitRes 形）', async () => {
    const ctx = await openCtx('commit-ok');
    try {
      const zipPath = await put('commit-ok/pkg.zip', await buildZip(PKG_FILES));
      const bytes = readFileSync(zipPath);
      const token = sha256(bytes);
      const res = await ctx.pipeline({ path: zipPath, phase: 'commit', token });
      if (!('nodes' in res) || !Array.isArray(res.nodes)) throw new Error('commit 应回 {nodes,noScript}');
      expect(res.nodes[0]).toMatchObject({ type: 'xhs.search', name: '小红书搜索', params: { query: '咖啡' } });
      expect(ctx.layer.dao.definitions.loadAll().find((d) => d.type === 'xhs.search')).toBeDefined();
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(1);
    } finally {
      await ctx.dispose();
    }
  });

  it('commit token 与文件 hash 不符（inspect→commit 间调包）→ ZIP-UNSAFE-ENTRY 拒＋零写入', async () => {
    const ctx = await openCtx('commit-tampered');
    try {
      const zipPath = await put('commit-tampered/pkg.zip', await buildZip(PKG_FILES));
      const inspectRes = await ctx.pipeline({ path: zipPath, phase: 'inspect' });
      if (!('token' in inspectRes)) throw new Error('inspect 形不符');
      // 调包：同路径重写不同内容
      await writeFile(zipPath, await buildZip({ ...PKG_FILES, 'scripts/xhs_search.py': 'def run(ctx):\n    return {"evil": True}\n' }));
      await expect(ctx.pipeline({ path: zipPath, phase: 'commit', token: inspectRes.token })).rejects.toMatchObject({
        code: 'ZIP-UNSAFE-ENTRY',
        name: 'ZipError',
      });
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(0);
      expect(ctx.layer.dao.definitions.loadAll().find((d) => d.type === 'xhs.search')).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });

  it('同包二次导入 → asset_packages 恰一行（hash 防重）＋definitions 同名同型覆盖', async () => {
    const ctx = await openCtx('twice');
    try {
      const zipPath = await put('twice/pkg.zip', await buildZip(PKG_FILES));
      const token = sha256(readFileSync(zipPath));
      await ctx.pipeline({ path: zipPath, phase: 'commit', token });
      await ctx.pipeline({ path: zipPath, phase: 'commit', token }); // 二次导入
      const rows = ctx.layer.dao.assetPackages.listByType('xhs.search');
      expect(rows).toHaveLength(1); // 恰一行
      expect(ctx.layer.dao.definitions.loadAll().filter((d) => d.type === 'xhs.search')).toHaveLength(1); // 同名同型（覆盖非新增）
      // 同型新定义（内容变）→ definitions 覆盖、asset_packages 新行（内容寻址）
      const v2 = await put(
        'twice/pkg-v2.zip',
        await buildZip({
          ...PKG_FILES,
          'nodes/小红书搜索.json': JSON.stringify({
            type: 'xhs.search',
            name: '小红书搜索',
            position: { x: 0, y: 0 },
            params: {},
            definition: { ...XHS_DEF, meta: { ...XHS_DEF.meta, name: '小红书搜索 v2' } },
          }),
        }),
      );
      await ctx.pipeline({ path: v2, phase: 'commit', token: sha256(readFileSync(v2)) });
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(2);
      expect(ctx.layer.dao.definitions.loadAll().find((d) => d.type === 'xhs.search')!.meta.name).toBe('小红书搜索 v2');
    } finally {
      await ctx.dispose();
    }
  });

  it('安全违例包（路径穿越/非法 manifest）在 inspect 段即拒——ZIP-UNSAFE-ENTRY/ZIP-INVALID', async () => {
    const ctx = await openCtx('unsafe');
    try {
      const evil = await put(
        'unsafe/evil.zip',
        await buildZip({ ...PKG_FILES, '../evil.json': 'x' } as Record<string, string>),
      );
      await expect(ctx.pipeline({ path: evil, phase: 'inspect' })).rejects.toMatchObject({ code: 'ZIP-UNSAFE-ENTRY' });

      const badManifest = await put(
        'unsafe/bad.zip',
        await buildZip({ ...PKG_FILES, 'manifest.json': '{kind: 不是json' }),
      );
      await expect(ctx.pipeline({ path: badManifest, phase: 'inspect' })).rejects.toMatchObject({ code: 'ZIP-INVALID' });
      // commit 段同样双跑校验（同 zip 不同 token 入口面）
      await expect(ctx.pipeline({ path: badManifest, phase: 'commit', token: sha256(readFileSync(badManifest)) })).rejects.toMatchObject({
        code: 'ZIP-INVALID',
      });
    } finally {
      await ctx.dispose();
    }
  });

  it('deflate 重打包（§6.2 集成面）：inspect/commit 全链内容一致', async () => {
    const ctx = await openCtx('deflate');
    try {
      const bytes = await buildZip(
        {
          ...PKG_FILES,
          'scripts/xhs_search.py': '# padding line for deflate\n'.repeat(128) + 'def run(ctx):\n    return {}\n',
        },
        'DEFLATE',
      );
      const zipPath = await put('deflate/pkg.zip', bytes);
      const res = await ctx.pipeline({ path: zipPath, phase: 'inspect' });
      if (!('token' in res)) throw new Error('inspect 形不符');
      expect(res.token).toBe(sha256(bytes));
      const commitRes = await ctx.pipeline({ path: zipPath, phase: 'commit', token: res.token });
      expect((commitRes.nodes[0] as { params: Record<string, unknown> }).params).toEqual({ query: '咖啡' });
      const installed = readFileSync(
        path.join(tmp, 'deflate', 'node-types', 'xhs.search', '1.0.0', 'scripts', 'xhs_search.py'),
        'utf8',
      );
      expect(installed.endsWith('def run(ctx):\n    return {}\n')).toBe(true);
      expect(installed.startsWith('# padding line for deflate\n')).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  it('管线未读文件（路径不存在）→ 大声失败（非 ZipError 业务面——fs 错透传）', async () => {
    const ctx = await openCtx('missing');
    try {
      await expect(ctx.pipeline({ path: path.join(tmp, 'missing', 'ghost.zip'), phase: 'inspect' })).rejects.toThrow(
        /ENOENT|ghost\.zip/,
      );
    } finally {
      await ctx.dispose();
    }
  });
});

// 静态使用（TextEncoder 保编码一致性面）
