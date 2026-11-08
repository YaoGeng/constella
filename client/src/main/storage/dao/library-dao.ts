// LibraryDao（T1-04；C-06 §1 library 域；02 §7.1 library_entries；01 A-11）。
// 同名同型 upsert（demo libAdd 四入口语义）：命中 (name,type) 即覆盖参数模板与脚本元数据，
// 保留既有行 id（引用稳定）；删除=物理删（库条目无历史面）。
import type { LibraryEntry } from '@constella/shared/ipc';
import { fromJson, now, toJson, type ConnGetter } from './dao-error';

interface LibRow {
  id: string;
  name: string;
  type: string;
  params: string | null;
  script_meta: string | null;
  updated_at: number;
}

function rowToEntry(r: LibRow): LibraryEntry {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    params: fromJson<Record<string, unknown>>(r.params, `library_entries.params(${r.id})`) ?? {},
    scriptMeta:
      fromJson<LibraryEntry['scriptMeta']>(r.script_meta, `library_entries.script_meta(${r.id})`) ??
      { lang: 'ts', file: '' },
    updatedAt: r.updated_at,
  };
}

export class LibraryDao {
  constructor(private readonly conn: ConnGetter) {}

  list(): { items: LibraryEntry[] } {
    const rows = this.conn()
      .prepare('SELECT id, name, type, params, script_meta, updated_at FROM library_entries ORDER BY name, type')
      .all() as unknown as LibRow[];
    return { items: rows.map(rowToEntry) };
  }

  /** 同名同型覆盖（保留既有 id）；否则插入 */
  upsert(entry: LibraryEntry): void {
    const db = this.conn();
    const existing = db
      .prepare('SELECT id FROM library_entries WHERE name = :name AND type = :type')
      .get({ name: entry.name, type: entry.type }) as { id: string } | undefined;
    const ts = now();
    if (existing !== undefined) {
      db.prepare(
        'UPDATE library_entries SET params = :params, script_meta = :script_meta, updated_at = :ts WHERE id = :id',
      ).run({ params: toJson(entry.params), script_meta: toJson(entry.scriptMeta), ts, id: existing.id });
      return;
    }
    db.prepare(
      'INSERT INTO library_entries (id, name, type, params, script_meta, updated_at) VALUES (:id, :name, :type, :params, :script_meta, :ts)',
    ).run({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      params: toJson(entry.params),
      script_meta: toJson(entry.scriptMeta),
      ts,
    });
  }

  /** 删除（幂等：不存在静默 0 变化——库条目无 NOT-FOUND 业务面） */
  delete(id: string): void {
    this.conn().prepare('DELETE FROM library_entries WHERE id = :id').run({ id });
  }
}
