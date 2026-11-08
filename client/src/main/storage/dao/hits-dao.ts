// HitsDao（T1-05；C-06 §1 hits 域；02 §7.1 hit_breakpoints；01 A-7/B-4）。
// 断点台账：create（pending）→ resolve（resolved/skipped＋payload＋resolved_at）；
// data_snapshot=上游真实输出（B-4）。
import type { HitRecord, HitStatus } from '@constella/shared/ipc';
import { hitNotFound, fromJson, newId, now, toJson, type ConnGetter } from './dao-error';

interface HitRow {
  id: string;
  run_id: string;
  node_id: string;
  question: string;
  options: string | null;
  data_snapshot: string | null;
  status: HitStatus;
  payload: string | null;
  created_at: number;
  resolved_at: number | null;
}

function rowToHit(r: HitRow): HitRecord {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    question: r.question,
    options: fromJson<unknown[]>(r.options, `hit_breakpoints.options(${r.id})`) ?? [],
    dataSnapshot: fromJson<unknown>(r.data_snapshot, `hit_breakpoints.data_snapshot(${r.id})`),
    status: r.status,
    payload: fromJson<unknown>(r.payload, `hit_breakpoints.payload(${r.id})`),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

export class HitsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 按 run 列出（status 可选过滤；创建序）。绑定键与语句严格同构——node:sqlite 拒绝多余具名键 */
  list(runId: string, status?: HitStatus): { items: HitRecord[] } {
    const where = status === undefined ? 'run_id = :rid' : 'run_id = :rid AND status = :status';
    const bind: Record<string, unknown> = status === undefined ? { rid: runId } : { rid: runId, status };
    const rows = this.conn()
      .prepare(`SELECT id, run_id, node_id, question, options, data_snapshot, status, payload, created_at, resolved_at FROM hit_breakpoints WHERE ${where} ORDER BY created_at, rowid`)
      .all(bind) as unknown as HitRow[];
    return { items: rows.map(rowToHit) };
  }

  /** 建断点（pending）→ {id}（resolve 需 id） */
  create(args: {
    runId: string;
    nodeId: string;
    question: string;
    options: unknown[];
    dataSnapshot: unknown;
  }): { id: string } {
    const id = newId();
    this.conn()
      .prepare(
        `INSERT INTO hit_breakpoints (id, run_id, node_id, question, options, data_snapshot, status, payload, created_at, resolved_at)
         VALUES (:id, :rid, :nid, :question, :options, :data_snapshot, 'pending', NULL, :ts, NULL)`,
      )
      .run({
        id,
        rid: args.runId,
        nid: args.nodeId,
        question: args.question,
        options: toJson(args.options),
        data_snapshot: toJson(args.dataSnapshot),
        ts: now(),
      });
    return { id };
  }

  /** 解断点（status/payload/resolved_at；HIT-NOT-FOUND） */
  resolve(id: string, status: HitStatus, payload: unknown): void {
    const r = this.conn()
      .prepare('UPDATE hit_breakpoints SET status = :status, payload = :payload, resolved_at = :ts WHERE id = :id')
      .run({ id, status, payload: toJson(payload), ts: now() });
    if (r.changes === 0) throw hitNotFound(id);
  }
}
