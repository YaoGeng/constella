// StorageOpsRegistry —— op 白名单→DAO 映射＋参数校验（T1-07；C-06 §1 op 表＝9 域 31 op 冻结）。
//
// 契约：renderer 一切存储访问经 `constella:storage:invoke` {op,args}（通道 handler 归 C-M1/P4）
// → 本注册表：① op ∈ 白名单（未知 → IPC-UNKNOWN-OP）；② args 过校验器（失败 → VALIDATION-FAILED，
// 明细聚合）；③ 命中 DAO/SavePipeline 方法。**无透传 SQL**——每个 op 绑定一个具名方法调用，
// scripts/check-storage-ops.mjs 三方断言（X-01 op 联合 ≡ 03 C-06 §1 表 ≡ 本注册表）。
//
// 危险 op：settings.factoryReset=删库→重迁→重种（编排注入自 StorageLayer；
// node-types/sandbox/backups 目录清理与 app 重启归 C-M1 编排，02 §13.3）。
//
// ⚠ 校验实现：卡面写「Zod」，zod 未在 client 依赖内（禁改 package.json）——以结构等价迷你校验器
// 落地（ops/validators.ts，上报项）。op 键集对 shared StorageOp 联合做编译期 exhaustive 约束。
import { ERROR_CODES } from '@constella/shared/constants';
import { IPC_ERROR_CODES } from '@constella/shared/ipc';
import type { StorageOp } from '@constella/shared/ipc';
import type { ExecSpec, NodeDefinition } from '@constella/shared/dsl';
import type {
  FlowEdge,
  FlowNode,
  FlowVersionLabel,
  HitStatus,
  LibraryEntry,
  LogLevel,
  NodeRunStatus,
  PendingPublishMeta,
  RunStatus,
} from '@constella/shared/ipc';
import type { SettingsKey, SettingsSchema } from '@constella/shared/settings';
import { StorageError } from '../dao/dao-error';
import type { StorageDao } from '../dao';
import type { SavePipeline } from '../save/save-pipeline';
import {
  vAny,
  vArray,
  vBoolean,
  vEnum,
  vNullable,
  vNumber,
  vObject,
  vOptional,
  vRecord,
  vString,
  type Validator,
} from './validators';

/** 白名单 op 键集（字面量源＝C-06 §1 表；check-storage-ops.mjs 的注册表断言面） */
export const STORAGE_OP_KEYS = [
  // flows（7）
  'flows.list',
  'flows.get',
  'flows.create',
  'flows.rename',
  'flows.softDelete',
  'flows.reorder',
  'flows.save',
  // versions（2）
  'versions.list',
  'versions.restore',
  // definitions（2）
  'definitions.loadAll',
  'definitions.upsert',
  // library（3）
  'library.list',
  'library.upsert',
  'library.delete',
  // runs（6）
  'runs.list',
  'runs.get',
  'runs.create',
  'runs.finish',
  'runs.nodeRunStart',
  'runs.nodeRunFinish',
  // logs（2）
  'logs.append',
  'logs.list',
  // settings（3）
  'settings.getAll',
  'settings.set',
  'settings.factoryReset',
  // hits（3）
  'hits.list',
  'hits.create',
  'hits.resolve',
  // publish（3，C-06 补入白名单——02 §3.4 v1.0a 勘误）
  'publish.queue',
  'publish.list',
  'publish.remove',
] as const satisfies readonly StorageOp[];

/** 注册表依赖（StorageLayer 装配注入） */
export interface StorageOpsDeps {
  dao: StorageDao;
  save: SavePipeline;
  /** 危险 op 编排（删库→重迁→重种；StorageLayer.factoryReset） */
  factoryReset: () => void;
}

type NoArgs = Record<string, never>;
const vNoArgs: Validator<NoArgs> = vObject<Record<string, Validator<unknown>>>({}) as Validator<NoArgs>;
/** 无参 op：args 必须缺省（传参=客户端 bug，拒绝以防字段漂移误用） */
const vMaybeNoArgs = (input: unknown): ReturnType<typeof vNoArgs> =>
  input === undefined ? vNoArgs({}) : vNoArgs(input);

// ———————————————————— 各 op 参数校验器（源型=X-01 StorageInvokeReq 细型） ————————————————————

