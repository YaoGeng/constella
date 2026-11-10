// 21 r→m 通道 payload 校验表（T4-14 / TDD-C-M1 §3 IpcGateway 行「payload Zod 校验（源型=X-01）」）。
//
// 源型=shared @constella/shared/ipc 9 域 payload（app/env/dialog/storage/secret/run/cdp/cron/zip）；
// 校验失败 → VALIDATION-FAILED（02 §6.1 复用，C-M1 §1 铁律）。Record 穷尽约束：新增/改名通道
// （24 通道冻结）或漏配校验器都在编译期报错。
//
// 边界口径（避免与业务错误码抢占——§1 矩阵）：
//   - 本层只做「形状」校验；语义判定归各服务 handler：
//     · run:spawnScript.lang 只验 string——'py'|'ts' 枚举外值 → RUN-INVALID-LANG 归 SandboxExecutor（T4-16）；
//     · cron:upsert.cron 只验非空 string——CRON-INVALID-EXPR 归 CronParser（T4-19）；
//     · shell:openExternal.url 缺失/非 string → 本层 VALIDATION-FAILED；http/https 语义 →
//       SHELL-INVALID-URL 归 AppRuntime 域 handler（T4-13）。
//   - storage:invoke 通道级形状：{op: 非空 string, args?: 普通对象}——31-op 白名单判定
//     （IPC-UNKNOWN-OP）与 per-op args 深校验（VALIDATION-FAILED）归 StorageService 桥接
//     （T4-20，经 T1-07 StorageOpsRegistry），本层不重叠（§6.5a 归 T4-20）。
import { IPC_INVOKE_CHANNELS } from '@constella/shared/ipc';
import {
  fail,
  ok,
  vAny,
  vArray,
  vEnum,
  vNumber,
  vObject,
  vOptional,
  vRecord,
  vString,
  type Validated,
  type Validator,
} from './validators';

/** r→m invoke 通道名（21；X-01 未导出细型——自 IPC_INVOKE_CHANNELS 收窄） */
export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number];

export type PayloadValidator = Validator<unknown>;

/** 空 payload 通道（02 §3.4 `{}`）：undefined 与 {} 合法；未知字段拒绝 */
const vEmptyPayload: PayloadValidator = (input) => (input === undefined ? ok({}) : vObject({})(input));

/** dialog:openFile filters 元素（Electron FileFilter 形，X-01 dialog 域） */
const vFileFilter = vObject({ name: vOptional(vString({ min: 0 })), extensions: vArray(vString({ min: 0 })) });

/** zip:export 双变体（02 v1.0b：流程导出 {flowId,savePath}｜发布打包 {types[],savePath,meta}） */
const vZipExport: PayloadValidator = (input) => {
  const flow = vObject({ flowId: vString(), savePath: vString() })(input);
  if (flow.ok) return flow;
  const publish = vObject({ types: vArray(vString()), savePath: vString(), meta: vObject({ name: vString() }) })(
    input,
  );
  if (publish.ok) return publish;
  return fail([
    ...flow.errors.map((e) => `变体A(流程导出) ${e}`),
    ...publish.errors.map((e) => `变体B(发布打包) ${e}`),
  ]);
};

/** Uint8Array 校验（bytes 变体——02 v1.0e；局部定义不扩 validators 公共面） */
const vBytes: PayloadValidator = (input) =>
  input instanceof Uint8Array ? ok(input) : fail(['须为 Uint8Array（字节源）']);

/** zip:import 两段式×双源（02 v1.0b：inspect {path,phase}｜commit {path,phase,token}；
 * ✅ 02 v1.0e：bytes 变体 {bytes,phase[,token]}——download 字节直入，通道面不变） */
const vZipImport: PayloadValidator = (input) => {
  const inspect = vObject({ path: vString(), phase: vEnum('inspect') })(input);
  if (inspect.ok) return inspect;
  const commit = vObject({ path: vString(), phase: vEnum('commit'), token: vString() })(input);
  if (commit.ok) return commit;
  const bytesInspect = vObject({ bytes: vBytes, phase: vEnum('inspect') })(input);
  if (bytesInspect.ok) return bytesInspect;
  const bytesCommit = vObject({ bytes: vBytes, phase: vEnum('commit'), token: vString() })(input);
  if (bytesCommit.ok) return bytesCommit;
  return fail([...inspect.errors, ...commit.errors, ...bytesInspect.errors, ...bytesCommit.errors]);
};

