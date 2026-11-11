// 迁移序列定义（T1-02；TDD-C-06 §4 数据契约 + 02 §7.1 字段表）。
//
// v1 基线 DDL：15 表全量（flows/flow_versions/nodes/node_definitions/asset_packages/
// library_entries/runs/lanes/node_runs/logs/hit_breakpoints/settings/seed_flags/
// pending_publish/schema_migrations）＋索引集：
//   C-06 §4① 六索引：flow_versions(flow_id, created_at DESC)/nodes(flow_id)/
//   hit_breakpoints(run_id)/library_entries(name,type)/asset_packages(node_type)/logs(flow_id,id)；
//   02 §7.1 DDL 节选自带：idx_node_runs_run；「同流程最多一 active run」部分唯一索引
//   （C-06 §4③，UNIQUE(flow_id) WHERE status IN ('running','waiting')）。
// CHECK 集（C-06 §4②）：flows.soft_del∈{0,1}、logs.level 四值、hit_breakpoints.status 三值、
// runs.status 五值、node_definitions.kind 两值（02 DDL 节选）、flow_versions.label 五值（02 §7.1）、
// JSON 列=TEXT+json_valid()（NOT NULL 列直接校验；可空列 IS NULL OR json_valid）。
// FK 策略（C-06 §4④）：显式 REFERENCES + PRAGMA foreign_keys=ON；**不用 ON DELETE CASCADE**
// ——连带删除由应用层在事务内显式执行（物理删仅 factoryReset）。
// edges 落点（C-06 §4 ⚠ a 冻结）：无独立 edges 表——边数据唯一落点=flow_versions.snapshot；
// nodes 表为 FK 支撑/列表镜像（saveFlow 事务内镜像重写，T1-06）。
import type { DbConnection } from '../engine/connection';

/** 单个迁移（已发布禁改——C-06 §8 扩展点①：新表/新列一律走新版本；数据迁移形态随 T6-18
 *  PM 追认 2026-11-11 增设——v2 为首例：只清「未改动」的种子数据行，DDL/契约面零变化） */
export interface Migration {
  version: number;
  name: string;
  up: (conn: DbConnection) => void;
}

/** 版本 label 五值 CHECK 用字面量（与 shared FlowVersionLabel 一致） */
const LABEL_CHECK = "'手动保存','自动保存','生成草稿','流程工坊生成','初始版本'";

