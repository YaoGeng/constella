// T5-11 §6.8 E2E（TDD-C-09 §6.8——B-11/B-12 client 侧执行段；对端=server〔T2-09 harness 同链路
// 复用：真 buildApp + 隧道 PG 真跑〕）。
//
// 链路（真 client〔createMarketAssembly＋真 fetch〕/真 zip 管线〔真 StorageLayer+DAO+export/
// import pipeline〕/真 server〔hono buildApp 直服 HTTP〕）：
//   A 注册→发布（v1.0f 字节变体产物 multipart）→202 pending（perms 复核回显）→
//   匿名列表**不可见**（PRD-A13-02 server 过滤——审核通过前）→
//   审核通过（E2E 直改库——T2-09 手法对端，admin 面未建）→
//   B 匿名列表可见→B 注册登录→安装（download 字节=发布字节→importArchiveBytes 真导入→
//   installs 计量）→downloadCount=1（prisma 断言）。
//
// 环境前置：dev-pg 隧道 127.0.0.1:15432（05 P2 区头「SSH 自愈隧道」——down 则单文件复跑或停卡
// 上报该项）。env 先置后 import（server env.ts 模块级加载——dotenv 只补缺、平台注入优先）。
process.env.DATABASE_URL ??= 'postgresql://constella:constella-dev-pw@127.0.0.1:15432/constella_dev';
process.env.JWT_SECRET ??= 'e2e-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.STORAGE_DRIVER = 'disk';
process.env.CORS_ORIGINS = 'app://';

import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// 隧道 PG 延迟放宽（server 套件同款）
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { StorageInvokeReq, ZipExportReq, ZipExportRes, ZipImportReq, ZipImportRes } from '@constella/shared/ipc';
import type { PublishAccepted } from '@constella/shared/dto';
import { SQLITE_ENGINE } from '../../main/storage/engine/sqlite-engine';
import { StorageLayer } from '../../main/storage/storage-layer';
import { createZipExportPipeline } from '../../main/zip/export-pipeline';
import { createZipImportPipeline } from '../../main/zip/import-pipeline';
import { createAssetInstaller } from '../../main/zip/asset-installer';
import { createPackageParser } from '../../main/zip/package-parser';
import { createZipReader } from '../../main/zip/zip-reader';
import { createZipSecurityValidator } from '../../main/zip/zip-security-validator';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { createMarketAssembly, type MarketAssemblyBridge } from '../assembly/market-assembly';
import { loadAppModule, loadPrisma, loadStorageFactory, type PrismaLike } from './server-e2e-bridge.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-market-e2e-'));
process.env.STORAGE_DIR = path.join(tmp, 'server-storage'); // env 先置后 import（见模块头）
const EMAIL_PREFIX = 'vitest-market-e2e-';

/** 真客户端定义（社媒类目——server ManifestGuard perms 复核回显 ['社媒'] 对端） */
const E2E_DEF: NodeDefinition = {
  kind: 'custom',
  type: 'e2e.market-node',
  meta: { name: 'E2E市场节点', icon: '📘', category: '社媒' },
  ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
  paramsSchema: [{ k: 'keyword', t: 'text' }],
  exec: { lang: 'python', file: 'scripts/e2e_market.py', entry: 'run' },
  version: '1.0.0',
  packageVersion: '1.0.0',
};

/** 一侧「机器」（A/B 各自的 StorageLayer＋zip 管线＋market 装配） */
interface Side {
  layer: StorageLayer;
  zipExport(req: ZipExportReq): Promise<ZipExportRes>;
  zipImport(payload: ZipImportReq): Promise<ZipImportRes>;
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
}

async function openSide(rel: string): Promise<Side> {
  const dir = path.join(tmp, rel);
  await mkdir(dir, { recursive: true });
  const layer = new StorageLayer(SQLITE_ENGINE);
  layer.open(dir);
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || layer.dao.definitions.loadAll().some((d) => d.type === t);
  const core = {
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    nodeTypesRoot: path.join(dir, 'node-types'),
  };
  const zipImport = createZipImportPipeline({
    ...core,
    installer: createAssetInstaller({
      ...core,
      definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
      assetPackages: { upsert: (args) => layer.dao.assetPackages.upsert(args) },
    }),
  });
  const zipExport = createZipExportPipeline({
    getFlow: (id) => layer.dao.flows.get(id),
    getDefinition: (t) => layer.dao.definitions.loadAll().find((d) => d.type === t),
    nodeTypesRoot: core.nodeTypesRoot,
  });
  return {
    layer,
    zipExport: async (req) => zipExport(req),
    zipImport: async (payload) => zipImport(payload),
    storageInvoke: (req) =>
      Promise.resolve(layer.ops.invoke(req.op, (req as { args?: unknown }).args)),
  };
}

