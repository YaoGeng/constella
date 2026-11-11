// MigrationRunner 套件（T1-02 验收；C-06 §6.1e＋双引擎；T6-18 v2 种子刷新判定面）。
// 断言面：v1 基线 15 表齐建；v1→v2 → schema_migrations 两行 + backups/pre-v2-*.db 生成；
// 重跑幂等；v2 失败整体回滚（单迁移原子）；序列非单调/历史前缀破坏抛错；备份保留 5；
// V2_SEED_REFRESH（T6-18）：未改动旧种子行全清/用户改动面（保存过·有 runs·软删·改名）
// 整流保留/幂等。
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DbConnection, DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { MIGRATIONS, V1_BASELINE, V2_SEED_REFRESH, type Migration } from './migrations';
import { migrate } from './migration-runner';

const TABLES = [
  'flows',
  'flow_versions',
  'nodes',
  'node_definitions',
  'asset_packages',
  'library_entries',
  'runs',
  'lanes',
  'node_runs',
  'logs',
  'hit_breakpoints',
  'settings',
  'seed_flags',
  'pending_publish',
  'schema_migrations',
] as const;

function tableNames(conn: DbConnection): string[] {
  const rows = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 测试用 v2：新增一张后续版本表（模拟 V1.1 增量——C-06 §8① 新表走新迁移版本） */
const V2_TEST: Migration = {
  version: 2,
  name: 'v2-test-additive',
  up: (conn) => {
    conn.exec('CREATE TABLE v2_added (id TEXT PRIMARY KEY, v INTEGER NOT NULL);');
  },
};

const V2_FAILING: Migration = {
  version: 2,
  name: 'v2-test-failing',
  up: (conn) => {
    conn.exec('CREATE TABLE v2_partial (id TEXT PRIMARY KEY);');
    throw new Error('v2 模拟失败');
  },
};

describe.each(TEST_ENGINES)('storage migrate [%s]', (engine: DbEngine) => {
  it('v1 基线：15 表全量建立 + schema_migrations 记录 v1', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      const r = migrate(conn, [V1_BASELINE]);
      expect(r).toEqual({ from: 0, to: 1, backups: [] });
      expect(tableNames(conn).sort()).toEqual([...TABLES].sort());
      const rows = conn.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>;
      expect(rows).toEqual([{ version: 1 }]);
    } finally {
      tmp.dispose();
    }
  });

  it('重跑幂等：已应用迁移零重复、零备份（发布序列 v1+v2 全量应用后重跑）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, MIGRATIONS);
      const again = migrate(conn, MIGRATIONS, { backupsDir: path.join(tmp.dir, 'backups') });
      expect(again).toEqual({ from: 2, to: 2, backups: [] });
      const count = conn.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number };
      expect(count.c).toBe(2);
    } finally {
      tmp.dispose();
    }
  });

  it('v1→v2：schema_migrations 两行 + backups/pre-v2-*.db 生成，重跑幂等（§6.1e）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, [V1_BASELINE]);
      const backupsDir = path.join(tmp.dir, 'backups');
      mkdirSync(backupsDir, { recursive: true });
      const r = migrate(conn, [V1_BASELINE, V2_TEST], { backupsDir });
      expect(r.from).toBe(1);
      expect(r.to).toBe(2);
      expect(r.backups).toHaveLength(1);
      expect(r.backups[0]).toMatch(/^pre-v2-\d{8}T\d{6}Z\.db$/);
      const rows = conn.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>;
      expect(rows).toEqual([{ version: 1 }, { version: 2 }]);
      const files = readdirSync(backupsDir);
      expect(files).toContain(r.backups[0]);
      // 备份文件是可打开的库快照（v2 表尚未存在于备份内——备份时点=应用 v2 前）
      const bak = engine.open(path.join(backupsDir, r.backups[0] as string));
      try {
        const bakTables = tableNames(bak);
        expect(bakTables).toContain('flows');
        expect(bakTables).not.toContain('v2_added');
      } finally {
        bak.close();
      }
      // 重跑幂等
      const again = migrate(conn, [V1_BASELINE, V2_TEST], { backupsDir });
      expect(again.backups).toEqual([]);
    } finally {
      tmp.dispose();
    }
  });

  it('v2 失败整体回滚：v2 表不残留、schema_migrations 仍只 v1、可重试成功', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, [V1_BASELINE]);
      expect(() => migrate(conn, [V1_BASELINE, V2_FAILING])).toThrow('v2 模拟失败');
      expect(tableNames(conn)).not.toContain('v2_partial');
      const rows = conn.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
      expect(rows).toEqual([{ version: 1 }]);
      // 修复后重试成功
      const r = migrate(conn, [V1_BASELINE, V2_TEST]);
      expect(r.to).toBe(2);
    } finally {
      tmp.dispose();
    }
  });

  it('序列版本非单调 / 库内历史与序列不一致 → 抛错', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      expect(() => migrate(conn, [V1_BASELINE, { ...V1_BASELINE, version: 1, name: 'dup' }])).toThrow(
        /单调递增/,
      );
      migrate(conn, [V1_BASELINE]);
      // 模拟已发布迁移被删：序列只剩 v2
      expect(() => migrate(conn, [V2_TEST])).toThrow(/不一致/);
    } finally {
      tmp.dispose();
    }
  });

  it('备份保留 5 份：超限最旧清理', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      const backupsDir = path.join(tmp.dir, 'backups');
      mkdirSync(backupsDir, { recursive: true });
      migrate(conn, [V1_BASELINE]);
      // 预置 5 份旧备份
      for (let i = 1; i <= 5; i += 1) {
        writeFileSync(path.join(backupsDir, `pre-v9-2020010${i}T000000Z.db`), 'x');
      }
      const r = migrate(conn, [V1_BASELINE, V2_TEST], { backupsDir });
      const files = readdirSync(backupsDir).sort();
      expect(files).toHaveLength(5);
      expect(files).toContain(r.backups[0]); // 新备份保留
      expect(files).not.toContain('pre-v9-20200101T000000Z.db'); // 最旧（时间戳序）被清
    } finally {
      tmp.dispose();
    }
  });

  it('首启空库：v1 零备份；v2 按「本次已应用过迁移（库已非空）」冻结规则取 pre-v2 备份', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      const backupsDir = path.join(tmp.dir, 'backups');
      const r = migrate(conn, MIGRATIONS, { backupsDir });
      // v1（首项、无历史）不备份；v2 时本次运行已应用过 v1=库已非空（T1-02 冻结规则）
      expect(r.backups).toHaveLength(1);
      expect(r.backups[0]).toMatch(/^pre-v2-\d{8}T\d{6}Z\.db$/);
    } finally {
      tmp.dispose();
    }
  });
});

