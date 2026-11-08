// StorageLayer —— 客户端唯一 SQLite 持久层装配根（T1-03 装配序；T1-07 收口 dao/save/ops）。
//
// open 装配序（卡面冻结）：open→PRAGMA(WAL,foreign_keys)→migrate（迁移前自动备份）→
//   preloadExamples 注入挂点（空实现缺省——ExamplePreloader 随 P5 C-08；触发时点=迁移完成后、
//   种子流程写入前，M4 裁决 2/#11：示例定义先于种子流程落库满足 FK 时序）→seed→ensureInitialVersions。
//
// 引擎注入（§8 替换点收窄）：constructor(engine: DbEngine)——主引擎（engine/sqlite-engine，P-3
// 收窄处=client/src 唯一原生库 import）、备胎
// node:sqlite 同接口可换（§6.3 备胎契约）。factoryReset=危险 op 编排（§1 settings 行）：
// 删库（含 -wal/-shm sidecar）→重迁→重种；node-types/sandbox/backups 目录清理与 app 重启归
// C-M1（P4），本层不做。
//
// 面向消费方：ops=StorageOpsRegistry（C-M1 StorageService 的 storage:invoke handler 消费，
// P4 接线）；dao=main 内部面（lanes/assetPackages/pendingPublish 供 main 侧 handler 直调）。
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DbConnection, DbEngine } from './engine/connection';
import { MIGRATIONS } from './migrate/migrations';
import { migrate } from './migrate/migration-runner';
import { ensureInitialVersions, seed } from './migrate/seeds-runner';
import { createStorageDao, type StorageDao } from './dao';
import { SavePipeline } from './save/save-pipeline';
import { StorageOpsRegistry } from './ops/storage-ops-registry';

/** open 选项（preloadExamples：C-08 ExamplePreloader 注入位——P5 波接线） */
export interface StorageLayerOptions {
  preloadExamples?: () => void | Promise<void>;
}

export const DB_FILE_NAME = 'constella.db';

export class StorageLayer {
  private conn: DbConnection | undefined;
  private userDataDir: string | undefined;
  private openedPromise: Promise<void> | null = null;
  /** main 内部面（不进 IPC 白名单；lanes/assetPackages/pendingPublish 直调） */
  readonly dao: StorageDao;
  readonly save: SavePipeline;
  /** renderer 面 op 白名单（C-M1 storage:invoke handler 消费——P4 接线） */
  readonly ops: StorageOpsRegistry;

  constructor(
    private readonly engine: DbEngine,
    private readonly opts: { dbFileName?: string } = {},
  ) {
    // ConnGetter 闭包：factoryReset 换连接后 DAO/SavePipeline 自动跟随（零重建）
    const getConn = (): DbConnection => this.connection;
    this.dao = createStorageDao(getConn);
    this.save = new SavePipeline(getConn);
    this.ops = new StorageOpsRegistry({ dao: this.dao, save: this.save, factoryReset: () => this.factoryReset() });
  }

  private get dbFile(): string {
    const dir = this.userDataDir;
    if (dir === undefined || this.conn === undefined) {
      throw new Error('StorageLayer 未 open——先调用 open(userDataDir)');
    }
    return path.join(dir, this.opts.dbFileName ?? DB_FILE_NAME);
  }

  /** 当前连接（open 后可用；测试与 main 内部组件消费） */
  get connection(): DbConnection {
    const conn = this.conn;
    if (conn === undefined) throw new Error('StorageLayer 未 open——先调用 open(userDataDir)');
    return conn;
  }

  get isOpen(): boolean {
    return this.conn !== undefined;
  }

  /** preloadExamples 为异步时的收尾 Promise（种子链随之延后；同步钩子立即完成、此处为 null） */
  get opened(): Promise<void> | null {
    return this.openedPromise;
  }

  /** 打开并装配（重复 open 抛错防双连接） */
  open(userDataDir: string, opts?: StorageLayerOptions): void {
    if (this.conn !== undefined) throw new Error('StorageLayer 已 open（单连接层，勿重复打开）');
    mkdirSync(userDataDir, { recursive: true });
    this.userDataDir = userDataDir;
    const conn = this.engine.open(this.dbFileFor(userDataDir));
    this.conn = conn;
    try {
      conn.pragma('journal_mode', 'WAL');
      conn.pragma('foreign_keys', 'ON');
      migrate(conn, MIGRATIONS, { backupsDir: path.join(userDataDir, 'backups') });

      // preloadExamples 挂点：迁移完成后、种子流程写入前（M4 裁决 2/#11）。
      // 异步钩子（C-08 正式形态）→ 种子链挂到 Promise 后微任务执行，保序不阻塞 open；
      // 同步/缺省（本波空实现）→ 立即落种子。
      const finish = (): void => {
        seed(conn);
        ensureInitialVersions(conn);
      };
      const hook = opts?.preloadExamples?.();
      if (hook !== undefined && typeof (hook as Promise<void>).then === 'function') {
        this.openedPromise = Promise.resolve(hook).then(() => {
          finish();
        });
      } else {
        finish();
      }
    } catch (err) {
      // 装配失败即弃用连接，避免半开状态
      this.conn = undefined;
      try {
        conn.close();
      } catch {
        /* 尽力关闭 */
      }
      throw err;
    }
  }

  /** 恢复出厂（A-14.3 危险 op 编排）：删库→重迁→重种；目录清理/app 重启归 C-M1 */
  factoryReset(): void {
    const file = this.dbFile;
    const conn = this.conn;
    if (conn !== undefined) {
      conn.close();
      this.conn = undefined;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${file}${suffix}`, { force: true });
    }
    const fresh = this.engine.open(file);
    this.conn = fresh;
    fresh.pragma('journal_mode', 'WAL');
    fresh.pragma('foreign_keys', 'ON');
    migrate(fresh, MIGRATIONS);
    seed(fresh);
    ensureInitialVersions(fresh);
  }

  close(): void {
    const conn = this.conn;
    this.conn = undefined;
    if (conn !== undefined) conn.close();
  }

  private dbFileFor(userDataDir: string): string {
    return path.join(userDataDir, this.opts.dbFileName ?? DB_FILE_NAME);
  }
}
