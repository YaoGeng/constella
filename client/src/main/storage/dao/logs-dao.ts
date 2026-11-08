// LogsDao（T1-05；C-06 §1 logs 域；02 §7.1 logs；01 A-9）。
// 三路双写数据源＋重放查询；滚动保留 20000 行（C-06 §4 ⚠ b 设计值——append 事务内删溢出）。
import type { LogLevel, LogRecord } from '@constella/shared/ipc';
import { type ConnGetter } from './dao-error';

/** 保留行数设计值（§4 ⚠ b；参数化扩展点见 C-06 §8②） */
export const LOGS_RETENTION_ROWS = 20000;

/** list 默认/上限（02 未定返回窗；防误全表拉取的设计值——上报项登记） */
export const LOGS_LIST_DEFAULT_LIMIT = 100;
export const LOGS_LIST_MAX_LIMIT = 1000;

interface LogRow {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
  flow_id: string | null;
  run_id: string | null;
  lane_label: string | null;
}

function rowToRecord(r: LogRow): LogRecord {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level,
    msg: r.msg,
    flowId: r.flow_id,
    runId: r.run_id,
    laneLabel: r.lane_label,
  };
}

export class LogsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 追加（事务内滚存：保留最近 LOGS_RETENTION_ROWS 行）→ 新行 id */
  append(args: {
    level: LogLevel;
    msg: string;
    flowId?: string;
    runId?: string;
    laneLabel?: string;
  }): { id: number } {
    const db = this.conn();
    const ts = new Date().toISOString();
    return db.transaction(() => {
      const r = db
        .prepare(
          'INSERT INTO logs (ts, level, msg, flow_id, run_id, lane_label) VALUES (:ts, :level, :msg, :fid, :rid, :lane)',
        )
        .run({ ts, level: args.level, msg: args.msg, fid: args.flowId ?? null, rid: args.runId ?? null, lane: args.laneLabel ?? null });
      // 删溢出：保留 id 最大的 LOGS_RETENTION_ROWS 行（AUTOINCREMENT 单调）
      db.prepare(
        `DELETE FROM logs WHERE id < (SELECT MIN(id) FROM (SELECT id FROM logs ORDER BY id DESC LIMIT ${LOGS_RETENTION_ROWS}))`,
      ).run();
      return { id: r.lastInsertRowid };
    });
  }

  /** 重放查询（flowId/runId 可选过滤；beforeId 游标倒翻页；id DESC 稳定序） */
  list(args: { flowId?: string; runId?: string; beforeId?: number; limit?: number }): LogRecord[] {
    const conds: string[] = [];
    const bind: Record<string, unknown> = {};
    if (args.flowId !== undefined) {
      conds.push('flow_id = :fid');
      bind.fid = args.flowId;
    }
    if (args.runId !== undefined) {
      conds.push('run_id = :rid');
      bind.rid = args.runId;
    }
    if (args.beforeId !== undefined) {
      conds.push('id < :before');
      bind.before = args.beforeId;
    }
    const limit = Math.min(Math.max(1, args.limit ?? LOGS_LIST_DEFAULT_LIMIT), LOGS_LIST_MAX_LIMIT);
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.conn()
      .prepare(`SELECT id, ts, level, msg, flow_id, run_id, lane_label FROM logs ${where} ORDER BY id DESC LIMIT :limit`)
      .all({ ...bind, limit }) as unknown as LogRow[];
    return rows.map(rowToRecord);
  }
}
