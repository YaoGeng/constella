// PendingPublishDao（T1-05；C-06 §1 publish ⚠ 域；02 §1.3/§7.1 pending_publish）。
// 离线待发布队列：queue/list/remove；幂等键=内容 SHA-256 存 meta（checksum 字段——
// 同 checksum 重复入队幂等复用，02 §1.3）。消费方=C-09 Publisher（P5）。
import type { PendingPublishItem, PendingPublishMeta } from '@constella/shared/ipc';
import { fromJson, newId, now, type ConnGetter } from './dao-error';

interface PendingRow {
  id: string;
  meta: string;
  file_path: string;
  created_at: number;
}

function rowToItem(r: PendingRow): PendingPublishItem {
  return {
    id: r.id,
    meta:
      fromJson<PendingPublishMeta>(r.meta, `pending_publish.meta(${r.id})`) ?? {
        kind: 'node',
        name: '',
        checksum: '',
      },
    filePath: r.file_path,
    createdAt: r.created_at,
  };
}

export class PendingPublishDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 入队（meta.checksum 幂等：同 checksum 已在队→复用既有 id） */
  queue(meta: PendingPublishMeta, filePath: string): { id: string } {
    const db = this.conn();
    // 幂等键在 meta JSON 内——SQLite json_extract 走 CHECK(json_valid) 保证可查
    const existing = db
      .prepare("SELECT id FROM pending_publish WHERE json_extract(meta, '$.checksum') = :checksum")
      .get({ checksum: meta.checksum }) as { id: string } | undefined;
    if (existing !== undefined) return { id: existing.id };
    const id = newId();
    db.prepare('INSERT INTO pending_publish (id, meta, file_path, created_at) VALUES (:id, :meta, :file_path, :ts)').run(
      { id, meta: JSON.stringify(meta), file_path: filePath, ts: now() },
    );
    return { id };
  }

  list(): { items: PendingPublishItem[] } {
    const rows = this.conn()
      .prepare('SELECT id, meta, file_path, created_at FROM pending_publish ORDER BY created_at, rowid')
      .all() as unknown as PendingRow[];
    return { items: rows.map(rowToItem) };
  }

  /** 出队（幂等：不存在静默） */
  remove(id: string): void {
    this.conn().prepare('DELETE FROM pending_publish WHERE id = :id').run({ id });
  }
}
