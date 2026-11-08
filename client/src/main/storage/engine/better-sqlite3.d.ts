// better-sqlite3 13.0.3 的最小环境类型声明（T1-01）。
//
// 为什么自带声明：better-sqlite3 13.x npm 包不附 d.ts，@types/better-sqlite3 未随 P1 依赖就位
// （client/package.json 冻结，禁 pnpm add）——按 P-3 收窄原则，声明与唯一 import 一起收在
// engine/ 目录内（`grep -rln "better-sqlite3" client/src` ⊆ client/src/main/storage/engine/）。
// 只声明 StorageLayer 实际用到的 API 面；更全签名升级 @types 时随 PM 处理。
declare module 'better-sqlite3' {
  export interface BetterSqlite3Statement {
    get(...anonymousParameters: unknown[]): unknown;
    get(namedParameters: Record<string, unknown>): unknown;
    all(...anonymousParameters: unknown[]): unknown[];
    all(namedParameters: Record<string, unknown>): unknown[];
    run(...anonymousParameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    run(
      namedParameters: Record<string, unknown>,
    ): { changes: number; lastInsertRowid: number | bigint };
  }

  export interface BetterSqlite3Database {
    prepare(sql: string): BetterSqlite3Statement;
    exec(sql: string): BetterSqlite3Database;
    /** 传参形如 'journal_mode = WAL'；无值形如 'journal_mode' 返回查询结果 */
    pragma(pragma: string, value?: unknown): unknown;
    /** 返回包装函数：调用即开事务，fn 抛错自动回滚并重抛（嵌套走 SAVEPOINT） */
    transaction<F extends (...args: never[]) => unknown>(fn: F): F;
    close(): void;
    open: boolean;
  }

  export interface BetterSqlite3Constructor {
    new (
      filename: string,
      options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        timeout?: number;
        verbose?: (message: unknown, ...args: unknown[]) => void;
      },
    ): BetterSqlite3Database;
  }

  const Database: BetterSqlite3Constructor;
  export default Database;
}
