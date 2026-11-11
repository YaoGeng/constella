// SeedsRunner＋open 装配序套件（T1-03 验收；C-06 §6.1d＋§6.1f；双引擎；T6-18 种子重制联动）。
// 口径（T6-18 后）：bare 面（无预装挂点）种子=f1~f4（纯内置类型流）——F5~F9 引用示例类型
// （载体=ExamplePreloader 预装 10 包），类型未就位暂缓播种且**不写 flag**（渐进补种）；
// 挂点注入真 ExamplePreloader 后=9 流全量（definitions=22=12 builtin＋10 custom≡EXAMPLE_TYPES
// ——T6-18 前簿记 21/9）＋asset_packages=10。v2 种子刷新迁移＝既有库升级路径（文末用例）。
// 断言面：空库 open → bare flows=4/definitions=12/library=3；二启零 delta（全表逐行快照深相等）；
// 伪造 seed_flags 缺 f1 → 仅补 f1、既有行不动；reopen 后 journal_mode=wal、foreign_keys=on；
// ensureInitialVersions 给无版本流程补「初始版本」；preloadExamples 挂点时序（迁移后、种子前）。
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DbConnection, DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { BUILTIN_TYPE_IDS } from '@constella/shared/constants';
import { StorageLayer } from '../storage-layer';
import { V1_BASELINE } from './migrations';
import { migrate } from './migration-runner';
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
  it('首启播种（bare 面）：flows=4（f1~f4 纯内置流）、definitions=12（≡BUILTIN_TYPE_IDS）、library=3、f1 带初始版本＋F5~F9 不占 flag（渐进补种）', () => {
    const tmp = makeTempDb();
    try {
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir);
      expect(counts(layer)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
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
      // F5~F9 引用示例类型（载体未就位）——不写 flag（后续启次载体就位即补种）
      const flags = (
        layer.connection.prepare('SELECT flow_id FROM seed_flags ORDER BY flow_id').all() as Array<{
          flow_id: string;
        }>
      ).map((r) => r.flow_id);
      expect(flags).toEqual(['f1', 'f2', 'f3', 'f4']);
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

  it('伪造 seed_flags 缺 f1 → 仅补 f1、既有行不动（demo L1246-1255 增量补种；bare 面取纯内置流）', () => {
    const tmp = makeTempDb();
    try {
      const l1 = new StorageLayer(engine);
      l1.open(tmp.dir);
      l1.connection.prepare("DELETE FROM seed_flags WHERE flow_id = 'f1'").run();
      // 同时删掉 f1 业务行，模拟「f1 未种」状态（补种应重建 f1 全套）
      l1.connection.prepare("DELETE FROM flow_versions WHERE flow_id = 'f1'").run();
      l1.connection.prepare("DELETE FROM nodes WHERE flow_id = 'f1'").run();
      l1.connection.prepare("DELETE FROM flows WHERE id = 'f1'").run();
      const before = dumpAll(l1);
      l1.close();

      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      const after = dumpAll(l2);
      // f2~f4 相关行逐行不变（时间戳也不重打）
      for (const fid of ['f2', 'f3', 'f4']) {
        expect(
          (after['flows'] as Array<{ id: string }>).some((r) => r.id === fid),
          `flows 含 ${fid}`,
        ).toBe(true);
      }
      expect((after['seed_flags'] as Array<{ flow_id: string }>).map((r) => r.flow_id).sort()).toEqual(
        ['f1', 'f2', 'f3', 'f4'],
      );
      expect(counts(l2)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
      // 未动既有行（除 f1 相关表外其余表行数与内容一致——f1 行重建不影响其余）
      const strip = (rows: Array<{ id?: string; flow_id?: string }>): unknown[] =>
        rows.filter((r) => r.id !== 'f1' && r.flow_id !== 'f1' && r.flow_id !== 'f1-v0');
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
      expect(seen).toEqual(['migrations=2', 'flows=0']); // 发布序列 v1＋v2（T6-18）
      expect(counts(layer)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
      layer.close();

      // 缺省（不传钩子）等价空实现
      const l2 = new StorageLayer(engine);
      l2.open(tmp.dir);
      expect(counts(l2)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
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
      expect(counts(layer)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
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
      expect(counts(layer)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
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
// T5-08 补跑（C-06 §6.1d 联动——P1 区头 ⚠② 收口）＋T6-18 簿记更新（9→10 包/21→22 定义）：
// open() 挂点注入真 ExamplePreloader（迁移完成后、种子流程写入前——M4 裁决 2/#11）后的
// 完成态断言。生产装配同构（production-assembly preloadExamples 回调——C-08 §3 组件行复用处）。
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
  it('空库首启（挂点预装→种子）：definitions=22（12 builtin＋10 custom≡EXAMPLE_TYPES）＋asset_packages=10＋flows=9＋library=3（§6.1d 收口；T6-18 簿记 9→10/21→22）', async () => {
    const tmp = makeTempDb();
    try {
      const installed: number[] = [];
      const layer = openWithExamples(engine, tmp, installed);
      await layer.opened; // 异步挂点→种子链完成后（open 完成态）
      expect(installed).toEqual([10]); // 首启 10 包全预装（T6-18 增 xhs.comment.post）
      expect(counts(layer)).toEqual({ flows: 9, versions: 9, definitions: 22, library: 3 });
      const one = (sql: string): number => (layer.connection.prepare(sql).get() as { c: number }).c;
      expect(one('SELECT COUNT(*) AS c FROM asset_packages')).toBe(10); // §6.7 asset_packages=10
      // kind 构成：12 builtin（≡BUILTIN_TYPE_IDS）＋10 custom（≡EXAMPLE_TYPES——不撞内置）
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
      expect(installed).toEqual([10, 0]); // 二启零预装
      expect(dumpAll(l2)).toEqual(before); // 全表零 delta（含 updated_at/asset_packages/seed_flags）
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('示例可被同型自定义节点覆盖（01 A-4.02）：后装同型 custom 定义 upsert 覆盖示例行、definitions 仍 22', async () => {
    const tmp = makeTempDb();
    try {
      const layer = openWithExamples(engine, tmp, []);
      await layer.opened;
      // 后装同型自定义（C-13 editDefinition/zip 导入四入口任一——同名同型 upsert 语义）
      const example = layer.dao.definitions.loadAll().find((doc) => doc.type === 'xhs.search')!;
      layer.dao.definitions.upsert({ ...example, meta: { ...example.meta, name: '搜索采集 v2' } });
      const after = layer.dao.definitions.loadAll();
      expect(after).toHaveLength(22); // 覆盖不新增（01 A-11.1）
      const replaced = after.find((doc) => doc.type === 'xhs.search')!;
      expect(replaced.meta.name).toBe('搜索采集 v2');
      expect(replaced.kind).toBe('custom'); // 示例行=普通 custom 行（无分支保护）
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});

// ————————————————————————————————————————————
// T6-18：渐进补种＋v2 种子刷新（既有库升级路径——重制对既有 dev 库的生效方式）
// ————————————————————————————————————————————

/** 旧种子形 v1-only 库夹具（T6-16 walk 阻断①形态）：f1~f9 各 1 节点最小流程＋flag；
 *  f2 保存过（版本栈 2）/f3 有 run 历史/f4 软删/f6 改名——改动面四态＋用户流 u1＋settings 行 */
function buildLegacyDb(engine: DbEngine, dir: string): void {
  const conn = engine.open(path.join(dir, 'constella.db'));
  try {
    migrate(conn, [V1_BASELINE]);
    conn
      .prepare(
        `INSERT INTO node_definitions (type, kind, meta, ports, params_schema, exec, inner, policy, io, version, pkg_version, updated_at)
         VALUES ('trigger.manual', 'builtin', '{"name":"手动触发"}', '{"ins":[],"outs":[{"id":"out","label":"输出"}]}', '[]', NULL, NULL, NULL, NULL, '1.0.0', '1.0.0', 0)`,
      )
      .run();
    const insFlow = conn.prepare(
      'INSERT INTO flows (id, name, order_idx, soft_del, created_at, updated_at) VALUES (:id, :name, :idx, 0, 1, 1)',
    );
    const insNode = conn.prepare(
      "INSERT INTO nodes (id, flow_id, type, name, x, y, created_at, updated_at) VALUES (:id, :fid, 'trigger.manual', '开始', 0, 0, 1, 1)",
    );
    const insVer = conn.prepare(
      "INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES (:id, :fid, '初始版本', 1, 0, '{}', 1)",
    );
    const insFlag = conn.prepare('INSERT INTO seed_flags (flow_id, seeded_at) VALUES (:fid, 1)');
    for (let i = 1; i <= 9; i += 1) {
      const fid = `f${i}`;
      insFlow.run({ id: fid, name: `示例·旧${i}`, idx: i });
      insNode.run({ id: `${fid}-n1`, fid });
      insVer.run({ id: `${fid}-v0`, fid });
      insFlag.run({ fid });
    }
    conn
      .prepare(
        "INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES ('f2-v1', 'f2', '手动保存', 1, 0, '{}', 2)",
      )
      .run();
    conn
      .prepare("INSERT INTO runs (id, flow_id, name, status, t0, created_at) VALUES ('r1', 'f3', '旧run', 'done', 1, 1)")
      .run();
    conn.prepare("UPDATE flows SET soft_del = 1 WHERE id = 'f4'").run();
    conn.prepare("UPDATE flows SET name = '我的备份', updated_at = 2 WHERE id = 'f6'").run();
    conn
      .prepare(
        "INSERT INTO flows (id, name, order_idx, soft_del, created_at, updated_at) VALUES ('u1', '用户流', 99, 0, 1, 2)",
      )
      .run();
    conn
      .prepare(
        "INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES ('u1-v0', 'u1', '初始版本', 0, 0, '{}', 1)",
      )
      .run();
    conn.prepare("INSERT INTO settings (key, value) VALUES ('snap', 'true')").run();
    // 既有库的节点库行（真实 dev 库从旧种子首启而来，id=旧 SEED_LIBRARY 固定 id——firstBoot
    // 误判回归锚：v2 清空全部 flag 后不得按同 id 重插 library 撞主键；type 取夹具已种定义满足 FK）
    conn
      .prepare(
        "INSERT INTO library_entries (id, name, type, params, script_meta, updated_at) VALUES ('lib-seed-1', '小红书搜索', 'trigger.manual', NULL, NULL, 0)",
      )
      .run();
  } finally {
    conn.close();
  }
}

describe.each(TEST_ENGINES)('T6-18 渐进补种＋v2 种子刷新 [%s]', (engine: DbEngine) => {
  it('渐进补种：bare 首启 f1~f4（F5~F9 不占 flag）→ 同库挂点预装后补齐 9 流（definitions=22）', async () => {
    const tmp = makeTempDb();
    try {
      const l1 = new StorageLayer(engine);
      l1.open(tmp.dir);
      expect(counts(l1)).toEqual({ flows: 4, versions: 4, definitions: 12, library: 3 });
      l1.close();

      const installed: number[] = [];
      const l2 = openWithExamples(engine, tmp, installed);
      await l2.opened;
      expect(installed).toEqual([10]); // 示例载体后到——预装 10 包后种子链同启补种
      expect(counts(l2)).toEqual({ flows: 9, versions: 9, definitions: 22, library: 3 });
      // f7 新构架就位（xhs.comment.post 载体依赖面）
      const f7Types = (
        l2.connection.prepare("SELECT type FROM nodes WHERE flow_id = 'f7' ORDER BY id").all() as Array<{
          type: string;
        }>
      ).map((r) => r.type);
      expect(f7Types).toContain('xhs.comment.post');
      l2.close();
    } finally {
      tmp.dispose();
    }
  });

  it('既有 dev 库升级（bare）：v2 清未改动旧种子→重种新构架 f1（7 节点）；改动面/用户数据不动；f5~f9 载体未就位暂缓', () => {
    const tmp = makeTempDb();
    try {
      buildLegacyDb(engine, tmp.dir);
      const layer = new StorageLayer(engine);
      layer.open(tmp.dir); // v2 应用→seed 按缺补种（bare 面）

      const versions = (
        layer.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
          version: number;
        }>
      ).map((r) => r.version);
      expect(versions).toEqual([1, 2]);
      // f1 刷新为新构架（demo 7 节点）＋新名
      expect(counts(layer)).toEqual({ flows: 6, versions: 7, definitions: 12, library: 1 }); // flows=f1(新)+f2/f3/f4(软)/f6(旧)+u1
      const f1 = layer.connection
        .prepare("SELECT name, (SELECT COUNT(*) FROM nodes WHERE flow_id = 'f1') AS n FROM flows WHERE id = 'f1'")
        .get() as { name: string; n: number };
      expect(f1).toEqual({ name: '商品价格监控', n: 7 });
      // 改动面保留（旧形 1 节点）＋flag 在位
      expect(
        (layer.connection.prepare("SELECT COUNT(*) AS c FROM nodes WHERE flow_id = 'f2'").get() as { c: number }).c,
      ).toBe(1);
      expect(
        (layer.connection.prepare("SELECT COUNT(*) AS c FROM flows WHERE id = 'f4' AND soft_del = 1").get() as { c: number })
          .c,
      ).toBe(1);
      expect(
        (layer.connection.prepare("SELECT name FROM flows WHERE id = 'f6'").get() as { name: string }).name,
      ).toBe('我的备份');
      const flags = (
        layer.connection.prepare('SELECT flow_id FROM seed_flags ORDER BY flow_id').all() as Array<{
          flow_id: string;
        }>
      ).map((r) => r.flow_id);
      expect(flags).toEqual(['f1', 'f2', 'f3', 'f4', 'f6']); // f5/f7/f8/f9 flag 已清（bare 待载体）
      // 用户数据不动（settings/u1/library——library 行不因 v2 清空 flag 被误判首启重插）
      expect(layer.connection.prepare("SELECT value FROM settings WHERE key = 'snap'").get()).toMatchObject({
        value: 'true',
      });
      expect(
        (layer.connection.prepare("SELECT COUNT(*) AS c FROM flows WHERE id = 'u1'").get() as { c: number }).c,
      ).toBe(1);
      expect(
        (layer.connection.prepare('SELECT COUNT(*) AS c FROM library_entries').get() as { c: number }).c,
      ).toBe(1);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('既有 dev 库升级·9 流全未改动（v2 清空全部 flag）：不误判首启——library 不重插（固定 id 撞主键回归）、f1~f4 重种新构架', () => {
    const tmp = makeTempDb();
    try {
      buildLegacyDb(engine, tmp.dir);
      // 撤销改动面四态 → 9 流全部「未改动」（v2 将清空全部 flag——firstBoot 误判触发面）
      const conn = engine.open(path.join(tmp.dir, 'constella.db'));
      conn.prepare("DELETE FROM flow_versions WHERE id = 'f2-v1'").run();
      conn.prepare("DELETE FROM runs WHERE id = 'r1'").run();
      conn.prepare("UPDATE flows SET soft_del = 0 WHERE id = 'f4'").run();
      conn.prepare("UPDATE flows SET name = '示例·旧6', updated_at = 1 WHERE id = 'f6'").run();
      conn.close();

      const layer = new StorageLayer(engine);
      expect(() => layer.open(tmp.dir)).not.toThrow(); // 修正前：library 固定 id 重插撞主键
      expect(
        (layer.connection.prepare('SELECT COUNT(*) AS c FROM library_entries').get() as { c: number }).c,
      ).toBe(1); // 既有行原样，零重插
      expect(counts(layer)).toEqual({ flows: 5, versions: 5, definitions: 12, library: 1 }); // f1~f4 新构架＋u1
      expect(
        (layer.connection.prepare("SELECT COUNT(*) AS c FROM nodes WHERE flow_id = 'f1'").get() as { c: number }).c,
      ).toBe(7);
      layer.close();
    } finally {
      tmp.dispose();
    }
  });

  it('既有 dev 库升级（挂点预装）：9 流新构架全量＋definitions=22＋asset_packages=10；f7 恢复（MA-3 名实）', async () => {
    const tmp = makeTempDb();
    try {
      buildLegacyDb(engine, tmp.dir);
      const installed: number[] = [];
      const layer = openWithExamples(engine, tmp, installed);
      await layer.opened;
      expect(installed).toEqual([10]);
      const one = (sql: string): number => (layer.connection.prepare(sql).get() as { c: number }).c;
      expect(one('SELECT COUNT(*) AS c FROM asset_packages')).toBe(10);
      expect(one('SELECT COUNT(*) AS c FROM node_definitions')).toBe(22);
      // 未改动旧种子全部刷新为新构架（f1=7/f7=5 节点）；改动面保留旧形（f2=1 节点）
      expect(one("SELECT COUNT(*) AS c FROM nodes WHERE flow_id = 'f1'")).toBe(7);
      expect(one("SELECT COUNT(*) AS c FROM nodes WHERE flow_id = 'f7'")).toBe(5);
      expect(one("SELECT COUNT(*) AS c FROM nodes WHERE flow_id = 'f2'")).toBe(1);
      // f7 发布评论节点参数（PRD §9 F7 行走查锚）
      const cm1 = layer.connection
        .prepare("SELECT params FROM nodes WHERE flow_id = 'f7' AND type = 'xhs.comment.post'")
        .get() as { params: string };
      expect(JSON.parse(cm1.params)).toEqual({ maxLen: 50, ratePerMin: 4 });
      layer.close();
    } finally {
      tmp.dispose();
    }
  });
});