// 双引擎之外的一致性守卫：发布序列=v1 基线＋v2 种子刷新（T6-18 后发布面）
describe('storage migrate [migration list]', () => {
  it('发布序列当前含 v1 基线＋v2 种子刷新（单调 [1,2]）', () => {
    expect(MIGRATIONS).toHaveLength(2);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2]);
    expect(MIGRATIONS[1]?.name).toBe(V2_SEED_REFRESH.name);
  });
});

// ————————————————————————————————————————————
// V2_SEED_REFRESH（T6-18；数据迁移形态 PM 追认 2026-11-11）判定面
// ————————————————————————————————————————————

/** 旧种子形夹具：v1 库＋f1~f9 各 1 节点旧构架行（`<fid>-v0` 版本＋flag）＋内置定义 1 枚 */
function buildLegacySeed(conn: DbConnection): void {
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
}

function countRows(conn: DbConnection, table: string, where = ''): number {
  return (conn.prepare(`SELECT COUNT(*) AS c FROM ${table}${where}`).get() as { c: number }).c;
}

describe.each(TEST_ENGINES)('storage migrate v2 种子刷新 [%s]', (engine: DbEngine) => {
  it('未改动旧种子行全清：flows/nodes/flow_versions/seed_flags 九流零残留；schema_migrations=[1,2]；v1 DDL 零变化', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, [V1_BASELINE]);
      buildLegacySeed(conn);
      const r = migrate(conn, [V1_BASELINE, V2_SEED_REFRESH]);
      expect(r).toMatchObject({ from: 1, to: 2 });
      expect(countRows(conn, 'flows')).toBe(0);
      expect(countRows(conn, 'nodes')).toBe(0);
      expect(countRows(conn, 'flow_versions')).toBe(0);
      expect(countRows(conn, 'seed_flags')).toBe(0);
      const versions = conn.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>;
      expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
      // v1 表集零变化（数据迁移形态——无 DDL 增删）
      expect(tableNames(conn).sort()).toEqual([...TABLES].sort());
    } finally {
      tmp.dispose();
    }
  });

  it('用户改动面整流保留：保存过（版本栈>1）/有 runs/软删/改名（updated_at≠created_at）的流＋flag 原样', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, [V1_BASELINE]);
      buildLegacySeed(conn);
      // f2：用户保存过（追加版本行）
      conn
        .prepare(
          "INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES ('f2-v1', 'f2', '手动保存', 1, 0, '{}', 2)",
        )
        .run();
      // f3：有 run 历史（FK 引用 nodes/flows——历史保留优先于刷新）
      conn
        .prepare("INSERT INTO runs (id, flow_id, name, status, t0, created_at) VALUES ('r1', 'f3', '旧run', 'done', 1, 1)")
        .run();
      // f4：用户软删（flows.delete=软删——不复活）
      conn.prepare("UPDATE flows SET soft_del = 1 WHERE id = 'f4'").run();
      // f6：用户改名（rename 推 updated_at）
      conn.prepare("UPDATE flows SET name = '我的备份', updated_at = 2 WHERE id = 'f6'").run();
      // u1：用户自建流（非种子面）
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

      migrate(conn, [V1_BASELINE, V2_SEED_REFRESH]);

      // 未改动 f1/f5/f7/f8/f9 → 清
      for (const gone of ['f1', 'f5', 'f7', 'f8', 'f9']) {
        expect(countRows(conn, 'flows', ` WHERE id = '${gone}'`)).toBe(0);
        expect(countRows(conn, 'seed_flags', ` WHERE flow_id = '${gone}'`)).toBe(0);
      }
      // 改动面 → 整流保留（行＋flag）
      expect(countRows(conn, 'flows', " WHERE id = 'f2'")).toBe(1);
      expect(countRows(conn, 'flow_versions', " WHERE flow_id = 'f2'")).toBe(2);
      expect(countRows(conn, 'flows', " WHERE id = 'f3'")).toBe(1);
      expect(countRows(conn, 'nodes', " WHERE flow_id = 'f3'")).toBe(1); // run FK 依赖的 nodes 不删
      expect(countRows(conn, 'flows', " WHERE id = 'f4' AND soft_del = 1")).toBe(1);
      expect(countRows(conn, 'flows', " WHERE id = 'f6'")).toBe(1);
      for (const kept of ['f2', 'f3', 'f4', 'f6']) {
        expect(countRows(conn, 'seed_flags', ` WHERE flow_id = '${kept}'`)).toBe(1);
      }
      // 用户流零触碰
      expect(countRows(conn, 'flows', " WHERE id = 'u1'")).toBe(1);
    } finally {
      tmp.dispose();
    }
  });

  it('v2 幂等：重跑零行变化（untouched 集已空）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, [V1_BASELINE]);
      buildLegacySeed(conn);
      migrate(conn, [V1_BASELINE, V2_SEED_REFRESH]);
      const before = [
        countRows(conn, 'flows'),
        countRows(conn, 'nodes'),
        countRows(conn, 'flow_versions'),
        countRows(conn, 'seed_flags'),
      ];
      migrate(conn, [V1_BASELINE, V2_SEED_REFRESH]);
      expect([
        countRows(conn, 'flows'),
        countRows(conn, 'nodes'),
        countRows(conn, 'flow_versions'),
        countRows(conn, 'seed_flags'),
      ]).toEqual(before);
    } finally {
      tmp.dispose();
    }
  });
});
