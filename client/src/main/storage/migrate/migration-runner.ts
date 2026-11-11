// MigrationRunner —— schema_migrations 版本化增量迁移（T1-02；02 §13.3）。
//
// 职责：单调应用未执行迁移；每次应用前自动备份（backups/pre-v<N>-<date>.db，保留最近 5 份
// 设计值）；重跑幂等（已应用跳过）；已发布迁移禁改/禁删（历史校验：库内 applied 集必须是
// 迁移序列的前缀）。
//
// 备份时点规则：仅当库已有迁移历史（applied 非空）才备份——首启空库应用 v1 无数据可失；
// v1→v2 级联升级时在应用 v2 前生成 pre-v2-<date>.db（§6.1e 断言面）。
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DbConnection } from '../engine/connection';
import type { Migration } from './migrations';

export interface MigrateOptions {
  /** 备份目录（默认不备份；StorageLayer.open 传 userData/backups） */
  backupsDir?: string;
  /** 备份保留份数（设计值 5，02 §13.3） */
  keepBackups?: number;
}

export interface MigrationRunResult {
  from: number;
  to: number;
  /** 本次实际产生的备份文件名（按应用序） */
  backups: string[];
}

/** 迁移序列完整性：版本号严格单调递增 */
export function assertMigrationList(migrations: readonly Migration[]): void {
  let prev = 0;
  for (const m of migrations) {
    if (m.version <= prev) {
      throw new Error(`迁移序列版本非单调递增：v${m.version}（前值 v${prev}）`);
    }
    if (!Number.isInteger(m.version)) throw new Error(`迁移版本必须为整数：v${m.version}`);
    prev = m.version;
  }
}

function listApplied(conn: DbConnection): number[] {
  // schema_migrations 由 v1 基线创建——未建表（首启空库）视为无历史
  const row = conn
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { c: number };
  if (row.c === 0) return [];
  const rows = conn.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
    version: number;
  }>;
  return rows.map((r) => r.version);
}

/** 历史一致性：库内 applied 必须是迁移序列的前缀（已发布迁移禁删禁改序） */
function assertAppliedPrefix(applied: number[], migrations: readonly Migration[]): void {
  for (let i = 0; i < applied.length; i += 1) {
    const m = migrations[i];
    const a = applied[i];
    if (m === undefined || m.version !== a) {
      throw new Error(
        `迁移历史与序列不一致：库内已应用第 ${i + 1} 个版本为 v${a}，序列期望 v${m?.version ?? '（缺失）'}——已发布迁移禁改/禁删`,
      );
    }
  }
}

function backupFileName(version: number, now: Date): string {
  const iso = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate(),
  ).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(
    now.getUTCSeconds(),
  ).padStart(2, '0')}Z`;
  return `pre-v${version}-${iso}.db`;
}

const BACKUP_NAME_RE = /^pre-v(\d+)-(\d{8}T\d{6}Z)\.db$/;

/** 备份排序键：(时间戳, 版本)——按文件名整串排序会把 v9-旧日期排在 v2-新日期后，不可用 */
function backupSortKey(name: string): string {
  const m = BACKUP_NAME_RE.exec(name);
  if (m === null) return '';
  return `${m[2]}-v${String(m[1]).padStart(6, '0')}`;
}

/** 备份保留清理：目录内 pre-v*.db 按（时间戳, 版本）新→旧，超出保留数删最旧 */
function pruneBackups(backupsDir: string, keep: number): void {
  let entries: string[];
  try {
    entries = readdirSync(backupsDir);
  } catch {
    return; // 目录不存在视为无历史备份
  }
  const backups = entries
    .filter((n) => BACKUP_NAME_RE.test(n))
    .sort((a, b) => backupSortKey(a).localeCompare(backupSortKey(b)));
  while (backups.length > keep) {
    const oldest = backups.shift();
    if (oldest === undefined) break;
    rmSync(path.join(backupsDir, oldest), { force: true });
  }
}

/**
 * 应用全部待执行迁移（幂等）。
 * 每个迁移在单事务内执行 DDL 并写 schema_migrations；失败整体回滚该迁移。
 */
export function migrate(
  conn: DbConnection,
  migrations: readonly Migration[],
  opts: MigrateOptions = {},
): MigrationRunResult {
  assertMigrationList(migrations);
  const applied = listApplied(conn);
  assertAppliedPrefix(applied, migrations);

  const appliedSet = new Set(applied);
  const keep = opts.keepBackups ?? 5;
  const backups: string[] = [];
  // 备份目录就位（T6-18 修复：v2 入序列后首启也会走到备份位——VACUUM INTO 不建目录，
  // 此前单迁移首启永不触发备份路径未暴露；runner 自持备份面，目录归此处创建）
  if (opts.backupsDir !== undefined) mkdirSync(opts.backupsDir, { recursive: true });
  const fromVersion = applied.length > 0 ? (applied[applied.length - 1] as number) : 0;
  let current = fromVersion;
  let alreadyApplied = false;

  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;
    // 迁移前自动备份（02 §13.3）——库内已有历史或本次运行已应用过迁移（库已非空）才备份
    if (fromVersion > 0 || alreadyApplied) {
      if (opts.backupsDir !== undefined) {
        const name = backupFileName(m.version, new Date());
        conn.backup(path.join(opts.backupsDir, name));
        backups.push(name);
        pruneBackups(opts.backupsDir, keep);
      }
    }
    conn.transaction(() => {
      m.up(conn);
      conn
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (:version, :at)')
        .run({ version: m.version, at: Date.now() });
    });
    current = m.version;
    alreadyApplied = true;
  }
  return { from: fromVersion, to: current, backups };
}
