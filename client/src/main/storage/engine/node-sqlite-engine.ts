// NodeSqliteEngine —— node:sqlite 备胎适配层（T1-05 成套；S-2 两组差异吸收；C-06 §6.3/§8）。
//
// 定位：better-sqlite3 的零原生依赖替换位（03 §1 替换点登记表「存储引擎」行）。数据文件与
// better-sqlite3 互通（同为 SQLite 3.5x 文件格式）；同一 DbConnection 契约，DAO 层零改动。
//
// S-2 两组差异的手写吸收面：
//   ① node:sqlite 无事务包装 API —— 手写 BEGIN/COMMIT/ROLLBACK（嵌套用 SAVEPOINT，
//      对齐 better-sqlite3 db.transaction 语义：fn 抛错回滚并重抛）；
//   ② BLOB 走 Uint8Array —— node:sqlite 原生即 Uint8Array（契约直接满足）；另吸收两组
//      引擎差异：行对象为 null 原型（归一化为普通对象，供 deep equal/结构化克隆）与
//      大整数可能以 bigint 返回（安全范围内归一化为 number）。
//
// 注：node:sqlite 在 Node 24 标记 experimental（import 触发 ExperimentalWarning），备胎口径可接受。
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSync as NodeSqliteDatabase, StatementSync } from 'node:sqlite';
import type { DbConnection, DbEngine, SqliteRunResult, SqliteStmt } from './connection';

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

/** node:sqlite 行为 [Object: null prototype] —— 归一化为普通对象（键逐一拷贝） */
function normalizeRow(row: unknown): unknown {
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
    return out;
  }
  return normalizeValue(row);
}

/** 具名绑定窄化（Record<string,unknown> → node:sqlite SQLInputValue 形——运行时同构） */
type NamedBindings = Record<string, import('node:sqlite').SQLInputValue>;

function wrapStmt(stmt: StatementSync): SqliteStmt {
  return {
    get: (b) => normalizeRow(b === undefined ? stmt.get() : stmt.get(b as NamedBindings)),
    all: (b) => {
      const rows = b === undefined ? stmt.all() : stmt.all(b as NamedBindings);
      return rows.map(normalizeRow);
    },
    run: (b) => {
      const r = b === undefined ? stmt.run() : stmt.run(b as NamedBindings);
      return normalizeRunResult(r);
    },
  };
}

function normalizeRunResult(r: { changes: number | bigint; lastInsertRowid: number | bigint }): SqliteRunResult {
  const toNum = (v: number | bigint): number =>
    typeof v === 'bigint' ? Number(v) : Number.isSafeInteger(v) ? v : Number(v);
  return { changes: toNum(r.changes), lastInsertRowid: toNum(r.lastInsertRowid) };
}

function createTransaction(db: NodeSqliteDatabase): <T>(fn: () => T) => T {
  let depth = 0;
  return function runTransaction<T>(fn: () => T): T {
    const outermost = depth === 0;
    db.exec(outermost ? 'BEGIN' : `SAVEPOINT sp_${depth}`);
    depth += 1;
    try {
      const result = fn();
      depth -= 1;
      db.exec(outermost ? 'COMMIT' : `RELEASE sp_${depth}`);
      return result;
    } catch (err) {
      depth -= 1;
      // 回滚失败不应掩盖原始异常（连接已坏时 ROLLBACK 可能再抛）
      try {
        db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO sp_${depth}`);
      } catch {
        /* 尽力回滚；原始错误优先重抛 */
      }
      throw err;
    }
  };
}

/** 打开（或创建）SQLite 库文件并返回 DbConnection（与 SqliteEngine 同一契约） */
export function createNodeConnection(file: string): DbConnection {
  const db: NodeSqliteDatabase = new DatabaseSync(file);
  const runTransaction = createTransaction(db);
  return {
    prepare: (sql) => wrapStmt(db.prepare(sql)),
    exec: (sql) => {
      db.exec(sql);
    },
    transaction: runTransaction,
    pragma: (key, value) => {
      if (value === undefined) {
        const row = db.prepare(`PRAGMA ${key}`).get() as Record<string, unknown> | undefined;
        if (row === undefined) return undefined;
        const first = Object.values(row)[0];
        return normalizeValue(first);
      }
      db.exec(`PRAGMA ${key} = ${value}`);
      return undefined;
    },
    backup: (destPath) => {
      rmSync(destPath, { force: true });
      db.exec(`VACUUM INTO ${quoteSqlString(destPath)}`);
    },
    close: () => {
      db.close();
    },
  };
}

/** 备胎引擎对象（双引擎契约套件 describe.each 消费；与 SQLITE_ENGINE 同接口） */
export const NODE_SQLITE_ENGINE: DbEngine = { name: 'node:sqlite', open: createNodeConnection };
