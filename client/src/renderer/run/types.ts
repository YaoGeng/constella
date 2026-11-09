// RunEngine 契约类型（TDD-C-03 §1 对外接口签名逐字对齐；T4-01 骨架＋T4-02 执行链扩展）。
// imports ↓ 仅 X-01 纯类型（§2）——storage/registry/Transport/toast 全部注入，零同层运行时依赖。
import type { NodeDefinition } from '@constella/shared/dsl';
import type {
  BridgeRequest,
  BridgeResponse,
  CreateSessionReq,
  CreateSessionRes,
  LogLevel,
  NavigateReq,
  NavigateRes,
  ScriptEvent,
  SpawnScriptReq,
  SpawnScriptRes,
} from '@constella/shared/ipc';

/** 节点运行态五态（§1 NodeStatusEvent.status；idle=未运行不入 statuses，demo L1075 语义） */
export type NodeStatus = 'running' | 'done' | 'error' | 'skipped' | 'waiting';

/** §1 事件流事件形（02 §3.2 onNodeStatus；laneLabel 随 T4-02 lane 语义填入） */
export interface NodeStatusEvent {
  runId: string;
  nodeId: string;
  status: NodeStatus;
  laneLabel?: string;
  error?: string;
}

/** §1 运行句柄：statuses=内存数据源（A-6.5 双写），只读视图与内部同引用（运行中实时刷新） */
export interface RunHandle {
  runId: string;
  statuses: Readonly<Record<string, string>>;
}

/** 日志事件行（§1 onRunLog；形=logs 表行去 id——02 §7.1 logs 列） */
export interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  flowId?: string;
  runId?: string;
  laneLabel?: string;
}

/** 运行闸拒绝原因（三查＝dirty/duplicate/no-trigger；broken-def/no-script=02 §12.4 附加拦截） */
export type GateReason = 'dirty' | 'duplicate' | 'no-trigger' | 'broken-def' | 'no-script';

/** §3 RunGate 组件级返回形 */
export type GateResult = { ok: true } | { ok: false; reason: GateReason; message: string };

/**
 * 注册表注入面（C-05 十方法的最小结构子集——get/isBroken；§2 imports ↓ C-05）。
 * 结构化接口而非 import 全量面：装配点注入真实现、测试注入 fake（P-3 无上层 import）。
 */
export interface RunRegistryLike {
  get(type: string): NodeDefinition | undefined;
  isBroken(type: string): boolean;
}

/**
 * lane（并行分支）标识（02 §10 #4：多出边=扇出且每支新 lane——独立日志前缀/独立会话/partition）。
 * key：触发支='main'（单触发）/'t:<nodeId>'（多触发）；扇出支=该支首个节点 id（demo L1940/L1850）。
 * label：单触发=流程名；多触发/扇出支=节点名——日志前缀与 lane 会话 label 同源。
 */
export interface Lane {
  key: string;
  label: string;
}

/**
 * 执行面传输注入位（§8 替换点①——实装=preload 面，协议不变）；缺省=无 cron 源＋脚本/会话通道不可用
 * （custom/cdp.* 分派抛错=节点 error）。T4-01 起含 cron；T4-02 扩 run:spawnScript/run:scriptEvent
 * ＋cdp:createSession/cdp:navigate（02 §3.4；killScript/destroyRun/env:cdpProbe 随 T4-03 续扩）。
 */
export interface RunTransport {
  /** cron 到点推送（cron:fired，02 §3.4）——到点复查三闸后 startRun（01 A-6.6） */
  onCronFired(fn: (e: { flowId: string }) => void): () => void;
  /** run:spawnScript（r→m）：custom 强节点脚本进程（payload=X-01 SpawnScriptReq） */
  spawnScript(req: SpawnScriptReq): Promise<SpawnScriptRes>;
  /** run:scriptEvent（m→r 推送）：stdout JSON 行协议/exit 帧（S-5 冻结，K-01 bootstrap） */
  onScriptEvent(fn: (e: ScriptEvent) => void): () => void;
  /** cdp:createSession：lane 首个 cdp.* 节点建会话（02 §3.4；B-10） */
  cdpCreateSession(req: CreateSessionReq): Promise<CreateSessionRes>;
  /** cdp:navigate：同 lane 后续 cdp.* 复用会话只更新 URL（A-8.1） */
  cdpNavigate(req: NavigateReq): Promise<NavigateRes>;
}

/**
 * 命令传输注入位（M4 PM 裁决 3 方案 A：cdp.* 内置命令经 lane 桥 ws 直发——帧形=T0-07 冻结
 * bridge.ts；id 由实现按连接单调分配）。实装=ws client 随 T4-05 共用，本卡 fake 先行。
 */
export interface CommandTransport {
  send(req: Omit<BridgeRequest, 'id'>): Promise<BridgeResponse>;
}

/** toast 注入位（三种违例各自 toast＋日志，02 §10 #9）；应用壳接 uiStore toast 队列，缺省仅日志 */
export type NotifyFn = (level: LogLevel, msg: string) => void;
