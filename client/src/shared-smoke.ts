// T0-12 三端共享类型冒烟（TDD-X-01 §6.4 断言）：
// import 全部六个 subpath（./dsl ./manifest ./dto ./ipc ./constants ./settings）的代表类型与常量
// ——type-only import 与值常量各若干；本文件为纯编译期冒烟，不承载任何运行时逻辑。

// —— ./dsl（类型域：NodeDefinition 聚合根 + N1~N8 + NodeOut）——
import type {
  ExecSpec,
  InnerStep,
  IoContract,
  NodeDefinition,
  NodeMeta,
  NodeOut,
  NodePorts,
  OnFailure,
  ParamField,
  ParamType,
  RunPolicy,
} from '@constella/shared/dsl';
export type SmokeNodeDefinition = NodeDefinition;
export type SmokeDsl = {
  meta: NodeMeta;
  ports: NodePorts;
  params: ParamField[];
  paramT: ParamType;
  exec: ExecSpec | null;
  inner: readonly InnerStep[] | null;
  policy: RunPolicy | null;
  io: IoContract | null;
  onFailure: OnFailure;
  out: NodeOut;
};

// —— ./manifest（PackageManifest / FlowSteps）——
import type { FlowSteps, PackageManifest } from '@constella/shared/manifest';
export type SmokeManifest = { manifest: PackageManifest; steps: FlowSteps };

// —— ./dto（错误/权限/auth/user/market/admin 形）——
import type {
  ErrorBody,
  ErrorCode,
  LoginRes,
  MarketListItem,
  RegisterReq,
  ReviewQueueItem,
  StatsOverview,
  UserProfile,
} from '@constella/shared/dto';
export type SmokeDto = {
  code: ErrorCode;
  body: ErrorBody;
  register: RegisterReq;
  login: LoginRes;
  profile: UserProfile;
  marketItem: MarketListItem;
  reviewItem: ReviewQueueItem;
  stats: StatsOverview;
};

// —— ./ipc（通道常量 + 9 域 payload + IpcError + bridge 帧）——
import type {
  BridgeRequest,
  CreateSessionRes,
  FlowDoc,
  IpcChannel,
  IpcError,
  ScriptEvent,
  SpawnScriptReq,
  StorageInvokeReq,
  StorageInvokeRes,
  SystemInfoRes,
  ZipImportReq,
} from '@constella/shared/ipc';
import {
  BRIDGE_CDP_METHODS,
  BRIDGE_ERROR_CODES,
  BRIDGE_NET_METHODS,
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  IPC_INVOKE_CHANNELS,
  IPC_PUSH_CHANNELS,
  LANE_MEMORY_BUDGET_BYTES,
} from '@constella/shared/ipc';
export type SmokeIpc = {
  channel: IpcChannel;
  ipcError: IpcError;
  spawn: SpawnScriptReq;
  scriptEvent: ScriptEvent;
  createSession: CreateSessionRes;
  systemInfo: SystemInfoRes;
  storageInvoke: StorageInvokeReq;
  flowDoc: FlowDoc;
  zipImport: ZipImportReq;
  bridgeFrame: BridgeRequest;
  storageResult: StorageInvokeRes<'flows.get'>;
};
export const smokeIpcChannels = IPC_CHANNELS;
export const smokeIpcInvokeChannelCount = IPC_INVOKE_CHANNELS.length; // 21（02 §3.4：21 r→m）
export const smokeIpcPushChannelCount = IPC_PUSH_CHANNELS.length; // 3（02 §3.4：3 m→r）
export const smokeIpcUnknownOpCode = IPC_ERROR_CODES.IPC_UNKNOWN_OP;
export const smokeBridgeCdpMethodCount = BRIDGE_CDP_METHODS.length; // 9（T0-07 冻结白名单）
export const smokeBridgeNetMethod = BRIDGE_NET_METHODS[0]; // 'fetch'（NetProxyBridge）
export const smokeBridgeTimeoutCode = BRIDGE_ERROR_CODES.BRIDGE_TIMEOUT;
export const smokeLaneMemoryBudgetBytes = LANE_MEMORY_BUDGET_BYTES; // 150MB（01 §8.1）

// —— ./constants（BUILTIN 三族 + 错误码常量集）——
import {
  BUILTIN_CATEGORIES,
  BUILTIN_TYPE_IDS,
  ERROR_CODES,
  PERM_LABELS,
  STORAGE_DAO_ERROR_CODES,
} from '@constella/shared/constants';
export const smokeBuiltinTypeCount = BUILTIN_TYPE_IDS.length; // 12（01 A-4.01）
export const smokeBuiltinCategories = BUILTIN_CATEGORIES;
export const smokePermLabels = PERM_LABELS;
export const smokeErrorCodeNotFound = ERROR_CODES.NOT_FOUND;
export const smokeDaoCodeFlowNotFound = STORAGE_DAO_ERROR_CODES.FLOW_NOT_FOUND;

// —— ./settings（SettingsSchema + ai.route 形）——
import type {
  ModelProfile,
  RouteConfig,
  SceneKey,
  SettingsKey,
  SettingsSchema,
} from '@constella/shared/settings';
export type SmokeSettings = {
  schema: SettingsSchema;
  key: SettingsKey;
  scene: SceneKey;
  profile: ModelProfile;
  route: RouteConfig;
};
