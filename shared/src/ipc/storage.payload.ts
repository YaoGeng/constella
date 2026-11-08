// storage 域 payload（X-01 §1 ipc 行；02 §3.4 storage:invoke；C-06 §1 op 白名单表＝
// 9 域 31 op 冻结源（02 §3.4 原生 8 域 28 op＋C-06 补 publish 域 3 op，v1.0a 勘误）；
// C-M1 §1：错误码 IPC-UNKNOWN-OP / VALIDATION-FAILED / DAO 业务码透传——DAO 业务码常量集
// 见 ../constants/error-codes.ts STORAGE_DAO_ERROR_CODES）。
// 行级形以 02 §7.1 字段表为准；本文件 31 op 联合＝X-01 §1 M4 收口增补 ②④（StorageInvokeReq
// 细型＋FlowDoc 载荷形落位本域）。
import type { NodeDefinition, NodeOut } from '../dsl/index';
import type { PackageKind } from '../manifest/package-manifest';
import type { SettingsKey, SettingsSchema } from '../settings/settings-keys';

// ————————————————————————————————————————————
// FlowDoc 载荷形（✅ P2-10：nodes/edges 序列化子集＝02 §3.3＋C-01 §4 语义字段）
// ————————————————————————————————————————————

/** 节点实例序列化形（02 §3.3「xyflow 格式＋demo 语义字段」：position 对象＝xyflow 节点位形，
 * params＝demo 语义字段；02 §7.1 nodes 表列：type/name/x/y/params/no_script） */
export interface FlowNode {
  id: string;
  /** FK→node_definitions.type */
  type: string;
  name: string;
  /** xyflow 节点位形（02 §3.3「序列化为 xyflow 格式」原文；demo 平铺 x/y 为参照非权威） */
  position: { x: number; y: number };
  /** 实例参数（抽屉保存；PARAMS ← config ← 实例 params 覆盖序的末层，02 §14） */
  params: Record<string, unknown>;
  /** 无脚本标记（缺 scripts/ 资产的强节点；运行闸拦截，02 §8.4） */
  noScript?: boolean;
}

/** 边端点＝端口元组 [nodeId, portId]（C-01 §4「边 from/to 端口元组」；demo L1094 序列化形） */
export type FlowEdgeEndpoint = readonly [nodeId: string, portId: string];

export interface FlowEdge {
  id: string;
  from: FlowEdgeEndpoint;
  to: FlowEdgeEndpoint;
}