const FLOW_LABELS: readonly FlowVersionLabel[] = ['手动保存', '自动保存', '生成草稿', '流程工坊生成', '初始版本'];
const LOG_LEVELS: readonly LogLevel[] = ['info', 'ok', 'err', 'warn'];
const HIT_STATUSES: readonly HitStatus[] = ['pending', 'resolved', 'skipped'];
const NODE_RUN_STATUSES: readonly NodeRunStatus[] = ['running', 'waiting', 'done', 'error', 'skipped'];
/** runs.finish 只收终态（active 两态由 create/引擎态机管理） */
const RUN_FINISH_STATUSES: readonly RunStatus[] = ['done', 'error', 'aborted'];

const vFlowNode: Validator<FlowNode> = vObject({
  id: vString(),
  type: vString(),
  name: vString(),
  position: vObject({ x: vNumber(), y: vNumber() }),
  params: vRecord(),
  noScript: vOptional(vBoolean()),
}) as Validator<FlowNode>;

const vEndpoint = vArray(vString()) as Validator<[string, string]>;
const vFlowEdge: Validator<FlowEdge> = vObject({
  id: vString(),
  from: vEndpoint,
  to: vEndpoint,
}) as Validator<FlowEdge>;

const vParamField = vRecord();
const vExecSpec: Validator<ExecSpec> = vObject({
  lang: vEnum('python', 'ts'),
  file: vString(),
  entry: vString(),
}) as Validator<ExecSpec>;
const vNodeDefinition: Validator<NodeDefinition> = vObject({
  type: vString(),
  kind: vEnum('builtin', 'custom'),
  meta: vObject({
    name: vString(),
    icon: vString({ min: 0 }),
    category: vString(),
    color: vOptional(vString({ min: 0 })),
    description: vOptional(vString({ min: 0 })),
    author: vOptional(vString({ min: 0 })),
    source: vOptional(vEnum('ai-forge', 'manual', 'plaza', 'zip')),
  }),
  ports: vObject({
    ins: vArray(vString()),
    outs: vArray(vObject({ id: vString(), label: vString() })),
  }),
  paramsSchema: vArray(vParamField),
  exec: vNullable(vExecSpec),
  inner: vOptional(vNullable(vArray(vString()))),
  policy: vOptional(vNullable(vRecord())),
  io: vOptional(vNullable(vRecord())),
  version: vString({ min: 0 }),
  packageVersion: vString({ min: 0 }),
}) as unknown as Validator<NodeDefinition>;

const vLibraryEntry: Validator<LibraryEntry> = vObject({
  id: vString(),
  name: vString(),
  type: vString(),
  params: vRecord(),
  scriptMeta: vObject({ lang: vEnum('python', 'ts'), file: vString() }),
  updatedAt: vNumber(),
}) as Validator<LibraryEntry>;

const vPendingMeta: Validator<PendingPublishMeta> = vObject({
  kind: vEnum('node', 'pack', 'flow'),
  name: vString(),
  summary: vOptional(vString({ min: 0 })),
  checksum: vString(),
}) as Validator<PendingPublishMeta>;

// ———————————————————— op → {校验, 执行} 注册表 ————————————————————

interface OpEntry {
  validate: (args: unknown) => { ok: true; value: unknown } | { ok: false; errors: string[] };
  run: (deps: StorageOpsDeps, args: never) => unknown;
}

