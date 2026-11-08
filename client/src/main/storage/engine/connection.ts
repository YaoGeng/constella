// DbConnection 契约（TDD-C-06 §1 main 半段代码段；T1-01 交付）。
//
// 全部存储组件（MigrationRunner/SeedsRunner/DAO×N/SavePipeline）只面向本接口编程；
// 具体引擎（SqliteEngine=better-sqlite3 13.0.3；备胎 NodeSqliteEngine=node:sqlite）在
// engine/ 内各自实现，备胎差异（手写 BEGIN/COMMIT/ROLLBACK、BLOB Uint8Array、null-prototype
// 行归一化）全部吸收在引擎适配层——DAO 层零引擎分支（C-06 §6.3 备胎契约）。
//
// 事务原子性机制（C-06 §1 注记；S-2 ②；02 §13.1）：transaction(fn) 在 fn 抛错时自动回滚并重抛
// ——better-sqlite3 由 db.transaction 包装保证；node:sqlite 由适配层手写 ROLLBACK 保证。
//
// 与 C-06 §1 代码段签名的差异（超集，均为实现必需）：
//   - close()：factoryReset（删库重连）与测试清理需要显式关连接释放 Windows 文件句柄；
//   - 备份实现=VACUUM INTO（两引擎同为 SQLite 3.5x，同步完成；better-sqlite3 的 db.backup
//     返回 Promise，与同步 open()/migrate() 装配序不兼容）——备份文件为库全量一致快照。
/** 单语句执行结果（run 专用；lastInsertRowid 归一化为 number——两引擎可能给 bigint） */
export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number;
}

/** 预编译语句（行参绑定统一用具名参数 `:name` + 对象绑定——两引擎共同支持的最小交集） */
export interface SqliteStmt {
  /** 命中一行 → 行对象（普通原型）；无命中 → undefined */
  get(bindings?: Record<string, unknown>): unknown;
  /** 全部命中行（普通原型对象数组） */
  all(bindings?: Record<string, unknown>): unknown[];
  /** 写语句；返回受影响行数与最后插入 rowid */
  run(bindings?: Record<string, unknown>): SqliteRunResult;
}

/**
 * SQLite 连接薄适配（C-06 §1 `interface DbConnection`）。
 * SqliteEngine 与 NodeSqliteEngine 各自实现；StorageLayer 经引擎注入持有（§8 替换点收窄）。
 */
export interface DbConnection {
  prepare(sql: string): SqliteStmt;
  exec(sql: string): void;
  /** 事务：fn 抛错自动回滚并重抛（02 §13.1 原子性机制；S-2 ②） */
  transaction<T>(fn: () => T): T;
  /** PRAGMA 读写；无 value=读（返回标量或单行值），有 value=写 */
  pragma(key: string, value?: string | number): unknown;
  /** 全量一致备份到 destPath（VACUUM INTO；目标存在则先删除） */
  backup(destPath: string): void;
  close(): void;
}

/** 引擎工厂（C-06 §3 SqliteEngine 组件行 `createConnection(file): DbConnection` 的对象化包装，供装配注入） */
export interface DbEngine {
  readonly name: string;
  open(file: string): DbConnection;
}
