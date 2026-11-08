// LanesDao（T1-05；main 内部面——**不进 IPC 白名单**；02 §7.1 lanes；01 A-8）。
// cdp:* handler 会话台账（CdpSessionManager 执行面 main 内直调）；run_id 可空（会话可先于 run 建立）。
export interface LaneRecord {
  id: string;
  runId: string | null;
  label: string;
  cdpPort: number | null;
  partition: string | null;
  lastUrl: string | null;
  status: string;
}

interface LaneRow {
  id: string;
  run_id: string | null;
  label: string;
  cdp_port: number | null;
  partition: string | null;
  last_url: string | null;
  status: string;
}

function rowToLane(r: LaneRow): LaneRecord {
  return {
    id: r.id,
    runId: r.run_id,
    label: r.label,
    cdpPort: r.cdp_port,
    partition: r.partition,
    lastUrl: r.last_url,
    status: r.status,
  };
}

export class LanesDao {
  constructor(private readonly conn: () => import('../engine/connection').DbConnection) {}

  upsert(lane: LaneRecord): void {
    this.conn()
      .prepare(
        `INSERT INTO lanes (id, run_id, label, cdp_port, partition, last_url, status)
         VALUES (:id, :run_id, :label, :cdp_port, :partition, :last_url, :status)
         ON CONFLICT(id) DO UPDATE SET
           run_id = excluded.run_id, label = excluded.label, cdp_port = excluded.cdp_port,
           partition = excluded.partition, last_url = excluded.last_url, status = excluded.status`,
      )
      .run({
        id: lane.id,
        run_id: lane.runId,
        label: lane.label,
        cdp_port: lane.cdpPort,
        partition: lane.partition,
        last_url: lane.lastUrl,
        status: lane.status,
      });
  }

  /** 关会话（status='closed'；不存在静默——台账尽力收口） */
  close(id: string): void {
    this.conn().prepare("UPDATE lanes SET status = 'closed' WHERE id = :id").run({ id });
  }

  get(id: string): LaneRecord | undefined {
    const row = this.conn()
      .prepare('SELECT id, run_id, label, cdp_port, partition, last_url, status FROM lanes WHERE id = :id')
      .get({ id }) as unknown as LaneRow | undefined;
    return row === undefined ? undefined : rowToLane(row);
  }

  listByRun(runId: string): LaneRecord[] {
    const rows = this.conn()
      .prepare('SELECT id, run_id, label, cdp_port, partition, last_url, status FROM lanes WHERE run_id = :rid')
      .all({ rid: runId }) as unknown as LaneRow[];
    return rows.map(rowToLane);
  }
}
