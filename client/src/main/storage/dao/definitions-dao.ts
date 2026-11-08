// DefinitionsDao（T1-04；C-06 §1 definitions 域；02 §7.1 node_definitions DDL 节选）。
// 列↔DSL 键映射知识（X-01 §4 登记）：列 meta/ports/params_schema/exec/inner/policy/io/version/
// pkg_version ↔ N1 meta/N2 ports/N3 paramsSchema/N4 exec/N5 inner/N6 policy/N7 io/N8 version+
// packageVersion。本 DAO＝C-05 IpcDefinitionStore（T1-08）与 C-08 导入（P5）的数据面。
import type { NodeDefinition } from '@constella/shared/dsl';
import { fromJson, now, toJson, type ConnGetter } from './dao-error';

interface DefRow {
  type: string;
  kind: NodeDefinition['kind'];
  meta: string;
  ports: string;
  params_schema: string;
  exec: string | null;
  inner: string | null;
  policy: string | null;
  io: string | null;
  version: string;
  pkg_version: string;
  updated_at: number;
}

function rowToDef(r: DefRow): NodeDefinition {
  return {
    type: r.type,
    kind: r.kind,
    meta: fromJson<NodeDefinition['meta']>(r.meta, `node_definitions.meta(${r.type})`) ?? { name: r.type, icon: '', category: '' },
    ports: fromJson<NodeDefinition['ports']>(r.ports, `node_definitions.ports(${r.type})`) ?? { ins: [], outs: [] },
    paramsSchema: fromJson<NodeDefinition['paramsSchema']>(r.params_schema, `node_definitions.params_schema(${r.type})`) ?? [],
    exec: fromJson<NodeDefinition['exec']>(r.exec, `node_definitions.exec(${r.type})`),
    inner: fromJson<NodeDefinition['inner']>(r.inner, `node_definitions.inner(${r.type})`),
    policy: fromJson<NodeDefinition['policy']>(r.policy, `node_definitions.policy(${r.type})`),
    io: fromJson<NodeDefinition['io']>(r.io, `node_definitions.io(${r.type})`),
    version: r.version,
    packageVersion: r.pkg_version,
  };
}

const COLS = 'type, kind, meta, ports, params_schema, exec, inner, policy, io, version, pkg_version, updated_at';

export class DefinitionsDao {
  constructor(private readonly conn: ConnGetter) {}

  /** 全量定义（C-05 loadAll 数据面；type 字典序稳定） */
  loadAll(): NodeDefinition[] {
    const rows = this.conn()
      .prepare(`SELECT ${COLS} FROM node_definitions ORDER BY type`)
      .all() as unknown as DefRow[];
    return rows.map(rowToDef);
  }

  /** upsert（同名同型=type PK 覆盖；四入口共用：手动/AI/zip 导入/广场安装） */
  upsert(doc: NodeDefinition): void {
    this.conn()
      .prepare(
        `INSERT INTO node_definitions (${COLS})
         VALUES (:type, :kind, :meta, :ports, :params_schema, :exec, :inner, :policy, :io, :version, :pkg_version, :updated_at)
         ON CONFLICT(type) DO UPDATE SET
           kind = excluded.kind, meta = excluded.meta, ports = excluded.ports,
           params_schema = excluded.params_schema, exec = excluded.exec, inner = excluded.inner,
           policy = excluded.policy, io = excluded.io, version = excluded.version,
           pkg_version = excluded.pkg_version, updated_at = excluded.updated_at`,
      )
      .run({
        type: doc.type,
        kind: doc.kind,
        meta: JSON.stringify(doc.meta),
        ports: JSON.stringify(doc.ports),
        params_schema: JSON.stringify(doc.paramsSchema),
        exec: toJson(doc.exec),
        inner: toJson(doc.inner),
        policy: toJson(doc.policy),
        io: toJson(doc.io),
        version: doc.version,
        pkg_version: doc.packageVersion,
        updated_at: now(),
      });
  }
}