/** 31 op 注册表（键集 ≡ STORAGE_OP_KEYS ≡ shared StorageOp——exhaustive 由 Record 约束保证） */
export const STORAGE_OP_ENTRIES: Record<StorageOp, OpEntry> = {
  // —— flows ——
  'flows.list': { validate: vMaybeNoArgs, run: (d) => d.dao.flows.list() },
  'flows.get': {
    validate: (a) => vObject({ id: vString() })(a),
    run: (d, a: { id: string }) => d.dao.flows.get(a.id),
  },
  'flows.create': {
    validate: (a) => vObject({ name: vString() })(a),
    run: (d, a: { name: string }) => d.dao.flows.create(a.name),
  },
  'flows.rename': {
    validate: (a) => vObject({ id: vString(), name: vString() })(a),
    run: (d, a: { id: string; name: string }) => {
      d.dao.flows.rename(a.id, a.name);
    },
  },
  'flows.softDelete': {
    validate: (a) => vObject({ id: vString() })(a),
    run: (d, a: { id: string }) => {
      d.dao.flows.softDelete(a.id);
    },
  },
  'flows.reorder': {
    validate: (a) => vObject({ ids: vArray(vString()) })(a),
    run: (d, a: { ids: string[] }) => {
      d.dao.flows.reorder(a.ids);
    },
  },
  'flows.save': {
    validate: (a) =>
      vObject({
        id: vString(),
        name: vString(),
        nodes: vArray(vFlowNode),
        edges: vArray(vFlowEdge),
        label: vEnum(...FLOW_LABELS),
      })(a),
    run: (d, a: { id: string; name: string; nodes: FlowNode[]; edges: FlowEdge[]; label: FlowVersionLabel }) =>
      d.save.saveFlow({ id: a.id, name: a.name, nodes: a.nodes, edges: a.edges, label: a.label }),
  },
  // —— versions ——
  'versions.list': {
    validate: (a) => vObject({ flowId: vString() })(a),
    run: (d, a: { flowId: string }) => d.dao.versions.list(a.flowId),
  },
  'versions.restore': {
    validate: (a) => vObject({ flowId: vString(), versionId: vString() })(a),
    run: (d, a: { flowId: string; versionId: string }) => d.save.restoreVersion(a.flowId, a.versionId),
  },
  // —— definitions ——
  'definitions.loadAll': { validate: vMaybeNoArgs, run: (d) => d.dao.definitions.loadAll() },
  'definitions.upsert': {
    validate: (a) => vObject({ doc: vNodeDefinition })(a),
    run: (d, a: { doc: NodeDefinition }) => {
      d.dao.definitions.upsert(a.doc);
    },
  },
  // —— library ——
  'library.list': { validate: vMaybeNoArgs, run: (d) => d.dao.library.list() },
  'library.upsert': {
    validate: (a) => vObject({ entry: vLibraryEntry })(a),
    run: (d, a: { entry: LibraryEntry }) => {
      d.dao.library.upsert(a.entry);
    },
  },
  'library.delete': {
    validate: (a) => vObject({ id: vString() })(a),
    run: (d, a: { id: string }) => {
      d.dao.library.delete(a.id);
    },
  },
  // —— runs ——
  'runs.list': { validate: vMaybeNoArgs, run: (d) => d.dao.runs.list() },
  'runs.get': {
    validate: (a) => vObject({ runId: vString() })(a),
    run: (d, a: { runId: string }) => d.dao.runs.get(a.runId),
  },
  'runs.create': {
    validate: (a) => vObject({ flowId: vString(), name: vString() })(a),
    run: (d, a: { flowId: string; name: string }) => d.dao.runs.create(a.flowId, a.name),
  },
  'runs.finish': {
    validate: (a) =>
      vObject({
        runId: vString(),
        status: vEnum(...RUN_FINISH_STATUSES),
        t1: vOptional(vNumber()),
        aborted: vOptional(vNumber()),
        failed: vOptional(vNumber()),
        total: vOptional(vNumber()),
        skips: vOptional(vArray(vAny())),
      })(a),
    run: (
      d,
      a: {
        runId: string;
        status: RunStatus;
        t1?: number;
        aborted?: number;
        failed?: number;
        total?: number;
        skips?: unknown[];
      },
    ) => {
      d.dao.runs.finish(a);
    },
  },
  'runs.nodeRunStart': {
    validate: (a) =>
      vObject({ nodeRunId: vString(), runId: vString(), laneId: vString(), nodeId: vString() })(a),
    run: (d, a: { nodeRunId: string; runId: string; laneId: string; nodeId: string }) => {
      d.dao.nodeRuns.nodeRunStart(a);
    },
  },
  'runs.nodeRunFinish': {
    validate: (a) =>
      vObject({
        nodeRunId: vString(),
        status: vEnum(...NODE_RUN_STATUSES),
        endedAt: vOptional(vNumber()),
        output: vOptional(vNullable(vAny())),
        error: vOptional(vNullable(vString({ min: 0 }))),
      })(a),
    run: (
      d,
      a: { nodeRunId: string; status: NodeRunStatus; endedAt?: number; output?: unknown; error?: string | null },
    ) => {
      d.dao.nodeRuns.nodeRunFinish(a as Parameters<typeof d.dao.nodeRuns.nodeRunFinish>[0]);
    },
  },
  // —— logs ——
  'logs.append': {
    validate: (a) =>
      vObject({
        level: vEnum(...LOG_LEVELS),
        msg: vString(),
        flowId: vOptional(vString()),
        runId: vOptional(vString()),
        laneLabel: vOptional(vString()),
      })(a),
    run: (
      d,
      a: { level: LogLevel; msg: string; flowId?: string; runId?: string; laneLabel?: string },
    ) => {
      d.dao.logs.append(a);
    },
  },
  'logs.list': {
    validate: (a) =>
      vObject({
        flowId: vOptional(vString()),
        runId: vOptional(vString()),
        beforeId: vOptional(vNumber()),
        limit: vOptional(vNumber()),
      })(a),
    run: (d, a: { flowId?: string; runId?: string; beforeId?: number; limit?: number }) =>
      d.dao.logs.list(a),
  },
  // —— settings ——
  'settings.getAll': { validate: vMaybeNoArgs, run: (d) => d.dao.settings.getAll() },
  'settings.set': {
    validate: (a) => vObject({ key: vString(), value: vAny() })(a),
    run: (d, a: { key: SettingsKey; value: SettingsSchema[SettingsKey] }) => {
      d.dao.settings.set(a.key, a.value);
    },
  },
  'settings.factoryReset': {
    validate: vMaybeNoArgs,
    run: (d) => {
      d.factoryReset();
    },
  },
  // —— hits ——
  'hits.list': {
    validate: (a) => vObject({ runId: vString(), status: vOptional(vEnum(...HIT_STATUSES)) })(a),
    run: (d, a: { runId: string; status?: HitStatus }) => d.dao.hits.list(a.runId, a.status),
  },
  'hits.create': {
    validate: (a) =>
      vObject({
        runId: vString(),
        nodeId: vString(),
        question: vString(),
        options: vArray(vAny()),
        dataSnapshot: vAny(),
      })(a),
    run: (d, a: { runId: string; nodeId: string; question: string; options: unknown[]; dataSnapshot: unknown }) =>
      d.dao.hits.create(a),
  },
  'hits.resolve': {
    validate: (a) => vObject({ id: vString(), status: vEnum(...HIT_STATUSES), payload: vAny() })(a),
    run: (d, a: { id: string; status: HitStatus; payload: unknown }) => {
      d.dao.hits.resolve(a.id, a.status, a.payload);
    },
  },
  // —— publish ——
  'publish.queue': {
    validate: (a) => vObject({ meta: vPendingMeta, filePath: vString() })(a),
    run: (d, a: { meta: PendingPublishMeta; filePath: string }) => d.dao.pendingPublish.queue(a.meta, a.filePath),
  },
  'publish.list': { validate: vMaybeNoArgs, run: (d) => d.dao.pendingPublish.list() },
  'publish.remove': {
    validate: (a) => vObject({ id: vString() })(a),
    run: (d, a: { id: string }) => {
      d.dao.pendingPublish.remove(a.id);
    },
  },
};

/**
 * op 白名单注册表（C-M1 StorageService 的消费面）。
 * invoke(op, args)：未知 op → StorageError(IPC-UNKNOWN-OP)；校验失败 → VALIDATION-FAILED；
 * DAO 业务错误（STORAGE_DAO_ERROR_CODES）原样透传。
 */
export class StorageOpsRegistry {
  constructor(private readonly deps: StorageOpsDeps) {}

  get ops(): readonly string[] {
    return STORAGE_OP_KEYS;
  }

  invoke(op: string, args?: unknown): unknown {
    const entry = (STORAGE_OP_ENTRIES as Record<string, OpEntry | undefined>)[op];
    if (entry === undefined) {
      throw new StorageError(IPC_ERROR_CODES.IPC_UNKNOWN_OP, `未知存储操作：${op}`);
    }
    const parsed = entry.validate(args);
    if (!parsed.ok) {
      throw new StorageError(
        ERROR_CODES.VALIDATION_FAILED,
        `存储操作参数校验失败（${op}）：${parsed.errors.join('；')}`,
      );
    }
    return entry.run(this.deps, parsed.value as never);
  }
}
