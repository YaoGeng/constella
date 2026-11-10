// ExamplePreloader＋示例资产 9（T5-08 / TDD-C-08 §3 ExamplePreloader 组件行＋§3 示例资产 9 段；
// §6.7 验收宿主——`vitest run zip-pipeline` 或本文件直跑，main 侧 node 直跑）。
//
// 覆盖两半：
//   A. 入库产物完整性——9 zip 在位/确定性（数据源重产与入库字节一致）/C-02 validateDefinition
//      零错误＋不撞内置 12/类目多样含「网络」＋py·ts 双语言/secret 仅 schema 零密文；
//   B. 预装行为——首启 installed=9（hash 防重＋逐包全安检直调 AssetInstaller.commit——
//      source='builtin' 免确认=W-35 裁定 A：官方分发经同一安全校验管线）/二启 installed=0
//      零 upsert（§6.7 二启零 delta·main 半段）/单包失败不阻断（失败隔离大声留痕）/
//      资产升级=hash 变化触发新包预装＋同名同型覆盖（03 §8 扩展点②＋01 A-11.1）。
// definitions=21 全量断言（open 装配序联动）在 storage/migrate/seeds-runner.spec（C-06 §6.1d 补跑）。
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import type { NodeDefinition } from '@constella/shared/dsl';
import { validateDefinition } from '../../renderer/definition/definition-validator';
import { createExamplePreloader } from './example-preloader';
import { EXAMPLE_ASSETS, EXAMPLE_COUNT, EXAMPLE_TYPES, buildExamplePackages } from './example-assets';
import { createAssetInstaller, type AssetInstaller } from './asset-installer';
import { createPackageParser } from './package-parser';
import { createZipReader } from './zip-reader';
import { createZipSecurityValidator } from './zip-security-validator';
import { createZipWriter } from './zip-writer';
import { ZIP_EPOCH } from './export-pipeline';

/** 入库示例资产目录（client/assets/examples——gen-examples.mjs 产物） */
const EXAMPLES_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'examples');

