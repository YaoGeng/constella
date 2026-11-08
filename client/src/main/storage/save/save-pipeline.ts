// SavePipeline —— 保存事务＋版本快照（T1-06；02 §13.1；S-2 ②；demo L1257-1267/L1637-1649）。
//
// saveFlow 单 db.transaction() 原子提交（抛错自动回滚——S-2 ②=02 §13.1 原子性机制）：
//   ① flows upsert（改名/刷新 updated_at；soft_del 流拒绝保存）
//   ② nodes 表镜像重写（FK 支撑/列表镜像；保留 id 的行 UPDATE、消失的行 DELETE、新行 INSERT
//      ——node_runs.node_id 外键依赖既有节点 id，全删全插会打断历史运行记录的引用）
//   ③ flow_versions 压栈（snapshot=nodes+edges 全量，02 §7.1/C-06 §4 ⚠ a：边数据唯一落点）
//   ④ >20 删最旧（LIFO 20/流程，A-5.4；created_at+rowid 双键稳定序）
// restoreVersion 读快照：只读返回不落盘（恢复呈 dirty 归 C-01 flowStore，02 §13.3）。
import type { FlowDoc, FlowNode, FlowSnapshot, FlowVersionLabel } from '@constella/shared/ipc';
import type { DbConnection } from '../engine/connection';
import { flowNotFound, fromJson, newId, now, versionNotFound, type ConnGetter } from '../dao/dao-error';

/** 每流程版本保留上限（A-5.4 LIFO 20） */
export const VERSIONS_PER_FLOW_LIMIT = 20;

export interface SaveFlowArgs {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowDoc['edges'];
  label: FlowVersionLabel;
}

export class SavePipeline {
  constructor(private readonly conn: ConnGetter) {}

  /** 保存事务（原子；→ 新版本 id）。nodes.type 引用不存在定义时 FK 抛错整体回滚（§6.1a） */
  saveFlow(doc: SaveFlowArgs): { versionId: string } {
    const db = this.conn();
    const ts = now();
    const versionId = newId();
    db.transaction(() => {
      // ① flows 元数据 upsert
      const touched = db
        .prepare('UPDATE flows SET name = :name, updated_at = :ts WHERE id = :id AND soft_del = 0')
        .run({ id: doc.id, name: doc.name, ts });
      if (touched.changes === 0) throw flowNotFound(doc.id);

      // ② nodes 镜像重写（增量镜像——保 id 引用稳定）
      const existing = new Set(
        (db.prepare('SELECT id FROM nodes WHERE flow_id = :fid').all({ fid: doc.id }) as unknown as Array<
          Record<string, unknown>
        >).map((r) => r['id'] as string),
      );
      const keep = new Set(doc.nodes.map((nd) => nd.id));
      const del = db.prepare('DELETE FROM nodes WHERE flow_id = :fid AND id = :nid');
      for (const id of existing) {
        if (!keep.has(id)) del.run({ fid: doc.id, nid: id });
      }
      const ins = db.prepare(
        'INSERT INTO nodes (id, flow_id, type, name, x, y, params, no_script, created_at, updated_at) VALUES (:id, :fid, :type, :name, :x, :y, :params, :no_script, :ts, :ts)',
      );
      const upd = db.prepare(
        'UPDATE nodes SET type = :type, name = :name, x = :x, y = :y, params = :params, no_script = :no_script, updated_at = :ts WHERE id = :id',
      );
      for (const nd of doc.nodes) {
        // 注意：两语句绑定键集合不同（INSERT 含 fid；UPDATE 不含）——node:sqlite 拒绝多余键
        const common = {
          id: nd.id,
          type: nd.type,
          name: nd.name,
          x: nd.position.x,
          y: nd.position.y,
          params: JSON.stringify(nd.params ?? {}),
          no_script: nd.noScript ? 1 : 0,
          ts,
        };
        if (existing.has(nd.id)) {
          upd.run(common);
        } else {
          ins.run({ ...common, fid: doc.id });
        }
      }

      // ③ 版本压栈（snapshot=nodes+edges 全量克隆）
      db.prepare(
        'INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at) VALUES (:vid, :fid, :label, :nc, :ec, :snapshot, :ts)',
      ).run({
        vid: versionId,
        fid: doc.id,
        label: doc.label,
        nc: doc.nodes.length,
        ec: doc.edges.length,
        snapshot: JSON.stringify({ nodes: doc.nodes, edges: doc.edges }),
        ts,
      });

      // ④ LIFO 20 淘汰
      db.prepare(
        `DELETE FROM flow_versions WHERE flow_id = :fid AND id NOT IN (
           SELECT id FROM flow_versions WHERE flow_id = :fid2 ORDER BY created_at DESC, rowid DESC LIMIT ${VERSIONS_PER_FLOW_LIMIT}
         )`,
      ).run({ fid: doc.id, fid2: doc.id });
    });
    return { versionId };
  }

  /** 读快照（只读返回不落盘，恢复呈 dirty——02 §13.3） */
  restoreVersion(flowId: string, versionId: string): FlowSnapshot {
    const row = this.conn()
      .prepare('SELECT snapshot FROM flow_versions WHERE id = :vid AND flow_id = :fid')
      .get({ vid: versionId, fid: flowId }) as { snapshot: string } | undefined;
    if (row === undefined) throw versionNotFound(versionId);
    const snap = fromJson<FlowSnapshot>(row.snapshot, `flow_versions.snapshot(${versionId})`);
    return { nodes: snap?.nodes ?? [], edges: snap?.edges ?? [] };
  }

  /** SavePipeline 事务外只读工具（供装配/测试）：栈顶快照 */
  latestSnapshot(db: DbConnection, flowId: string): FlowSnapshot | null {
    const row = db
      .prepare('SELECT snapshot FROM flow_versions WHERE flow_id = :fid ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get({ fid: flowId }) as { snapshot: string } | undefined;
    if (row === undefined) return null;
    return fromJson<FlowSnapshot>(row.snapshot, `flow_versions.snapshot(${flowId})`);
  }
}
