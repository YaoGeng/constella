// SeedsRunner —— 首启播种与增量补种（T1-03；02 §13.2；demo L1246-1255 语义源）。
//
// 职责：
//   seed(conn)：12 内置定义（INSERT OR IGNORE——用户改过的不覆盖）＋按 seed_flags 逐流程
//   按缺补种（f1~f9；用户数据一律不动）＋节点库首启 3 项（首启判定=seed_flags 无任何行；
//   用户删除库条目不会被复活）。整个补种在单事务内。
//   ensureInitialVersions(conn)：无版本的流程补「初始版本」（快照取 nodes 镜像，edges 无镜像
//   来源只能为空——常规路径 flows.create/种子均已带版本，此为防御面，02 §13.1/demo L3102-3107）。
import type { DbConnection } from '../engine/connection';
import { BUILTIN_DEFINITIONS, SEED_FLOWS, SEED_LIBRARY } from './seed-data';

function toDefRow(doc: (typeof BUILTIN_DEFINITIONS)[number]): Record<string, unknown> {
  return {
    type: doc.type,
    kind: doc.kind,
    meta: JSON.stringify(doc.meta),
    ports: JSON.stringify(doc.ports),
    params_schema: JSON.stringify(doc.paramsSchema),
    exec: doc.exec === null ? null : JSON.stringify(doc.exec),
    inner: doc.inner == null ? null : JSON.stringify(doc.inner),
    policy: doc.policy == null ? null : JSON.stringify(doc.policy),
    io: doc.io == null ? null : JSON.stringify(doc.io),
    version: doc.version,
    pkg_version: doc.packageVersion,
    updated_at: Date.now(),
  };
}

const INSERT_DEF = `INSERT OR IGNORE INTO node_definitions
  (type, kind, meta, ports, params_schema, exec, inner, policy, io, version, pkg_version, updated_at)
  VALUES (:type, :kind, :meta, :ports, :params_schema, :exec, :inner, :policy, :io, :version, :pkg_version, :updated_at)`;

const INSERT_FLOW =
  'INSERT INTO flows (id, name, order_idx, soft_del, created_at, updated_at) VALUES (:id, :name, :order_idx, 0, :now, :now)';
const INSERT_NODE = `INSERT INTO nodes (id, flow_id, type, name, x, y, params, no_script, created_at, updated_at)
  VALUES (:id, :flow_id, :type, :name, :x, :y, :params, :no_script, :now, :now)`;
const INSERT_VERSION = `INSERT INTO flow_versions (id, flow_id, label, node_count, edge_count, snapshot, created_at)
  VALUES (:id, :flow_id, :label, :node_count, :edge_count, :snapshot, :now)`;
const INSERT_SEED_FLAG = 'INSERT INTO seed_flags (flow_id, seeded_at) VALUES (:flow_id, :now)';
const INSERT_LIBRARY = `INSERT INTO library_entries (id, name, type, params, script_meta, updated_at)
  VALUES (:id, :name, :type, :params, :script_meta, :updated_at)`;

/** 播种/补种（幂等；增量按 seed_flags 逐流程判定——demo L1246-1255） */
export function seed(conn: DbConnection): void {
  conn.transaction(() => {
    // ① 12 内置定义：缺则补（用户/示例已改的零碰）
    const def = conn.prepare(INSERT_DEF);
    for (const d of BUILTIN_DEFINITIONS) def.run(toDefRow(d));

    // ② 首启判定（库条目只随首启播种，避免删除后复活——「用户数据不动」）
    const flagCount = conn.prepare('SELECT COUNT(*) AS c FROM seed_flags').get() as { c: number };
    const firstBoot = flagCount.c === 0;

    // ③ 流程按缺补种（seed_flags 逐流程粒度）
    const hasFlag = conn.prepare('SELECT 1 AS ok FROM seed_flags WHERE flow_id = :flow_id');
    const insFlow = conn.prepare(INSERT_FLOW);
    const insNode = conn.prepare(INSERT_NODE);
    const insVersion = conn.prepare(INSERT_VERSION);
    const insFlag = conn.prepare(INSERT_SEED_FLAG);
    let orderIdx = 1;
    for (const f of SEED_FLOWS) {
      const done = hasFlag.get({ flow_id: f.id });
      if (done !== undefined) {
        orderIdx += 1;
        continue;
      }
      const now = Date.now();
      insFlow.run({ id: f.id, name: f.name, order_idx: orderIdx, now });
      for (const node of f.nodes) {
        insNode.run({
          id: node.id,
          flow_id: f.id,
          type: node.type,
          name: node.name,
          x: node.position.x,
          y: node.position.y,
          params: JSON.stringify(node.params),
          no_script: node.noScript ? 1 : 0,
          now,
        });
      }
      insVersion.run({
        id: `${f.id}-v0`,
        flow_id: f.id,
        label: '初始版本',
        node_count: f.nodes.length,
        edge_count: f.edges.length,
        snapshot: JSON.stringify({ nodes: f.nodes, edges: f.edges }),
        now,
      });
      insFlag.run({ flow_id: f.id, now });
      orderIdx += 1;
    }

    // ④ 节点库首启 3 项
    if (firstBoot) {
      const insLib = conn.prepare(INSERT_LIBRARY);
      for (const lib of SEED_LIBRARY) {
        insLib.run({
          id: lib.id,
          name: lib.name,
          type: lib.type,
          params: JSON.stringify(lib.params),
          script_meta: JSON.stringify(lib.scriptMeta),
          updated_at: Date.now(),
        });
      }
    }
  });
}

/** 无版本流程补「初始版本」（快照=nodes 镜像投影；edges 唯一来源是历史 snapshot，此处无从恢复） */
export function ensureInitialVersions(conn: DbConnection): void {
  const bare = conn
    .prepare(
      `SELECT f.id AS flow_id FROM flows f
       WHERE NOT EXISTS (SELECT 1 FROM flow_versions v WHERE v.flow_id = f.id)`,
    )
    .all() as Array<{ flow_id: string }>;
  if (bare.length === 0) return;
  const selNodes = conn.prepare(
    'SELECT id, type, name, x, y, params, no_script FROM nodes WHERE flow_id = :flow_id ORDER BY created_at, id',
  );
  const insVersion = conn.prepare(INSERT_VERSION);
  conn.transaction(() => {
    for (const row of bare) {
      const nodeRows = selNodes.all({ flow_id: row.flow_id }) as Array<{
        id: string;
        type: string;
        name: string;
        x: number;
        y: number;
        params: string | null;
        no_script: number;
      }>;
      const nodes = nodeRows.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        position: { x: r.x, y: r.y },
        params: r.params === null ? {} : (JSON.parse(r.params) as Record<string, unknown>),
        ...(r.no_script === 1 ? { noScript: true } : {}),
      }));
      insVersion.run({
        id: `${row.flow_id}-init-${Date.now()}`,
        flow_id: row.flow_id,
        label: '初始版本',
        node_count: nodes.length,
        edge_count: 0,
        snapshot: JSON.stringify({ nodes, edges: [] }),
        now: Date.now(),
      });
    }
  });
}