const tmp = mkdtempSync(path.join(tmpdir(), 'constella-example-preload-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** 9 zip 期望文件名（<type>.zip） */
const EXPECTED_ZIPS = EXAMPLE_TYPES.map((t) => `${t}.zip`);

// ————————————————————————————————————————————
// A. 入库产物完整性（示例即 T5-07 管线的真数据验证）
// ————————————————————————————————————————————

describe('示例资产 9（入库产物完整性）', () => {
  it('9 枚 zip 在位（<type>.zip ×9、无多余 zip）；EXAMPLE_COUNT=9', () => {
    expect(EXAMPLE_COUNT).toBe(9);
    expect(EXPECTED_ZIPS).toHaveLength(9);
    expect(readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.zip')).sort()).toEqual([...EXPECTED_ZIPS].sort());
  });

  it('确定性：数据源经 ZipWriter＋ZIP_EPOCH 重产 → 与入库 zip 逐枚字节一致（SHA-256；漂移即失败）', async () => {
    const writer = createZipWriter();
    for (const pkg of buildExamplePackages()) {
      const out = path.join(tmp, 'regen', pkg.zipName);
      await mkdir(path.dirname(out), { recursive: true });
      const { bytes } = await writer.write(pkg.files, out, { date: ZIP_EPOCH });
      const committed = readFileSync(path.join(EXAMPLES_DIR, pkg.zipName));
      expect(sha256(bytes)).toBe(sha256(committed)); // 入库产物≡源数据重产（gen 脚本同链）
    }
  });

  it('C-02 validateDefinition：9 定义八条零错误；kind=custom、exec≠null（强节点）、不撞内置 12', async () => {
    const reader = createZipReader();
    for (const pkg of buildExamplePackages()) {
      const entries = await reader.read(path.join(EXAMPLES_DIR, pkg.zipName));
      const nodeEntry = [...entries.keys()].find((k) => k.startsWith('nodes/'))!;
      const raw = JSON.parse(new TextDecoder().decode(entries.get(nodeEntry)!)) as {
        type: string;
        definition: NodeDefinition;
      };
      const def = raw.definition;
      expect(def.kind).toBe('custom');
      expect(def.exec).not.toBeNull(); // 强节点（卡面：定义+scripts）
      expect((BUILTIN_TYPE_IDS as readonly string[]).includes(def.type)).toBe(false); // 不撞内置命名空间
      const result = validateDefinition(def);
      expect(result.errors, `${def.type}: ${JSON.stringify(result.errors)}`).toEqual([]);
      expect(result.ok).toBe(true);
    }
    // 类型集整体与内置 12 零交集
    expect(EXAMPLE_TYPES.filter((t) => (BUILTIN_TYPE_IDS as readonly string[]).includes(t))).toEqual([]);
  });

  it('类目多样：含「网络」≥1（ctx.net 面示例）且类目 ≥4；py/ts 双语言混合；secret 仅 schema 声明、包内零密文', async () => {
    const categories = EXAMPLE_ASSETS.map((a) => a.definition.meta.category);
    expect(categories.filter((c) => c.includes('网络')).length).toBeGreaterThanOrEqual(1); // N1 网络门示例
    expect(new Set(categories).size).toBeGreaterThanOrEqual(4); // 类目多样
    const langs = EXAMPLE_ASSETS.map((a) => a.definition.exec!.lang);
    expect(langs.filter((l) => l === 'python').length).toBeGreaterThanOrEqual(2); // py/ts 双运行时
    expect(langs.filter((l) => l === 'ts').length).toBeGreaterThanOrEqual(2);
    // secret 面演示（net.fetch token）：schema 声明在定义内、包内零密文零引用键（X-20 口径）
    const tokenField = EXAMPLE_ASSETS.flatMap((a) => a.definition.paramsSchema).find((f) => f.t === 'secret');
    expect(tokenField).toMatchObject({ k: 'token', storage: 'safeStorage' });
    const reader = createZipReader();
    for (const pkg of buildExamplePackages()) {
      const entries = await reader.read(path.join(EXAMPLES_DIR, pkg.zipName));
      const all = [...entries.entries()].map(([name, data]) => name + new TextDecoder().decode(data)).join('\n');
      expect(all.includes('secret.param')).toBe(false); // 引用键 0 命中
    }
  });
});

// ————————————————————————————————————————————
// B. ExamplePreloader 预装行为（§6.7）
// ————————————————————————————————————————————

interface PkgRow {
  nodeType: string;
  pkgVersion: string;
  contentHash: string;
  dir: string;
  manifest: unknown;
}

/** in-memory DAO（T5-07 parser-installer spec 同构＋hasHash——幂等查面） */
function makeDao(): {
  definitions: NodeDefinition[];
  assetPackages: PkgRow[];
  upsertCalls: { definitions: number; assetPackages: number };
  definitionsDao: { upsert(doc: NodeDefinition): void };
  assetPackagesDao: { upsert(a: PkgRow): { id: string; reused: boolean }; hasHash(h: string): boolean };
} {
  const definitions: NodeDefinition[] = [];
  const assetPackages: PkgRow[] = [];
  const upsertCalls = { definitions: 0, assetPackages: 0 };
  return {
    definitions,
    assetPackages,
    upsertCalls,
    definitionsDao: {
      upsert(doc) {
        upsertCalls.definitions += 1;
        const i = definitions.findIndex((d) => d.type === doc.type);
        if (i >= 0) definitions[i] = doc;
        else definitions.push(doc);
      },
    },
    assetPackagesDao: {
      upsert(a) {
        upsertCalls.assetPackages += 1;
        const hit = assetPackages.find((p) => p.contentHash === a.contentHash);
        if (hit !== undefined) return { id: `pkg-${assetPackages.indexOf(hit)}`, reused: true };
        assetPackages.push(a);
        return { id: `pkg-${assetPackages.length - 1}`, reused: false };
      },
      hasHash(h) {
        return assetPackages.some((p) => p.contentHash === h);
      },
    },
  };
}

function makePreloader(
  examplesDir: string,
  dao: ReturnType<typeof makeDao>,
  logs: string[] = [],
): { preloader: ReturnType<typeof createExamplePreloader>; installer: AssetInstaller } {
  const hasType = (t: string): boolean =>
    (BUILTIN_TYPE_IDS as readonly string[]).includes(t) || dao.definitions.some((d) => d.type === t);
  const installer = createAssetInstaller({
    reader: createZipReader(),
    validator: createZipSecurityValidator(),
    parser: createPackageParser({ hasType }),
    nodeTypesRoot: path.join(tmp, 'node-types'),
    definitions: dao.definitionsDao,
    assetPackages: dao.assetPackagesDao,
  });
  return {
    installer,
    preloader: createExamplePreloader({
      examplesDir,
      installer,
      assetPackages: dao.assetPackagesDao,
      log: (...a) => logs.push(a.map(String).join(' ')),
    }),
  };
}

/** 拷入库 9 zip 到临时目录（损坏/升级用例的沙箱拷贝） */
async function copyExamplesTo(rel: string): Promise<string> {
  const dir = path.join(tmp, rel);
  await mkdir(dir, { recursive: true });
  for (const name of EXPECTED_ZIPS) {
    await cp(path.join(EXAMPLES_DIR, name), path.join(dir, name));
  }
  return dir;
}

describe('ExamplePreloader（首启预装——source=builtin 免确认·W-35 裁定 A）', () => {
  it('首启：9 包逐包直调 commit（全安检内嵌）→ installed=9；assetPackages 9 行＋definitions 9 custom；node-types/<type>/1.0.0/ 四件套落盘', async () => {
    const dao = makeDao();
    const { preloader } = makePreloader(EXAMPLES_DIR, dao);
    const res = await preloader.preloadIfMissing();
    expect(res).toEqual({ installed: 9 });
    expect(dao.assetPackages).toHaveLength(9);
    expect(dao.definitions).toHaveLength(9);
    expect(dao.definitions.every((d) => d.kind === 'custom')).toBe(true);
    expect(dao.definitions.map((d) => d.type).sort()).toEqual([...EXAMPLE_TYPES].sort());
    // asset_packages 行形：nodeType=type、contentHash=zip 文件 SHA-256（幂等键面）
    for (const row of dao.assetPackages) {
      expect(row.pkgVersion).toBe('1.0.0');
      expect(row.contentHash).toBe(sha256(readFileSync(path.join(EXAMPLES_DIR, `${row.nodeType}.zip`))));
    }
    // 落盘形（§4 布局）：抽查 gate.login（含 config 四件套）与 net.fetch（ts、无 config）
    expect(readdirSync(path.join(tmp, 'node-types', 'gate.login', '1.0.0')).sort()).toEqual([
      'config',
      'deps',
      'manifest.json',
      'nodes',
      'scripts',
    ]);
    expect(readdirSync(path.join(tmp, 'node-types', 'net.fetch', '1.0.0')).sort()).toEqual([
      'deps',
      'manifest.json',
      'nodes',
      'scripts',
    ]);
    expect(readFileSync(path.join(tmp, 'node-types', 'net.fetch', '1.0.0', 'scripts', 'net_fetch.ts'), 'utf8')).toContain(
      'ctx.net.fetch',
    );
  });

  it('二启零 delta：hash 全命中 → installed=0、definitions/assetPackages 零 upsert 调用（§6.7 幂等面）', async () => {
    const dao = makeDao();
    const { preloader } = makePreloader(EXAMPLES_DIR, dao);
    await preloader.preloadIfMissing();
    const before = { defs: [...dao.definitions], pkgs: [...dao.assetPackages] };
    const calls = { ...dao.upsertCalls };
    const res = await preloader.preloadIfMissing();
    expect(res).toEqual({ installed: 0 });
    expect(dao.upsertCalls).toEqual(calls); // 零 upsert（updated_at 不动——零 delta 前提）
    expect(dao.definitions).toEqual(before.defs);
    expect(dao.assetPackages).toEqual(before.pkgs);
  });

  it('单包失败不阻断启动：截断一枚 → 该包跳过大声留痕、其余 8 包照常预装（⚠ 失败策略——锚含糊，本卡冻结失败隔离）', async () => {
    const dir = await copyExamplesTo('corrupt');
    await writeFile(path.join(dir, 'xhs.search.zip'), readFileSync(path.join(dir, 'xhs.search.zip')).subarray(0, 100)); // 截断→EOCD 缺失
    const dao = makeDao();
    const logs: string[] = [];
    const { preloader } = makePreloader(dir, dao, logs);
    const res = await preloader.preloadIfMissing();
    expect(res).toEqual({ installed: 8 });
    expect(dao.assetPackages).toHaveLength(8);
    expect(dao.definitions.map((d) => d.type)).not.toContain('xhs.search');
    expect(logs.some((l) => l.includes('xhs.search.zip') && l.includes('失败'))).toBe(true); // 点名留痕
  });

  it('资产升级（03 §8 扩展点②）：同型新内容包（hash 变）→ installed=1、definitions 同名同型覆盖、asset_packages 新行（内容寻址）', async () => {
    const dir = await copyExamplesTo('upgrade');
    const dao = makeDao();
    const { preloader } = makePreloader(dir, dao);
    await preloader.preloadIfMissing();

    // 同型新内容：gate.login meta.name → v2（经 ZipWriter 重产——确定性链同源）
    const pkg = buildExamplePackages().find((p) => p.zipName === 'gate.login.zip')!;
    const nodeKey = pkg.files.find((f) => f.name.startsWith('nodes/'))!.name;
    const nodeRaw = JSON.parse(pkg.files.find((f) => f.name === nodeKey)!.data as string) as {
      type: string;
      name: string;
      definition: NodeDefinition;
    };
    nodeRaw.name = '登录闸 v2';
    nodeRaw.definition.meta = { ...nodeRaw.definition.meta, name: '登录闸 v2' };
    const files = pkg.files.map((f) =>
      f.name === nodeKey
        ? { name: f.name, data: JSON.stringify(nodeRaw, null, 2) }
        : f.name === 'manifest.json'
          ? { name: f.name, data: JSON.stringify({ ...JSON.parse(f.data as string), name: '登录闸 v2' }, null, 2) }
          : f,
    );
    await createZipWriter().write(files, path.join(dir, 'gate.login.zip'), { date: ZIP_EPOCH });

    const res = await preloader.preloadIfMissing();
    expect(res).toEqual({ installed: 1 });
    expect(dao.assetPackages).toHaveLength(10); // 内容寻址：新 hash=新行
    expect(dao.definitions).toHaveLength(9); // 同名同型覆盖（01 A-11.1）
    expect(dao.definitions.find((d) => d.type === 'gate.login')?.meta.name).toBe('登录闸 v2');
  });

  it('examplesDir 缺失：installed=0＋warn 留痕、不抛（预装=增强面——不阻断启动）', async () => {
    const dao = makeDao();
    const logs: string[] = [];
    const { preloader } = makePreloader(path.join(tmp, 'no-such-dir'), dao, logs);
    await expect(preloader.preloadIfMissing()).resolves.toEqual({ installed: 0 });
    expect(logs.length).toBeGreaterThan(0);
    expect(dao.assetPackages).toHaveLength(0);
  });

  it('非 .zip 杂散文件忽略（目录只认 *.zip——升级随分发替换即增删自由）', async () => {
    const dir = await copyExamplesTo('stray');
    await writeFile(path.join(dir, 'README.md'), '示例资产维护说明见 scripts/gen-examples.mjs\n');
    const dao = makeDao();
    const { preloader } = makePreloader(dir, dao);
    await expect(preloader.preloadIfMissing()).resolves.toEqual({ installed: 9 });
    expect(dao.assetPackages).toHaveLength(9);
  });
});

// ————————————————————————————————————————————
// P-3 收窄守恒（§6.8 联动——本卡不新增 jszip import 面）
// ————————————————————————————————————————————

describe('P-3 收窄守恒', () => {
  it('example-preloader/example-assets 零 jszip import（读写收窄 zip-writer/zip-reader 不变）', () => {
    for (const f of ['example-preloader.ts', 'example-assets.ts']) {
      const src = readFileSync(path.resolve(__dirname, f), 'utf8');
      expect(src.includes('jszip'), `${f} 不得直接 import jszip`).toBe(false);
    }
  });
});
