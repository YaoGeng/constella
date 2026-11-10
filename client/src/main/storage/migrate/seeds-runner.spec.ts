// SeedsRunner＋open 装配序套件（T1-03 验收；C-06 §6.1d＋§6.1f；双引擎）。
// 本波口径：SeedsRunner 单独面 definitions=12（≡ BUILTIN_TYPE_IDS——种子本体，02 §13.2 封版锚）；
// **=21 全量断言已随 T5-08 补跑**（P1 区头 ⚠② 收口——下方「storage seed＋示例预装」段：
// open() 挂点注入真 ExamplePreloader 后的完成态）。
// 断言面：空库 open → flows=9/definitions=12/library=3；二启零 delta（全表逐行快照深相等）；
// 伪造 seed_flags 缺 f9 → 仅补 f9、既有行不动；reopen 后 journal_mode=wal、foreign_keys=on；
// ensureInitialVersions 给无版本流程补「初始版本」；preloadExamples 挂点时序（迁移后、种子前）。
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { StorageLayer } from '../storage-layer';
// T5-08（C-08 §3 示例资产段——测试面跨域消费：预装器/导入链组件/示例类型集）
import { EXAMPLE_TYPES } from '../../zip/example-assets';
import { createExamplePreloader } from '../../zip/example-preloader';
import { createAssetInstaller } from '../../zip/asset-installer';
import { createPackageParser } from '../../zip/package-parser';
import { createZipReader } from '../../zip/zip-reader';
import { createZipSecurityValidator } from '../../zip/zip-security-validator';

/** 全库逐行快照（二启零 delta 断言面——按表名分组排序序列化） */
function dumpAll(layer: StorageLayer): Record<string, unknown[]> {
  const conn = layer.connection;
  const tables = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    out[t.name as string] = conn.prepare(`SELECT * FROM ${t.name as string}`).all();
  }
  return out;
}

function counts(layer: StorageLayer): { flows: number; versions: number; definitions: number; library: number } {
  const conn = layer.connection;
  const one = (sql: string): number => (conn.prepare(sql).get() as { c: number }).c;
  return {
    flows: one('SELECT COUNT(*) AS c FROM flows'),
    versions: one('SELECT COUNT(*) AS c FROM flow_versions'),
    definitions: one('SELECT COUNT(*) AS c FROM node_definitions'),
    library: one('SELECT COUNT(*) AS c FROM library_entries'),
  };
}

