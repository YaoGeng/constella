// zip:import bytes 双变体（T5-10 / 前置授权 2——02 v1.0e 勘误〔2026-11-10 PM 裁决〕：
// inspect/commit 增 `{bytes}` 变体，market download 字节直入导入链不落临时文件；通道名/数不变）。
//
// 覆盖：真 StorageLayer/DAO/SecurityValidator/AssetInstaller 管线——bytes inspect（summary+token=
// bytes 内容 SHA-256）→bytes commit（token 复验→落盘＋双 upsert）→bytes 调包拒绝（ZIP-UNSAFE-ENTRY）；
// payload 校验面（T4-14 双变体收窄——validateInvokePayload 直调）。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { IPC_INVOKE_CHANNELS } from '@constella/shared/ipc';
import { validateInvokePayload } from '../ipc/payload-schemas';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { StorageLayer } from '../storage/storage-layer';
import { createAssetInstaller } from './asset-installer';
import { createPackageParser } from './package-parser';
import { createZipImportPipeline } from './import-pipeline';
import { createZipReader } from './zip-reader';
import { createZipSecurityValidator } from './zip-security-validator';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-zipbytes-'));
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
const XHS_DEF = defOf({
  type: 'xhs.search',
  meta: { name: '小红书搜索', icon: '📕', category: '社媒' },
  exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run' },
});

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

async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { createFolders: false });
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function openCtx(rel: string) {
  const dir = path.join(tmp, rel);
  await mkdir(dir, { recursive: true });
  const layer = new StorageLayer(SQLITE_ENGINE);
  layer.open(dir);
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);
  const mkInstaller = () =>
    createAssetInstaller({
      reader: createZipReader(),
      validator: createZipSecurityValidator(),
      parser: createPackageParser({ hasType }),
      nodeTypesRoot: path.join(dir, 'node-types'),
      definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
      assetPackages: { upsert: (args) => layer.dao.assetPackages.upsert(args) },
    });
  const pipeline = createZipImportPipeline({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    installer: mkInstaller(),
  });
  return { pipeline, layer, dir, dispose: async () => layer.close() };
}

describe('zip:import bytes 双变体（02 v1.0e——download 字节直入导入链）', () => {
  it('bytes inspect：summary＋token（=bytes SHA-256）不落盘不入库；bytes commit：token 复验→落盘＋双 upsert', async () => {
    const ctx = await openCtx('bytes-ok');
    try {
      const bytes = await buildZip(PKG_FILES);
      const res = await ctx.pipeline({ bytes, phase: 'inspect' });
      if (!('token' in res)) throw new Error('bytes inspect 应回 {nodes,noScript,categories,manifest,token}');
      expect(res.token).toBe(sha256(bytes)); // token=内容 SHA-256（与 path 变体同语义）
      expect((res.nodes[0] as { type: string }).type).toBe('xhs.search');
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(0); // inspect 零写入
      expect(() => readdirSync(path.join(ctx.dir, 'node-types'))).toThrow();

      const commit = await ctx.pipeline({ bytes, phase: 'commit', token: res.token });
      if ('token' in commit) throw new Error('bytes commit 应回 {nodes,noScript}');
      expect(commit.nodes).toHaveLength(1);
      expect(commit.nodes[0]!).toMatchObject({ type: 'xhs.search', name: '小红书搜索' });
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(1); // 恰一行（hash 防重）
      expect(readdirSync(path.join(ctx.dir, 'node-types', 'xhs.search', '1.0.0')).length).toBeGreaterThan(0); // 落盘
    } finally {
      await ctx.dispose();
    }
  });

  it('bytes 调包（inspect 后换 bytes）→ ZIP-UNSAFE-ENTRY（token 复验失败）', async () => {
    const ctx = await openCtx('bytes-swap');
    try {
      const good = await buildZip(PKG_FILES);
      const res = await ctx.pipeline({ bytes: good, phase: 'inspect' });
      if (!('token' in res)) throw new Error('unreachable');
      const evil = await buildZip({ ...PKG_FILES, 'scripts/xhs_search.py': 'def run(ctx):\n    return {"evil": 1}\n' });
      let err: { code?: string } | undefined;
      try {
        await ctx.pipeline({ bytes: evil, phase: 'commit', token: res.token });
      } catch (e) {
        err = e as { code?: string };
      }
      expect(err).toMatchObject({ code: 'ZIP-UNSAFE-ENTRY' });
      expect(ctx.layer.dao.assetPackages.listByType('xhs.search')).toHaveLength(0); // 零入库
    } finally {
      await ctx.dispose();
    }
  });

  it('path 变体回归不受影响（同管线两源并存——通道名/数不变）', async () => {
    const ctx = await openCtx('path-regress');
    try {
      const bytes = await buildZip(PKG_FILES);
      const p = path.join(ctx.dir, 'pkg.zip');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(p, bytes);
      const res = await ctx.pipeline({ path: p, phase: 'inspect' });
      expect('token' in res && res.token).toBe(sha256(bytes));
      const commit = await ctx.pipeline({ path: p, phase: 'commit', token: sha256(bytes) });
      expect('nodes' in commit && commit.nodes).toHaveLength(1);
      void readFileSync;
    } finally {
      await ctx.dispose();
    }
  });
});

describe('zip:import bytes 变体 payload 校验（T4-14 校验面收窄——四变体）', () => {
  const ch = IPC_INVOKE_CHANNELS[20]!; // constella:zip:import
  it('bytes inspect/commit 合法形通过；bytes 非 Uint8Array / bytes+path 混形拒绝', () => {
    expect(validateInvokePayload(ch, { bytes: new Uint8Array([1, 2]), phase: 'inspect' }).ok).toBe(true);
    expect(validateInvokePayload(ch, { bytes: new Uint8Array([1]), phase: 'commit', token: 'sha256' }).ok).toBe(true);
    // path 变体仍绿（回归）
    expect(validateInvokePayload(ch, { path: 'C:\\a.zip', phase: 'inspect' }).ok).toBe(true);
    expect(validateInvokePayload(ch, { path: 'C:\\a.zip', phase: 'commit', token: 't' }).ok).toBe(true);
    // 非 bytes 形拒绝
    expect(validateInvokePayload(ch, { bytes: 'BMFS0GQ=', phase: 'inspect' }).ok).toBe(false); // 非 Uint8Array
    expect(validateInvokePayload(ch, { bytes: new Uint8Array([1]), phase: 'inspect', path: 'C:\\a.zip' }).ok).toBe(
      false,
    ); // 混形（bytes+path）拒绝
    expect(validateInvokePayload(ch, { phase: 'inspect' }).ok).toBe(false); // 无源拒绝
  });
});
