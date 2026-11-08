// 引擎契约套件（T1-01；C-06 §6.3 备胎契约 harness 骨架——双引擎 describe.each）。
// 断言面：better-sqlite3 与 node:sqlite 对 DbConnection 契约的行为一致——
//   具名参数绑定 / exec / 事务提交与抛错回滚（02 §13.1）/ 嵌套事务 SAVEPOINT 语义 /
//   PRAGMA 读写（WAL、foreign_keys）/ backup=VACUUM INTO 全量快照 / BLOB Uint8Array 往返 /
//   行对象普通原型 + lastInsertRowid number 归一化。
import { describe, expect, it } from 'vitest';
import type { DbConnection, DbEngine } from './connection';
import { makeTempDb, TEST_ENGINES } from '../testing/harness';

function setupTable(conn: DbConnection): void {
  conn.exec(
    `CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, blob_col BLOB);
     INSERT INTO t VALUES ('seed', 41, x'0102');`,
  );
}

describe.each(TEST_ENGINES)('storage engine contract [%s]', (engine: DbEngine) => {
  it('prepare 具名参数 get/all/run 往返', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      const got = conn.prepare('SELECT id, n FROM t WHERE id = :id').get({ id: 'seed' });
      expect(got).toEqual({ id: 'seed', n: 41 });
      const all = conn.prepare('SELECT id FROM t ORDER BY id').all();
      expect(all).toEqual([{ id: 'seed' }]);
      const r = conn.prepare("INSERT INTO t (id, n) VALUES (:id, :n)").run({ id: 'a', n: 1 });
      expect(r.changes).toBe(1);
      expect(typeof r.lastInsertRowid).toBe('number');
      expect(conn.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 2 });
    } finally {
      tmp.dispose();
    }
  });

  it('exec 执行多语句 DDL/DML', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      conn.exec('CREATE TABLE a (x);\nCREATE TABLE b (y);\nINSERT INTO a VALUES (1);');
      expect(conn.prepare('SELECT COUNT(*) AS c FROM a').get()).toEqual({ c: 1 });
    } finally {
      tmp.dispose();
    }
  });

  it('transaction 提交成功', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      const out = conn.transaction(() => {
        conn.prepare("INSERT INTO t (id, n) VALUES ('tx', 1)").run();
        return 'ok';
      });
      expect(out).toBe('ok');
      expect(conn.prepare("SELECT COUNT(*) AS c FROM t WHERE id = 'tx'").get()).toEqual({ c: 1 });
    } finally {
      tmp.dispose();
    }
  });

  it('transaction 抛错自动回滚并重抛（02 §13.1 原子性机制）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      expect(() =>
        conn.transaction(() => {
          conn.prepare("INSERT INTO t (id, n) VALUES ('gone', 1)").run();
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(conn.prepare("SELECT COUNT(*) AS c FROM t WHERE id = 'gone'").get()).toEqual({ c: 0 });
    } finally {
      tmp.dispose();
    }
  });

  it('嵌套事务：内层抛错回滚到 SAVEPOINT、外层可继续提交（对齐 better-sqlite3 语义）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      conn.transaction(() => {
        conn.prepare("INSERT INTO t (id, n) VALUES ('outer', 1)").run();
        try {
          conn.transaction(() => {
            conn.prepare("INSERT INTO t (id, n) VALUES ('inner', 1)").run();
            throw new Error('inner-fail');
          });
        } catch (err) {
          expect((err as Error).message).toBe('inner-fail');
        }
      });
      expect(conn.prepare("SELECT COUNT(*) AS c FROM t WHERE id = 'outer'").get()).toEqual({ c: 1 });
      expect(conn.prepare("SELECT COUNT(*) AS c FROM t WHERE id = 'inner'").get()).toEqual({ c: 0 });
    } finally {
      tmp.dispose();
    }
  });

  it('pragma 写读：journal_mode=WAL、foreign_keys=ON（S-2 ④）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      conn.pragma('journal_mode', 'WAL');
      conn.pragma('foreign_keys', 'ON');
      expect(String(conn.pragma('journal_mode')).toLowerCase()).toBe('wal');
      expect(Number(conn.pragma('foreign_keys'))).toBe(1);
    } finally {
      tmp.dispose();
    }
  });

  it('backup 产出可独立打开的全量一致快照（VACUUM INTO）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      const dest = tmp.dbFile('snapshot.db');
      conn.backup(dest);
      const ro = engine.open(dest);
      try {
        expect(ro.prepare('SELECT id, n FROM t WHERE id = :id').get({ id: 'seed' })).toEqual({
          id: 'seed',
          n: 41,
        });
      } finally {
        ro.close();
      }
    } finally {
      tmp.dispose();
    }
  });

  it('BLOB 以 Uint8Array 往返（S-2 ② 差异吸收）', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      const bytes = new Uint8Array([10, 20, 30, 40]);
      conn.prepare('INSERT INTO t (id, n, blob_col) VALUES (:id, :n, :blob)').run({
        id: 'b1',
        n: 0,
        blob: bytes,
      });
      const row = conn.prepare('SELECT blob_col FROM t WHERE id = :id').get({ id: 'b1' }) as {
        blob_col: unknown;
      };
      expect(row.blob_col).toBeInstanceOf(Uint8Array);
      expect(Array.from(row.blob_col as Uint8Array)).toEqual([10, 20, 30, 40]);
    } finally {
      tmp.dispose();
    }
  });

  it('行对象为普通原型（null-prototype 归一化）且大整数安全归一为 number', () => {
    const tmp = makeTempDb();
    try {
      const conn = tmp.open(engine);
      setupTable(conn);
      const row = conn.prepare('SELECT id, n FROM t LIMIT 1').get() as Record<string, unknown>;
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      expect(row.n).toBe(41);
      const big = Number.MAX_SAFE_INTEGER;
      conn.prepare('INSERT INTO t (id, n) VALUES (:id, :n)').run({ id: 'big', n: big });
      const r2 = conn.prepare('SELECT n FROM t WHERE id = :id').get({ id: 'big' }) as { n: unknown };
      expect(r2.n).toBe(big);
    } finally {
      tmp.dispose();
    }
  });
});