/** 流程文档（C-01 serialize() 形 ↔ C-06 flows.save {id,name,nodes,edges,label}；P2-10 落位本域） */
export interface FlowDoc {
  id?: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ————————————————————————————————————————————
// 行级形（02 §7.1 字段表；行↔类型转换实现于 C-06 DAO）
// ————————————————————————————————————————————

export interface FlowListItem {
  id: string;
  name: string;
  orderIdx: number;
  createdAt: number;
  updatedAt: number;
}

/** 版本 label 五值（02 §7.1 flow_versions.label；C-06 §1 flows.save 行） */
export type FlowVersionLabel = '手动保存' | '自动保存' | '生成草稿' | '流程工坊生成' | '初始版本';

/** 版本元数据（versions.list LIFO 元素；02 §7.1 flow_versions：label/node_count/edge_count/created_at） */
export interface VersionMeta {
  id: string;
  flowId: string;
  label: FlowVersionLabel;
  nodeCount: number;
  edgeCount: number;
  createdAt: number;
}

/** 版本快照（restore 只读返回，恢复呈 dirty；02 §7.1 snapshot JSON(nodes+edges) 全量） */
export interface FlowSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 节点库条目（02 §7.1 library_entries：params 参数模板/script_meta{lang,file}；同名同型 upsert） */
export interface LibraryEntry {
  id: string;
  name: string;
  type: string;
  params: Record<string, unknown>;
  scriptMeta: { lang: 'python' | 'ts'; file: string };
  updatedAt: number;
}

/** run 状态五值（02 §7.1 runs.status；「同流程最多一 active run」＝running/waiting） */
export type RunStatus = 'running' | 'waiting' | 'done' | 'error' | 'aborted';

export interface RunSummary {
  id: string;
  flowId: string;
  name: string;
  status: RunStatus;
  t0: number;
  t1: number | null;
  aborted: number;
  failed: number;
  total: number;
  skips: unknown[];
  createdAt: number;
}

/** 节点运行态五态（C-01 五态徽标 running/done/error/skipped/waiting；demo idle=未运行不入表） */
export type NodeRunStatus = 'running' | 'waiting' | 'done' | 'error' | 'skipped';

/** node_runs 行（02 §7.1：output JSON({data}|{branch,meta})＝NodeOut，B-13 真实 IO 落库） */
export interface NodeRunRecord {
  id: string;
  runId: string;
  laneId: string;
  nodeId: string;
  status: NodeRunStatus;
  startedAt: number | null;
  endedAt: number | null;
  output: NodeOut | null;
  error: string | null;
}

export interface RunDetail extends RunSummary {
  nodeRuns: NodeRunRecord[];
}

export type LogLevel = 'info' | 'ok' | 'err' | 'warn';

export interface LogRecord {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
  flowId: string | null;
  runId: string | null;
  laneLabel: string | null;
}

export type HitStatus = 'pending' | 'resolved' | 'skipped';

/** hit_breakpoints 行（02 §7.1；A-7 断点，B-4 data_snapshot＝上游真实输出） */
export interface HitRecord {
  id: string;
  runId: string;
  nodeId: string;
  question: string;
  options: unknown[];
  dataSnapshot: unknown;
  status: HitStatus;
  payload: unknown;
  createdAt: number;
  resolvedAt: number | null;
}

/** 待发布队列项 meta（02 §1.3/C-06 §1 publish 行：幂等键=内容 SHA-256 存 meta；
 * C-09 Publisher 消费——kind/name/summary 为发布三要素（02 §6.2 multipart），checksum=幂等键） */
export interface PendingPublishMeta {
  kind: PackageKind;
  name: string;
  summary?: string;
  /** zip 内容 SHA-256（幂等键） */
  checksum: string;
}

/** pending_publish 行（02 §7.1：meta/file_path/created_at） */
export interface PendingPublishItem {
  id: string;
  meta: PendingPublishMeta;
  filePath: string;
  createdAt: number;
}

// ————————————————————————————————————————————
// 31 op 联合（C-06 §1 表冻结；op 字面量＝'<域>.<方法>'）
// ————————————————————————————————————————————
// 注：C-06 §1 表对部分 op 未注明返回形（标 ⚠ 初值处）——按 flows.list {items} 惯例/同域近形补全，
// 随 C-06/M5 任务卡校准；req args 形全部有表锚。

export type StorageInvokeReq =
  // flows（7）
  | { op: 'flows.list' }
  | { op: 'flows.get'; args: { id: string } }
  | { op: 'flows.create'; args: { name: string } }
  | { op: 'flows.rename'; args: { id: string; name: string } }
  | { op: 'flows.softDelete'; args: { id: string } }
  | { op: 'flows.reorder'; args: { ids: string[] } }
  | { op: 'flows.save'; args: { id: string; name: string; nodes: FlowNode[]; edges: FlowEdge[]; label: FlowVersionLabel } }
  // versions（2）
  | { op: 'versions.list'; args: { flowId: string } }
  | { op: 'versions.restore'; args: { flowId: string; versionId: string } }
  // definitions（2）
  | { op: 'definitions.loadAll' }
  | { op: 'definitions.upsert'; args: { doc: NodeDefinition } }
  // library（3）
  | { op: 'library.list' }
  | { op: 'library.upsert'; args: { entry: LibraryEntry } }
  | { op: 'library.delete'; args: { id: string } }
  // runs（6）
  | { op: 'runs.list' }
  | { op: 'runs.get'; args: { runId: string } }
  | { op: 'runs.create'; args: { flowId: string; name: string } }
  | { op: 'runs.finish'; args: { runId: string; status: RunStatus; t1?: number; aborted?: number; failed?: number; total?: number; skips?: unknown[] } }
  | { op: 'runs.nodeRunStart'; args: { nodeRunId: string; runId: string; laneId: string; nodeId: string } }
  | { op: 'runs.nodeRunFinish'; args: { nodeRunId: string; status: NodeRunStatus; endedAt?: number; output?: NodeOut | null; error?: string | null } }
  // logs（2）
  | { op: 'logs.append'; args: { level: LogLevel; msg: string; flowId?: string; runId?: string; laneLabel?: string } }
  | { op: 'logs.list'; args: { flowId?: string; runId?: string; beforeId?: number; limit?: number } }
  // settings（3）
  | { op: 'settings.getAll' }
  | { op: 'settings.set'; args: { key: SettingsKey; value: SettingsSchema[SettingsKey] } }
  | { op: 'settings.factoryReset' }
  // hits（3）
  | { op: 'hits.list'; args: { runId: string; status?: HitStatus } }
  | { op: 'hits.create'; args: { runId: string; nodeId: string; question: string; options: unknown[]; dataSnapshot: unknown } }
  | { op: 'hits.resolve'; args: { id: string; status: HitStatus; payload: unknown } }
  // publish（3，C-06 补入白名单——02 §3.4 v1.0a 勘误同步）
  | { op: 'publish.queue'; args: { meta: PendingPublishMeta; filePath: string } }
  | { op: 'publish.list' }
  | { op: 'publish.remove'; args: { id: string } };

/** 白名单 op 字面量集合（storageClient.invoke(op: StorageOp, args) 消费；check-storage-ops.mjs 断言面） */
export type StorageOp = StorageInvokeReq['op'];

/** op → 结果映射（结果形锚：C-06 §1 表注明者照抄；标「⚠ 初值」者＝表未注明返回形、
 * 按 flows.list {items} 惯例补全，随 C-06/M5 任务卡校准） */
export interface StorageOpResults {
  /** → {items}（过滤 soft_del=0） */
  'flows.list': { items: FlowListItem[] };
  /** → 当前文档（栈顶 snapshot） */
  'flows.get': FlowDoc;
  /** → {id}（并打「初始版本」） */
  'flows.create': { id: string };
  'flows.rename': void;
  'flows.softDelete': void;
  'flows.reorder': void;
  /** → {versionId}（SavePipeline 事务，02 §13.1） */
  'flows.save': { versionId: string };
  /** → LIFO 元数据 */
  'versions.list': VersionMeta[];
  /** → snapshot（只读返回不落盘，恢复呈 dirty） */
  'versions.restore': FlowSnapshot;
  'definitions.loadAll': NodeDefinition[];
  'definitions.upsert': void;
  'library.list': { items: LibraryEntry[] }; // ⚠ 初值（表未注明返回形）
  'library.upsert': void;
  'library.delete': void;
  'runs.list': { items: RunSummary[] }; // ⚠ 初值（同上）
  /** →（含 node_runs） */
  'runs.get': RunDetail;
  'runs.create': { id: string };
  'runs.finish': void; // ⚠ 初值
  'runs.nodeRunStart': void; // ⚠ 初值
  'runs.nodeRunFinish': void; // ⚠ 初值（output={data}|{branch,meta} 落库）
  'logs.append': void;
  'logs.list': LogRecord[]; // ⚠ 初值（表列 list→重放；按数组返回）
  'settings.getAll': Partial<SettingsSchema>;
  'settings.set': void;
  /** 危险 op：删库→重迁→重种（node-types/sandbox/backups 目录清理与 app 重启归 C-M1 编排） */
  'settings.factoryReset': void;
  'hits.list': { items: HitRecord[] }; // ⚠ 初值
  'hits.create': { id: string }; // ⚠ 初值（resolve 需 id）
  'hits.resolve': void; // ⚠ 初值
  'publish.queue': { id: string }; // ⚠ 初值
  'publish.list': { items: PendingPublishItem[] }; // ⚠ 初值
  'publish.remove': void; // ⚠ 初值
}

/** 按 op 取结果形：StorageInvokeRes<'flows.get'> = FlowDoc */
export type StorageInvokeRes<TOp extends StorageOp = StorageOp> = StorageOpResults[TOp];
