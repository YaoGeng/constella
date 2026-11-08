// MigrationRunner 套件（T1-02 验收；C-06 §6.1e＋双引擎）。
// 断言面：v1 基线 15 表齐建；v1→v2 → schema_migrations 两行 + backups/pre-v2-*.db 生成；
// 重跑幂等；v2 失败整体回滚（单迁移原子）；序列非单调/历史前缀破坏抛错；备份保留 5。
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DbConnection, DbEngine } from '../engine/connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';
import { MIGRATIONS, V1_BASELINE, type Migration } from './migrations';
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
      const r = migrate(conn, MIGRATIONS);
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

  it('重跑幂等：已应用迁移零重复、零备份', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      migrate(conn, MIGRATIONS);
      const again = migrate(conn, MIGRATIONS, { backupsDir: path.join(tmp.dir, 'backups') });
      expect(again).toEqual({ from: 1, to: 1, backups: [] });
      const count = conn.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number };
      expect(count.c).toBe(1);
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

  it('首启空库应用 v1 不产生备份（无数据可失）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      const backupsDir = path.join(tmp.dir, 'backups');
      const r = migrate(conn, MIGRATIONS, { backupsDir });
      expect(r.backups).toEqual([]);
    } finally {
      tmp.dispose();
    }
  });
});

// 双引擎之外的一致性守卫：V1_BASELINE 就是 MIGRATIONS 唯一成员（发布面）
describe('storage migrate [migration list]', () => {
  it('发布序列当前仅含 v1 基线', () => {
    expect(MIGRATIONS).toHaveLength(1);
    expect(MIGRATIONS[0]?.version).toBe(1);
  });
});
