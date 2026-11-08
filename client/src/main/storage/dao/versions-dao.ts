// VersionsDao（T1-04；C-06 §1 versions 域；02 §7.1 flow_versions）。
// LIFO 元数据列表（A-5.4）与快照读取；restore=只读返回不落盘（恢复呈 dirty 归 C-01 flowStore）。
// 版本压栈/淘汰的事务编排归 SavePipeline（T1-06）；本 DAO 只做读面。
import type { FlowSnapshot, VersionMeta } from '@constella/shared/ipc';
import { versionNotFound, fromJson, type ConnGetter } from './dao-error';

interface VersionRow {
  id: string;
  flow_id: string;
  label: VersionMeta['label'];
  node_count: number;
  edge_count: number;
  snapshot: string;
  created_at: number;
}

function toMeta(r: VersionRow): VersionMeta {
  return {
    id: r.id,
    flowId: r.flow_id,
    label: r.label,
    nodeCount: r.node_count,
    edgeCount: r.edge_count,
    createdAt: r.created_at,
  };
}

export class VersionsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** LIFO 元数据（created_at DESC、rowid DESC 双键稳定；同毫秒多版本按插入序） */
  list(flowId: string): VersionMeta[] {
    const rows = this.conn()
      .prepare(
        'SELECT id, flow_id, label, node_count, edge_count, snapshot, created_at FROM flow_versions WHERE flow_id = :flowId ORDER BY created_at DESC, rowid DESC',
      )
      .all({ flowId }) as unknown as VersionRow[];
    return rows.map(toMeta);
  }

  /** 读快照（只读返回；不存在的版本/流程抛 VERSION-NOT-FOUND） */
  restore(flowId: string, versionId: string): FlowSnapshot {
    const row = this.conn()
      .prepare('SELECT id, flow_id, label, node_count, edge_count, snapshot, created_at FROM flow_versions WHERE id = :vid AND flow_id = :fid')
      .get({ vid: versionId, fid: flowId }) as unknown as VersionRow | undefined;
    if (row === undefined) throw versionNotFound(versionId);
    const snap = fromJson<FlowSnapshot>(row.snapshot, 'flow_versions.snapshot');
    return { nodes: snap?.nodes ?? [], edges: snap?.edges ?? [] };
  }
}
