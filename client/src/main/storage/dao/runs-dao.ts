// RunsDao＋NodeRunsDao（T1-05；C-06 §1 runs 域；02 §7.1 runs/node_runs；01 A-6/B-13）。
// 「同流程最多一 active run」＝写前检查 + 部分唯一索引兜底（C-06 §4③）；
// node_runs.output=NodeOut JSON 落库（抽屉可查真实 IO）。
import type { NodeOut } from '@constella/shared/dsl';
import type { NodeRunRecord, RunDetail, RunSummary } from '@constella/shared/ipc';
import { activeRunExists, flowNotFound, fromJson, newId, now, runNotFound, toJson, type ConnGetter } from './dao-error';

interface RunRow {
  id: string;
  flow_id: string;
  name: string;
  status: RunSummary['status'];
  t0: number;
  t1: number | null;
  aborted: number;
  failed: number;
  total: number;
  skips: string | null;
  created_at: number;
}

function rowToSummary(r: RunRow): RunSummary {
  return {
    id: r.id,
    flowId: r.flow_id,
    name: r.name,
    status: r.status,
    t0: r.t0,
    t1: r.t1,
    aborted: r.aborted,
    failed: r.failed,
    total: r.total,
    skips: fromJson<unknown[]>(r.skips, `runs.skips(${r.id})`) ?? [],
    createdAt: r.created_at,
  };
}

interface NodeRunRow {
  id: string;
  run_id: string;
  lane_id: string;
  node_id: string;
  status: NodeRunRecord['status'];
  started_at: number | null;
  ended_at: number | null;
  output: string | null;
  error: string | null;
}

function rowToNodeRun(r: NodeRunRow): NodeRunRecord {
  return {
    id: r.id,
    runId: r.run_id,
    laneId: r.lane_id,
    nodeId: r.node_id,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    output: fromJson<NodeOut>(r.output, `node_runs.output(${r.id})`),
    error: r.error,
  };
}

const RUN_COLS = 'id, flow_id, name, status, t0, t1, aborted, failed, total, skips, created_at';

export class RunsDao {
  constructor(
    private readonly conn: ConnGetter,
    readonly nodeRuns: NodeRunsDao,
  ) {}

  list(): { items: RunSummary[] } {
    const rows = this.conn()
      .prepare(`SELECT ${RUN_COLS} FROM runs ORDER BY created_at DESC, rowid DESC`)
      .all() as unknown as RunRow[];
    return { items: rows.map(rowToSummary) };
  }

