// FlowsDao（T1-04；C-06 §1 flows 域 op 表＋02 §7.1 flows/flow_versions 行）。
//
// 职责：flows 实体 CRUD＋soft_del 过滤＋LIFO 元数据；flows.get=当前文档（栈顶 snapshot 投影为
// FlowDoc）；flows.create 打「初始版本」（02 §7.1 flow_versions 行为）；reorder 全量重排。
// nodes 镜像重写与版本压栈的**事务编排**归 SavePipeline（T1-06）——本 DAO 只做单实体面。
import type { FlowDoc, FlowListItem } from '@constella/shared/ipc';
import type { DbConnection } from '../engine/connection';
import { flowNotFound, fromJson, newId, now, type ConnGetter } from './dao-error';

interface FlowRow {
  id: string;
  name: string;
  order_idx: number;
  soft_del: number;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  id: string;
  flow_id: string;
  label: string;
  node_count: number;
  edge_count: number;
  snapshot: string;
  created_at: number;
}

function toListItem(r: FlowRow): FlowListItem {
  return { id: r.id, name: r.name, orderIdx: r.order_idx, createdAt: r.created_at, updatedAt: r.updated_at };
}

export class FlowsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 列表（过滤 soft_del=0；order_idx 升序、创建序稳定排序） */
  list(): { items: FlowListItem[] } {
    const rows = this.conn()
      .prepare('SELECT id, name, order_idx, soft_del, created_at, updated_at FROM flows WHERE soft_del = 0 ORDER BY order_idx, created_at, id')
      .all() as unknown as FlowRow[];
    return { items: rows.map(toListItem) };
  }

  /** 当前文档＝栈顶 snapshot 投影（无版本→空画布） */
  get(id: string): FlowDoc {
    const db = this.conn();
    const flow = db
      .prepare('SELECT id, name, order_idx, soft_del, created_at, updated_at FROM flows WHERE id = :id')
      .get({ id }) as unknown as FlowRow | undefined;
    if (flow === undefined || flow.soft_del === 1) throw flowNotFound(id);
    const top = db
      .prepare(
        'SELECT id, flow_id, label, node_count, edge_count, snapshot, created_at FROM flow_versions WHERE flow_id = :id ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get({ id }) as unknown as VersionRow | undefined;
    if (top === undefined) return { id: flow.id, name: flow.name, nodes: [], edges: [] };
    const snap = fromJson<{ nodes: FlowDoc['nodes']; edges: FlowDoc['edges'] }>(top.snapshot, 'flow_versions.snapshot');
    return {
      id: flow.id,
      name: flow.name,
      nodes: snap?.nodes ?? [],
      edges: snap?.edges ?? [],
    };
  }

  /** 新建流程并打「初始版本」（空画布快照） */
  create(name: string): { id: string } {
    const db = this.conn();
    const id = newId();
    const ts = now();
    db.transaction(() => {
      const max = db.prepare('SELECT COALESCE(MAX(order_idx), 0) AS m FROM flows').get() as { m: number };
      db.prepare(
        'INSERT INTO flows (id, name, order_idx, soft_del, created_at, updated_at) VALUES (:id, :name, :order_idx, 0, :ts, :ts)',
      ).run({ id, name, order_idx: max.m + 1, ts });
      db.prepare(
        "INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES (:vid, :fid, '初始版本', 0, 0, :snapshot, :ts)",
      ).run({ vid: newId(), fid: id, snapshot: JSON.stringify({ nodes: [], edges: [] }), ts });
    });
    return { id };
  }

  /** 重命名（soft_del 流不可改名） */
  rename(id: string, name: string): void {
    const r = this.conn()
      .prepare('UPDATE flows SET name = :name, updated_at = :ts WHERE id = :id AND soft_del = 0')
      .run({ id, name, ts: now() });
    if (r.changes === 0) throw flowNotFound(id);
  }

  /** 软删（D-8 ⚠；列表/查询过滤） */
  softDelete(id: string): void {
    const r = this.conn()
      .prepare('UPDATE flows SET soft_del = 1, updated_at = :ts WHERE id = :id AND soft_del = 0')
      .run({ id, ts: now() });
    if (r.changes === 0) throw flowNotFound(id);
  }

  /** 全量重排（ids 即新顺序；缺 id/多 id 抛 FLOW-NOT-FOUND） */
  reorder(ids: string[]): void {
    const db = this.conn();
    db.transaction(() => {
      const upd = db.prepare('UPDATE flows SET order_idx = :idx, updated_at = :ts WHERE id = :id');
      let idx = 1;
      for (const id of ids) {
        const r = upd.run({ idx, id, ts: now() });
        if (r.changes === 0) throw flowNotFound(id);
        idx += 1;
      }
    });
  }

  /** SavePipeline 事务内复用：upsert 元数据（改名/刷新 updated_at）；0 变化=流程不存在 */
  touchWithinTransaction(id: string, name: string, ts: number, db: DbConnection): void {
    const r = db
      .prepare('UPDATE flows SET name = :name, updated_at = :ts WHERE id = :id AND soft_del = 0')
      .run({ id, name, ts });
    if (r.changes === 0) throw flowNotFound(id);
  }
}
