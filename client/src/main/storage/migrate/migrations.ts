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

/** 单个迁移（已发布禁改——C-06 §8 扩展点①：V1.1 新表/新列一律走新版本） */
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

/** 已发布迁移序列（单调递增；禁改既有项，新变更只追加——C-06 §8①） */
export const MIGRATIONS: readonly Migration[] = [V1_BASELINE];
