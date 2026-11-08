// SqliteEngine —— better-sqlite3 13.0.3 适配层（T1-01；TDD-C-06 §3 SqliteEngine 组件行）。
//
// P-3 收窄：本文件是 client/src 全仓唯一 `import ... from 'better-sqlite3'` 处（grep 面）。
// 二进制=prebuilds 内置（pnpm-workspace.yaml allowBuilds 白名单已就位，win32-x64.node 随包分发）。
//
// 引擎侧归一化（对上层 DAO 透明）：
//   - 行对象：better-sqlite3 已返回普通原型对象（无需处理）；
//   - BLOB：better-sqlite3 返回 Buffer（Uint8Array 子类，直接满足契约）；入参 Uint8Array
//     （非 Buffer）→ Buffer.from 转换后绑定；
//   - lastInsertRowid：number|bigint → 安全范围内归一化为 number。
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { DbConnection, DbEngine, SqliteRunResult, SqliteStmt } from './connection';

/** SQL 字符串字面量转义（单引号加倍；仅用于引擎内部生成的固定语句——路径类参数） */
function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeRunResult(r: { changes: number; lastInsertRowid: number | bigint }): SqliteRunResult {
  const rowid =
    typeof r.lastInsertRowid === 'bigint' && r.lastInsertRowid <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(r.lastInsertRowid)
      : Number.isSafeInteger(r.lastInsertRowid)
        ? (r.lastInsertRowid as number)
        : Number(r.lastInsertRowid);
  return { changes: r.changes, lastInsertRowid: rowid };
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

function normalizeRow(row: unknown): unknown {
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
    return out;
  }
  return normalizeValue(row);
}

function normalizeBindings(bindings?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (bindings === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bindings)) {
    out[k] =
      v instanceof Uint8Array && !(v instanceof Buffer) ? Buffer.from(v) : normalizeValue(v);
  }
  return out;
}

/** PRAGMA 读结果归一化：单行单列 → 标量（`PRAGMA journal_mode` 返回 {journal_mode:'wal'}） */
function normalizePragmaResult(result: unknown): unknown {
  const unwrap = (row: unknown): unknown => {
    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      const entries = Object.entries(row);
      if (entries.length === 1) return normalizeValue(entries[0]?.[1]);
    }
    return row;
  };
  if (Array.isArray(result)) {
    if (result.length === 1) return unwrap(result[0]);
    return result.map(unwrap);
  }
  return unwrap(result);
}

function wrapStmt(stmt: import('better-sqlite3').BetterSqlite3Statement): SqliteStmt {  return {
    get: (b) => normalizeRow(b === undefined ? stmt.get() : stmt.get(normalizeBindings(b) as Record<string, unknown>)),
    all: (b) => {
      const rows = b === undefined ? stmt.all() : stmt.all(normalizeBindings(b) as Record<string, unknown>);
      return rows.map(normalizeRow);
    },
    run: (b) => normalizeRunResult(b === undefined ? stmt.run() : stmt.run(normalizeBindings(b) as Record<string, unknown>)),
  };
}

/** 打开（或创建）SQLite 库文件并返回 DbConnection（C-06 §3 组件级接口） */
export function createConnection(file: string): DbConnection {
  const db = new Database(file);
  return {
    prepare: (sql) => wrapStmt(db.prepare(sql)),
    exec: (sql) => {
      db.exec(sql);
    },
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    pragma: (key, value) => {
      if (value === undefined) return normalizePragmaResult(db.pragma(key));
      db.pragma(`${key} = ${value}`);
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

/** 引擎对象（StorageLayer 构造注入用；测试双引擎套件与 better-sqlite3 主引擎共用同一实现） */
export const SQLITE_ENGINE: DbEngine = { name: 'better-sqlite3', open: createConnection };
