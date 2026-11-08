// 存储层测试基础设施（T1-01 搭骨架；C-06 §6.3 备胎契约套件 harness）。
//
// 双引擎口径：TEST_ENGINES = [主引擎（engine/sqlite-engine，P-3 收窄处）, node:sqlite 备胎]——describe.each 逐引擎
// 跑同一契约套件，DAO/组件代码零引擎分支（S-2 结论）。库文件落 os.tmpdir 临时目录，
// 用例/套件负责 dispose（先 close 连接释放 Windows 文件句柄，再递归删目录）。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DbConnection, DbEngine } from '../engine/connection';
import { SQLITE_ENGINE } from '../engine/sqlite-engine';
import { NODE_SQLITE_ENGINE } from '../engine/node-sqlite-engine';

/** 双引擎集合（§6.3：同一契约套件、零 DAO 改动） */
export const TEST_ENGINES: readonly DbEngine[] = [SQLITE_ENGINE, NODE_SQLITE_ENGINE];

/** 一次用例的临时环境：目录 + 按需开连接 + dispose() 全量清理 */
export class TempDb {
  readonly dir: string;
  private readonly conns: DbConnection[] = [];

  constructor() {
    this.dir = mkdtempSync(path.join(tmpdir(), 'constella-storage-'));
  }

  dbFile(name = 'constella.db'): string {
    return path.join(this.dir, name);
  }

  open(engine: DbEngine, name = 'constella.db'): DbConnection {
    const conn = engine.open(this.dbFile(name));
    this.conns.push(conn);
    return conn;
  }

  dispose(): void {
    for (const conn of this.conns.splice(0)) {
      try {
        conn.close();
      } catch {
        /* 已关/已坏连接忽略 */
      }
    }
    // Windows：WAL/-shm 句柄释放与删除存在竞态（EPERM/EBUSY）——rmSync 内建重试；
    // 清理是尽力而为：用例断言失败时未关连接属常态，清理错误不得掩盖原始断言（残留临时目录无害）
    try {
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* 尽力清理——残留 os.tmpdir 下随机名目录，随系统清理 */
    }
  }
}

/** 简写：用例内 `const tmp = makeTempDb()`，finally `tmp.dispose()` */
export function makeTempDb(): TempDb {
  return new TempDb();
}