let server: http.Server | null = null;
let baseUrl = '';
let prisma: PrismaLike | null = null;
const cleanups: Array<() => Promise<void> | void> = [];

/** hono app → node:http 直服（@hono/node-server 为 server 域依赖——client 侧以标准 web Request 适配） */
function serveApp(app: { fetch: (req: Request) => Promise<Response> | Response }): Promise<http.Server> {
  const s = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const headers: Array<[string, string]> = [];
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.push([k, v]);
        else if (Array.isArray(v)) for (const vv of v) headers.push([k, vv]);
      }
      const init: RequestInit = {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      };
      void Promise.resolve(app.fetch(new Request(`http://127.0.0.1${req.url}`, init)))
        .then(async (webRes) => {
          const body = Buffer.from(await webRes.arrayBuffer());
          const out: Array<[string, string | number]> = [];
          webRes.headers.forEach((value, key) => out.push([key, value]));
          // @ts-expect-error node:http writeHead 重载接受 [string,string] 元组数组
          res.writeHead(webRes.status, out);
          res.end(body);
        })
        .catch((err: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INTERNAL', message: String(err) } }));
        });
    });
  });
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

beforeAll(async () => {
  // ———— 真 server（T2-09 buildApp 同源；直改库=prisma 单例） ————
  const { buildApp } = await loadAppModule();
  prisma = (await loadPrisma()).prisma;
  server = await serveApp(buildApp());
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  // ———— 两轮清扫（server 测试同款：防 in-flight 残留漏删→FK 拦截） ————
  for (let round = 0; round < 2 && prisma !== null; round++) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) break;
    const pkgs = await prisma.package.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
    const pkgIds = pkgs.map((p) => p.id);
    if (pkgIds.length > 0) {
      const versions = await prisma.packageVersion.findMany({ where: { packageId: { in: pkgIds } } });
      const storage = (await loadStorageFactory()).getStorage();
      for (const v of versions) await storage.delete(v.storageKey).catch(() => undefined);
      await prisma.package.updateMany({ where: { id: { in: pkgIds } }, data: { latestVersionId: null } });
      await prisma.$transaction([
        prisma.packageVersion.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.reviewRecord.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.downloadStat.deleteMany({ where: { packageId: { in: pkgIds } } }),
        prisma.package.deleteMany({ where: { id: { in: pkgIds } } }),
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma?.$disconnect();
  for (const fn of cleanups) await fn();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
});

it('§6.8 真链：A 发布→pending→审核通过→B 匿名可见→登录下载安装→downloadCount=1', async () => {
  // ———— A 侧：真 StorageLayer（自研定义＋脚本资产）＋真 zip 导出管线 ＋ 真 market 装配 ————
  const sideA = await openSide('client-a');
  cleanups.push(() => sideA.layer.close());
  const scriptDir = path.join(tmp, 'client-a', 'node-types', 'e2e.market-node', '1.0.0', 'scripts');
  await mkdir(scriptDir, { recursive: true });
  await writeFile(path.join(scriptDir, 'e2e_market.py'), 'def run(ctx):\n    return {"ok": 1}\n', 'utf8');
  sideA.layer.dao.definitions.upsert(E2E_DEF);

  const secretA = new Map<string, string>();
  const bridgeOf = (side: Side, secretStore: Map<string, string>): MarketAssemblyBridge => ({
    zipExport: side.zipExport,
    zipImport: side.zipImport,
    storageInvoke: side.storageInvoke,
    dialogSaveFile: async () => ({ path: null }),
    secret: {
      set: async ({ key, value }) => {
        secretStore.set(key, value ?? '');
        return { ok: true };
      },
      get: async ({ key }) => ({ value: secretStore.get(key) ?? null }),
      del: async ({ key }) => {
        secretStore.delete(key);
        return { ok: true };
      },
    },
  });

  const emailA = `${EMAIL_PREFIX}a-${randomUUID()}@test.local`;
  const emailB = `${EMAIL_PREFIX}b-${randomUUID()}@test.local`;
  const asmA = createMarketAssembly({
    bridge: bridgeOf(sideA, secretA),
    baseUrl: () => baseUrl,
    viewportCenter: () => ({ x: 0, y: 0 }),
    notify: () => {},
    confirm: async () => true,
    fetch: globalThis.fetch,
  });

  // ① A 注册＋登录（真 server auth）
  await asmA.browserFaces.auth.register(emailA, '12345678');

  // ② A 发布：v1.0f 字节变体产物（真导出管线）→multipart→202 pending
  const accepted = (await asmA.publisher.publish(
    { kind: 'node', name: 'E2E发布包', summary: '端到端链路' },
    { types: ['e2e.market-node'] },
  )) as PublishAccepted;
  expect(accepted.status).toBe('pending');
  expect(accepted.perms).toEqual(['社媒']); // server perms 复核回显（S-02 §6.1g 同源）
  expect(accepted.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

  // ③ server 落库 PENDING（直改库断言——T2-09 手法）
  const pkg = (await prisma!.package.findUniqueOrThrow({
    where: { id: accepted.packageId },
    include: { versions: true },
  })) as { status: string; versions: Array<{ semver: string; checksum: string }> };
  expect(pkg.status).toBe('PENDING');
  expect(pkg.versions[0]!.semver).toBe('1.0.0');
  expect(pkg.versions[0]!.checksum).toBe(accepted.checksum);

  // ④ 审核通过前列表不可见（PRD-A13-02——server 过滤，客户端只消费状态）
  const before = await asmA.client.list({ kind: 'node' });
  expect(before.items.some((i) => i.id === accepted.packageId)).toBe(false);

  // ⑤ 审核通过（E2E 直改库——admin 面 T6 波未建；S-03 状态机 APPROVED 迁移等价终态）
  await prisma!.package.update({ where: { id: accepted.packageId }, data: { status: 'APPROVED' } });

  // ⑥ B 侧（独立「机器」）：匿名列表可见
  const sideB = await openSide('client-b');
  cleanups.push(() => sideB.layer.close());
  const secretB = new Map<string, string>();
  const asmB = createMarketAssembly({
    bridge: bridgeOf(sideB, secretB),
    baseUrl: () => baseUrl,
    viewportCenter: () => ({ x: 0, y: 0 }),
    notify: () => {},
    confirm: async () => true,
    fetch: globalThis.fetch,
  });
  const listed = await asmB.client.list({ kind: 'node' });
  const item = listed.items.find((i) => i.id === accepted.packageId);
  expect(item).toMatchObject({ name: 'E2E发布包', author: { name: emailA.split('@')[0] } });
  expect(listed.total).toBeGreaterThan(0);

  // ⑦ B 注册登录→安装（真链：detail→download 字节→importArchiveBytes 真导入→installs 计量）
  await asmB.browserFaces.auth.register(emailB, '12345678');
  const result = await asmB.install({ id: accepted.packageId, kind: 'node' });
  expect(result.kind).toBe('node');
  expect(result.nodeCount).toBe(1);
  // B 本地真导入落位：定义库＋节点库＋资产包
  expect(sideB.layer.dao.definitions.loadAll().some((d) => d.type === 'e2e.market-node')).toBe(true);
  expect(sideB.layer.dao.library.list().items.length).toBeGreaterThan(0);
  expect(sideB.layer.dao.assetPackages.listByType('e2e.market-node')).toHaveLength(1);

  // ⑧ downloadCount=1（直改库断言——同 T2-09 E2E）
  const after = (await prisma!.package.findUniqueOrThrow({
    where: { id: accepted.packageId },
    select: { downloadCount: true, installCount: true },
  })) as { downloadCount: number; installCount: number };
  expect(after.downloadCount).toBe(1);

  // 附：发布字节=server 存储对象字节（幂等键真实性——重导出同字节）
  const re = await sideA.zipExport({ types: ['e2e.market-node'], meta: { name: 'E2E发布包' } });
  if (!('bytes' in re)) throw new Error('unreachable');
  expect(`sha256:${createHash('sha256').update(re.bytes).digest('hex')}`).toBe(accepted.checksum);
});