describe.each(TEST_ENGINES)('storage seed [%s]', (engine: DbEngine) => {
  it('首启播种：flows=9、definitions=12（≡BUILTIN_TYPE_IDS）、library=3、每流程带初始版本（§6.1d 本波口径）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      const types = (
        layer.connection.prepare('SELECT type FROM node_definitions ORDER BY type').all() as Array<{
          type: string;
        }>
      ).map((r) => r.type);
      expect(types.sort()).toEqual([...BUILTIN_TYPE_IDS].sort());
      const labels = layer.connection
        .prepare("SELECT label FROM flow_versions WHERE flow_id = 'f1'")
        .all() as Array<{ label: string }>;
      expect(labels).toEqual([{ label: '初始版本' }]);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('二启零 delta：全表逐行快照深相等（用户数据/种子标记零变化）', () => {
    const tmp = makeTempDb();
    try {
      const l1 = new StorageLayer(engine);
      l1.open(tmp.dir);
      const before = dumpAll(l1);
      l1.close();

      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      expect(dumpAll(l2)).toEqual(before);
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('伪造 seed_flags 缺 f9 → 仅补 f9、既有行不动（demo L1246-1255 增量补种）', () => {
    const tmp = makeTempDb();
    try {
      const l1 = new StorageLayer(engine);
      l1.open(tmp.dir);
      l1.connection.prepare("DELETE FROM seed_flags WHERE flow_id = 'f9'").run();
      // 同时删掉 f9 业务行，模拟「f9 未种」状态（补种应重建 f9 全套）
      l1.connection.prepare("DELETE FROM flow_versions WHERE flow_id = 'f9'").run();
      l1.connection.prepare("DELETE FROM nodes WHERE flow_id = 'f9'").run();
      l1.connection.prepare("DELETE FROM flows WHERE id = 'f9'").run();
      const before = dumpAll(l1);
      l1.close();

      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      const after = dumpAll(l2);
      // f1..f8 相关行逐行不变（时间戳也不重打）
      for (const fid of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']) {
        expect(
          (after['flows'] as Array<{ id: string }>).some((r) => r.id === fid),
          `flows 含 ${fid}`,
        ).toBe(true);
      }
      expect((after['seed_flags'] as Array<{ flow_id: string }>).map((r) => r.flow_id).sort()).toEqual(
        ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'].map((x) => x).sort(),
      );
      expect(counts(l2)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      // 未动既有 f1 行（除 f9 相关表外其余表行数与内容一致——f9 行重建不影响其余）
      const strip = (rows: Array<{ id?: string; flow_id?: string }>): unknown[] =>
        rows.filter((r) => r.id !== 'f9' && r.flow_id !== 'f9' && r.flow_id !== 'f9-v0');
      expect(strip(after['flows'] as never[])).toEqual(strip(before['flows'] as never[]));
      expect(strip(after['seed_flags'] as never[])).toEqual(strip(before['seed_flags'] as never[]));
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('reopen 后 journal_mode=wal、foreign_keys=on（§6.1f）', () => {
    const tmp = makeTempDb();
    try {
      const l1 = new StorageLayer(engine);
      l1.open(tmp.dir);
      l1.close();
      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      expect(String(l2.connection.pragma('journal_mode')).toLowerCase()).toBe('wal');
      expect(Number(l2.connection.pragma('foreign_keys'))).toBe(1);
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('ensureInitialVersions：无版本流程补「初始版本」', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      // 伪造一个无版本流程（绕过 flows.create 正常路径）
      layer.connection
        .prepare(
          "INSERT INTO flows (id, name, order_idx, soft_del, created_at, updated_at) VALUES ('bare', '裸流程', 99, 0, 1, 1)",
        )
        .run();
      layer.close();

      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir); // open 装配序内 ensureInitialVersions 生效
      const rows = l2.connection
        .prepare("SELECT label, node_count, edge_count FROM flow_versions WHERE flow_id = 'bare'")
        .all() as Array<{ label: string; node_count: number; edge_count: number }>;
      expect(rows).toEqual([{ label: '初始版本', node_count: 0, edge_count: 0 }]);
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('preloadExamples 挂点：迁移完成后、种子流程写入前触发（M4 裁决 2/#11）；缺省空实现', () => {
    const tmp = makeTempDb();
    try {
      const seen: string[] = [];
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir, {
        preloadExamples: () => {
          // 挂点时：迁移已完成（schema_migrations 可查）
          seen.push(
            `migrations=${(
              layer.connection.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }
            ).c}`,
          );
          // 种子流程未写入（flows 空仓）
          seen.push(`flows=${(layer.connection.prepare('SELECT COUNT(*) AS c FROM flows').get() as { c: number }).c}`);
        },
      });
      expect(seen).toEqual(['migrations=1', 'flows=0']);
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      layer.close();

      // 缺省（不传钩子）等价空实现
      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      expect(counts(l2)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('异步 preloadExamples：种子链在钩子 resolve 后执行（保序）', async () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      let released = false;
      layer.open(tmp.dir, {
        preloadExamples: async () => {
          await new Promise<void>((r) => setTimeout(r, 5));
          released = true;
        },
      });
      expect(layer.opened).not.toBeNull();
      await layer.opened;
      expect(released).toBe(true);
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('factoryReset：删库重迁重种（编排面；目录清理/app 重启归 C-M1）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      // 用户数据注入
      layer.connection
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('snap', 'true')",
        )
        .run();
      layer.factoryReset();
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 12, library: 3 });
      const snap = layer.connection.prepare("SELECT value FROM settings WHERE key = 'snap'").get();
      expect(snap).toBeUndefined(); // 用户数据随删库清除
      layer.close();
      vi.restoreAllMocks();
    } finally {
      tmp.dispose();
    }
  });
});

// ————————————————————————————————————————————
// T5-08 补跑（C-06 §6.1d 联动——P1 区头 ⚠② 收口）：open() 挂点注入真 ExamplePreloader
// （迁移完成后、种子流程写入前——M4 裁决 2/#11）后的完成态断言。生产装配同构
// （production-assembly preloadExamples 回调——C-08 §3 ExamplePreloader 组件行复用处）。
// ————————————————————————————————————————————

/** 入库示例资产目录（client/assets/examples——gen-examples.mjs 确定性产物） */
const EXAMPLES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'examples');

/** open() 挂点真实现注入（生产同构 wiring：AssetInstaller 直调面=C-06 main 内直调） */
function openWithExamples(
  engine: DbEngine,
  tmp: ReturnType<typeof makeTempDb>,
  installedLog: number[],
): StorageLayer {
  const layer = new StorageLayer(engine);
  layer.open(tmp.dir, {
    preloadExamples: async () => {
      // hasType=内置 12 ∪ definitions DAO（PackageParser 未知 type 兜底判定面——index.ts 同构）
      const hasType = (t: string): boolean =>
        (BUILTIN_TYPE_IDS as readonly string[]).includes(t) ||
        layer.dao.definitions.loadAll().some((doc) => doc.type === t);
      const installer = createAssetInstaller({
        reader: createZipReader(),
        validator: createZipSecurityValidator(),
        parser: createPackageParser({ hasType }),
        nodeTypesRoot: path.join(tmp.dir, 'node-types'),
        definitions: { upsert: (doc) => layer.dao.definitions.upsert(doc) },
        assetPackages: {
          upsert: (args) => layer.dao.assetPackages.upsert(args),
        },
      });
      const preloader = createExamplePreloader({
        examplesDir: EXAMPLES_DIR,
        installer,
        assetPackages: layer.dao.assetPackages, // hasHash 幂等查面（T5-08 增补）
      });
      const res = await preloader.preloadIfMissing();
      installedLog.push(res.installed);
    },
  });
  return layer;
}

describe.each(TEST_ENGINES)('storage seed＋示例预装 [%s]', (engine: DbEngine) => {
  it('空库首启（挂点预装→种子）：definitions=21（12 builtin＋9 custom≡EXAMPLE_TYPES）＋asset_packages=9＋flows=9＋library=3（§6.1d 收口）', async () => {
    const tmp = makeTempDb();
    try {
      const installed: number[] = [];
      const layer = openWithExamples(engine, tmp, installed);
      await layer.opened; // 异步挂点→种子链完成后（open 完成态）
      expect(installed).toEqual([9]); // 首启 9 包全预装
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 21, library: 3 });
      const one = (sql: string): number => (layer.connection.prepare(sql).get() as { c: number }).c;
      expect(one('SELECT COUNT(*) AS c FROM asset_packages')).toBe(9); // §6.7 asset_packages=9
      // kind 构成：12 builtin（≡BUILTIN_TYPE_IDS）＋9 custom（≡EXAMPLE_TYPES——不撞内置）
      const rows = layer.connection.prepare('SELECT type, kind FROM node_definitions').all() as Array<{
        type: string;
        kind: string;
      }>;
      const builtin = rows.filter((r) => r.kind === 'builtin').map((r) => r.type).sort();
      const custom = rows.filter((r) => r.kind === 'custom').map((r) => r.type).sort();
      expect(builtin).toEqual([...BUILTIN_TYPE_IDS].sort());
      expect(custom).toEqual([...EXAMPLE_TYPES].sort());
      // 落盘面抽查：示例脚本资产在位（SandboxExecutor 白名单根 userData/node-types 同源）
      expect(
        layer.connection.prepare('SELECT dir FROM asset_packages WHERE node_type = :t').get({ t: 'xhs.search' }),
      ).toMatchObject({ dir: path.join(tmp.dir, 'node-types', 'xhs.search', '1.0.0') });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('二启零 delta（§6.7）：全表逐行快照深相等＋二启预装 installed=0（hash 幂等）', async () => {
    const tmp = makeTempDb();
    try {
      const installed: number[] = [];
      const l1 = openWithExamples(engine, tmp, installed);
      await l1.opened;
      const before = dumpAll(l1);
      l1.close();

      const l2 = openWithExamples(engine, tmp, installed);
      await l2.opened;
      expect(installed).toEqual([9, 0]); // 二启零预装
      expect(dumpAll(l2)).toEqual(before); // 全表零 delta（含 updated_at/asset_packages/seed_flags）
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('示例可被同型自定义节点覆盖（01 A-4.02）：后装同型 custom 定义 upsert 覆盖示例行、definitions 仍 21', async () => {
    const tmp = makeTempDb();
    try {
      const layer = openWithExamples(engine, tmp, []);
      await layer.opened;
      // 后装同型自定义（C-13 editDefinition/zip 导入四入口任一——同名同型 upsert 语义）
      const example = layer.dao.definitions.loadAll().find((doc) => doc.type === 'xhs.search')!;
      layer.dao.definitions.upsert({ ...example, meta: { ...example.meta, name: '搜索采集 v2' } });
      const after = layer.dao.definitions.loadAll();
      expect(after).toHaveLength(21); // 覆盖不新增（01 A-11.1）
      const replaced = after.find((doc) => doc.type === 'xhs.search')!;
      expect(replaced.meta.name).toBe('搜索采集 v2');
      expect(replaced.kind).toBe('custom'); // 示例行=普通 custom 行（无分支保护）
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});