/** v1 基线：15 表 + 六索引 + idx_node_runs_run + active-run 部分唯一索引（02 §7.1 同构） */
export const V1_BASELINE: Migration = {
  version: 1,
  name: 'v1-baseline-15-tables',
  up: (conn) => {
    conn.exec(`
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  order_idx INTEGER NOT NULL DEFAULT 0,
  soft_del INTEGER NOT NULL DEFAULT 0 CHECK (soft_del IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  label TEXT NOT NULL CHECK (label IN (${LABEL_CHECK})),
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_flow_versions_flow_lifo ON flow_versions(flow_id, created_at DESC);

CREATE TABLE node_definitions (
  type TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('builtin', 'custom')),
  meta TEXT NOT NULL CHECK (json_valid(meta)),
  ports TEXT NOT NULL CHECK (json_valid(ports)),
  params_schema TEXT NOT NULL CHECK (json_valid(params_schema)),
  exec TEXT CHECK (exec IS NULL OR json_valid(exec)),
  inner TEXT CHECK (inner IS NULL OR json_valid(inner)),
  policy TEXT CHECK (policy IS NULL OR json_valid(policy)),
  io TEXT CHECK (io IS NULL OR json_valid(io)),
  version TEXT NOT NULL DEFAULT '1.0.0',
  pkg_version TEXT NOT NULL DEFAULT '1.0.0',
  updated_at INTEGER NOT NULL
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  type TEXT NOT NULL REFERENCES node_definitions(type),
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  params TEXT CHECK (params IS NULL OR json_valid(params)),
  no_script INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_nodes_flow ON nodes(flow_id);

CREATE TABLE asset_packages (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL REFERENCES node_definitions(type),
  pkg_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dir TEXT NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_asset_packages_node_type ON asset_packages(node_type);

CREATE TABLE library_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL REFERENCES node_definitions(type),
  params TEXT CHECK (params IS NULL OR json_valid(params)),
  script_meta TEXT CHECK (script_meta IS NULL OR json_valid(script_meta)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_library_name_type ON library_entries(name, type);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'waiting', 'done', 'error', 'aborted')),
  t0 INTEGER NOT NULL,
  t1 INTEGER,
  aborted INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  skips TEXT CHECK (skips IS NULL OR json_valid(skips)),
  created_at INTEGER NOT NULL
);
-- 「同流程最多一 active run」（C-06 §4③；active=running/waiting）
CREATE UNIQUE INDEX ux_runs_one_active ON runs(flow_id) WHERE status IN ('running', 'waiting');

CREATE TABLE lanes (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  label TEXT NOT NULL,
  cdp_port INTEGER,
  partition TEXT,
  last_url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  lane_id TEXT NOT NULL REFERENCES lanes(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  output TEXT CHECK (output IS NULL OR json_valid(output)),
  error TEXT
);
CREATE INDEX idx_node_runs_run ON node_runs(run_id);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'ok', 'err', 'warn')),
  msg TEXT NOT NULL,
  flow_id TEXT,
  run_id TEXT,
  lane_label TEXT
);
CREATE INDEX idx_logs_flow ON logs(flow_id, id);

CREATE TABLE hit_breakpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  question TEXT NOT NULL,
  options TEXT CHECK (options IS NULL OR json_valid(options)),
  data_snapshot TEXT CHECK (data_snapshot IS NULL OR json_valid(data_snapshot)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped')),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_hit_breakpoints_run ON hit_breakpoints(run_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
);

CREATE TABLE seed_flags (
  flow_id TEXT PRIMARY KEY,
  seeded_at INTEGER NOT NULL
);

CREATE TABLE pending_publish (
  id TEXT PRIMARY KEY,
  meta TEXT NOT NULL CHECK (json_valid(meta)),
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
  },
};

/**
 * v2：种子流程刷新（T6-18；数据迁移形态——PM 追认 2026-11-11）。
 *
 * 背景：T6-16 walk 上线级阻断①——旧种子 f1~f9 为 2~3 节点最小流程且 f4/f5/f8 无触发节点
 * （不可运行），与 demo L1080-1226 构架/01 §9 D-8 剧本不符；种子内容已在代码侧重制
 * （seed-data.ts）。seed_flags 逐流程幂等策略下，仅改种子内容对既有 dev 库不生效——本迁移
 * 清「未改动」旧种子行（flag＋流程行），随后 open 装配序内 seed() 按缺补种重写为新构架。
 * v1 DDL 禁改不动（序列前缀校验天然兼容）；首启空库本迁移为空操作。
 *
 * 「未改动」判定（保守——用户数据一律不动，任一命中即整流保留）：
 *   - flow 行在位且 soft_del=0（用户软删的种子不复活——flows.delete=软删）；
 *   - created_at = updated_at（种子写入两值同源；rename/save 均会推 updated_at）；
 *   - 版本栈只有种子初始版本 `${fid}-v0` 一行（手动/自动/工坊保存都追加版本行）；
 *   - 无 runs 行（run 历史 FK 引用 nodes/flows——历史保留优先于刷新）。
 *
 * 载体渐进面：bare 库（无示例预装挂点）刷新后 f5~f9 由 seed() 暂缓（示例类型未就位不写
 * flag），待 ExamplePreloader 预装后自动补种——与首启路径同语义（T6-18）。
 */
export const V2_SEED_REFRESH: Migration = {
  version: 2,
  name: 'v2-seed-flows-refresh-t6-18',
  up: (conn) => {
    // 目标流程=旧种子 f1~f9（字面冻结——本迁移语义随发布定形，不随 SEED_FLOWS 演进漂移）
    const FLOW_IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] as const;
    const untouched = conn.prepare(
      `SELECT 1 AS ok FROM flows
       WHERE id = :fid AND soft_del = 0 AND created_at = updated_at
         AND (SELECT COUNT(*) FROM flow_versions WHERE flow_id = :fid) = 1
         AND EXISTS (SELECT 1 FROM flow_versions WHERE flow_id = :fid AND id = :fid || '-v0')
         AND NOT EXISTS (SELECT 1 FROM runs WHERE flow_id = :fid)`,
    );
    const delVersions = conn.prepare('DELETE FROM flow_versions WHERE flow_id = :fid');
    const delNodes = conn.prepare('DELETE FROM nodes WHERE flow_id = :fid');
    const delFlag = conn.prepare('DELETE FROM seed_flags WHERE flow_id = :fid');
    const delFlow = conn.prepare('DELETE FROM flows WHERE id = :fid');
    for (const fid of FLOW_IDS) {
      if (untouched.get({ fid }) === undefined) continue;
      // 删序=FK 依赖序（versions→nodes→flows；flag 无 FK）——无 CASCADE，应用层显式连带删（C-06 §4④）
      delVersions.run({ fid });
      delNodes.run({ fid });
      delFlow.run({ fid });
      delFlag.run({ fid });
    }
  },
};

/** 已发布迁移序列（单调递增；禁改既有项，新变更只追加——C-06 §8①） */
export const MIGRATIONS: readonly Migration[] = [V1_BASELINE, V2_SEED_REFRESH];