/**
 * 21 r→m 通道校验表（键=通道全名；Record 穷尽=24 通道冻结的编译期守护）。
 * zip:* 装配位：通道注册面已留（handler 骨架随 T4-20、管线注入随 C-08〔P5〕）。
 */
export const CHANNEL_PAYLOAD_VALIDATORS: Record<IpcInvokeChannel, PayloadValidator> = {
  [IPC_INVOKE_CHANNELS[0]]: vEmptyPayload, // constella:app:version
  [IPC_INVOKE_CHANNELS[1]]: vEmptyPayload, // constella:env:systemInfo
  [IPC_INVOKE_CHANNELS[2]]: vEmptyPayload, // constella:env:cdpProbe
  [IPC_INVOKE_CHANNELS[3]]: vObject({ url: vString() }), // constella:shell:openExternal
  [IPC_INVOKE_CHANNELS[4]]: vObject({ filters: vOptional(vArray(vFileFilter)) }), // constella:dialog:openFile
  [IPC_INVOKE_CHANNELS[5]]: vObject({ defaultName: vOptional(vString({ min: 0 })) }), // constella:dialog:saveFile
  [IPC_INVOKE_CHANNELS[6]]: vObject({ op: vString(), args: vOptional(vRecord()) }), // constella:storage:invoke
  [IPC_INVOKE_CHANNELS[7]]: vObject({ key: vString(), value: vOptional(vString()) }), // constella:secret:set
  [IPC_INVOKE_CHANNELS[8]]: vObject({ key: vString() }), // constella:secret:get
  [IPC_INVOKE_CHANNELS[9]]: vObject({ key: vString() }), // constella:secret:del
  // constella:run:spawnScript（SpawnScriptReq；lang 枚举语义 RUN-INVALID-LANG 归 handler——见文件头）
  [IPC_INVOKE_CHANNELS[10]]: vObject({
    nodeRunId: vString(),
    lang: vString(),
    scriptPath: vString(),
    entry: vString(),
    params: vRecord(),
    input: vAny(),
    configYaml: vOptional(vString()),
    timeoutMs: vNumber(),
    retries: vNumber(),
    scene: vOptional(vString()),
    laneKey: vOptional(vString()),
  }),
  [IPC_INVOKE_CHANNELS[11]]: vObject({ nodeRunId: vString() }), // constella:run:killScript
  [IPC_INVOKE_CHANNELS[12]]: vObject({
    runId: vString(),
    laneKey: vString(),
    label: vString(),
    startUrl: vString(),
  }), // constella:cdp:createSession
  [IPC_INVOKE_CHANNELS[13]]: vObject({ runId: vString(), laneKey: vString(), url: vString() }), // constella:cdp:navigate
  [IPC_INVOKE_CHANNELS[14]]: vObject({ runId: vString() }), // constella:cdp:listSessions
  [IPC_INVOKE_CHANNELS[15]]: vObject({ runId: vString(), laneKey: vString() }), // constella:cdp:openViewer
  [IPC_INVOKE_CHANNELS[16]]: vObject({ runId: vString() }), // constella:cdp:destroyRun
  [IPC_INVOKE_CHANNELS[17]]: vObject({ flowId: vString(), cron: vString() }), // constella:cron:upsert
  [IPC_INVOKE_CHANNELS[18]]: vObject({ flowId: vString() }), // constella:cron:cancel
  [IPC_INVOKE_CHANNELS[19]]: vZipExport, // constella:zip:export（装配位）
  [IPC_INVOKE_CHANNELS[20]]: vZipImport, // constella:zip:import（装配位）
};

/** 通道级 payload 校验入口（IpcGateway handle 半段消费） */
export function validateInvokePayload(channel: IpcInvokeChannel, payload: unknown): Validated<unknown> {
  const validator = CHANNEL_PAYLOAD_VALIDATORS[channel];
  if (validator === undefined) {
    // 不可达（Record 穷尽＋注册白名单前置）；防御性兜底
    return fail([`无校验器的通道：${channel}`]);
  }
  return validator(payload);
}