  /** 详情（含 node_runs，B-13 抽屉数据面） */
  get(runId: string): RunDetail {
    const row = this.conn()
      .prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = :id`)
      .get({ id: runId }) as unknown as RunRow | undefined;
    if (row === undefined) throw runNotFound(runId);
    return { ...rowToSummary(row), nodeRuns: this.nodeRuns.listByRun(runId) };
  }

  /** 开跑（active=running；同流程已有 active run → ACTIVE-RUN-EXISTS；部分唯一索引兜底） */
  create(flowId: string, name: string): { id: string } {
    const db = this.conn();
    const flow = db.prepare('SELECT id FROM flows WHERE id = :id AND soft_del = 0').get({ id: flowId });
    if (flow === undefined) throw flowNotFound(flowId);
    const active = db
      .prepare("SELECT 1 AS ok FROM runs WHERE flow_id = :fid AND status IN ('running', 'waiting')")
      .get({ fid: flowId });
    if (active !== undefined) throw activeRunExists(flowId);
    const id = newId();
    const ts = now();
    try {
      db.prepare(
        "INSERT INTO runs (id, flow_id, name, status, t0, t1, aborted, failed, total, skips, created_at) VALUES (:id, :fid, :name, 'running', :t0, NULL, 0, 0, 0, '[]', :ts)",
      ).run({ id, fid: flowId, name, t0: ts, ts });
    } catch (err) {
      // 兜底：并发窗口内唯一索引命中（单写者 app 正常不可达；防御性映射）
      if (err instanceof Error && /UNIQUE constraint failed: runs\./.test(err.message)) {
        throw activeRunExists(flowId);
      }
      throw err;
    }
    return { id };
  }

  /** 收官（终态 status＋t1＋计数快照；幂等覆盖，run 不存在 → RUN-NOT-FOUND） */
  finish(patch: {
    runId: string;
    status: RunSummary['status'];
    t1?: number;
    aborted?: number;
    failed?: number;
    total?: number;
    skips?: unknown[];
  }): void {
    const r = this.conn()
      .prepare(
        `UPDATE runs SET status = :status, t1 = :t1, aborted = :aborted, failed = :failed, total = :total, skips = :skips WHERE id = :id`,
      )
      .run({
        id: patch.runId,
        status: patch.status,
        t1: patch.t1 ?? now(),
        aborted: patch.aborted ?? 0,
        failed: patch.failed ?? 0,
        total: patch.total ?? 0,
        skips: toJson(patch.skips ?? []),
      });
    if (r.changes === 0) throw runNotFound(patch.runId);
  }
}

export class NodeRunsDao {
  constructor(private readonly conn: ConnGetter) {}

  listByRun(runId: string): NodeRunRecord[] {
    const rows = this.conn()
      .prepare('SELECT id, run_id, lane_id, node_id, status, started_at, ended_at, output, error FROM node_runs WHERE run_id = :rid ORDER BY started_at, rowid')
      .all({ rid: runId }) as unknown as NodeRunRow[];
    return rows.map(rowToNodeRun);
  }

  /**
   * 节点开跑（status=running；id 由 C-03 生成传入——重试幂等语义由调用方保证）。
   * 非 cdp lane FK 兜底（T4-20 评审 blocker 收口）：node_runs.lane_id REFERENCES lanes(id)
   * 而 lanes 只由 CdpSessionManager 写入（无 renderer op）——纯数据流 lane（如 'main'）先落
   * **占位行**（id=laneId、label=laneId、cdp 三字段 NULL，ON CONFLICT DO NOTHING 幂等）；
   * CdpSessionManager 后续 upsert 覆盖真值（时序上 nodeRunStart 先于 cdp 节点 ensureSession
   * 无冲突；占位行不覆写已覆盖真值）。cdp:listSessions 投影过滤 cdpPort=NULL 占位行——
   * 防 port=0 幽灵会话（cdp-session-manager.ts）。
   */
  nodeRunStart(args: { nodeRunId: string; runId: string; laneId: string; nodeId: string }): void {
    this.conn()
      .prepare('INSERT INTO lanes (id, run_id, label, cdp_port, partition, last_url, status) VALUES (:id, :run_id, :label, NULL, NULL, NULL, \'open\') ON CONFLICT(id) DO NOTHING')
      .run({ id: args.laneId, run_id: args.runId, label: args.laneId });
    this.conn()
      .prepare(
        "INSERT INTO node_runs (id, run_id, lane_id, node_id, status, started_at, ended_at, output, error) VALUES (:id, :rid, :lid, :nid, 'running', :ts, NULL, NULL, NULL)",
      )
      .run({ id: args.nodeRunId, rid: args.runId, lid: args.laneId, nid: args.nodeId, ts: now() });
  }

  /** 节点收官（output={data}|{branch,meta} 落库；不存在 → RUN-NOT-FOUND） */
  nodeRunFinish(args: {
    nodeRunId: string;
    status: NodeRunRecord['status'];
    endedAt?: number;
    output?: NodeOut | null;
    error?: string | null;
  }): void {
    const r = this.conn()
      .prepare(
        'UPDATE node_runs SET status = :status, ended_at = :ended_at, output = :output, error = :error WHERE id = :id',
      )
      .run({
        id: args.nodeRunId,
        status: args.status,
        ended_at: args.endedAt ?? now(),
        output: toJson(args.output ?? null),
        error: args.error ?? null,
      });
    if (r.changes === 0) throw runNotFound(args.nodeRunId);
  }
}
