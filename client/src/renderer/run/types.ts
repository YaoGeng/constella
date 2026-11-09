// RunEngine 契约类型（TDD-C-03 §1 对外接口签名逐字对齐；T4-01 骨架）。
// imports ↓ 仅 X-01 纯类型（§2）——storage/registry/Transport/toast 全部注入，零同层运行时依赖。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { LogLevel } from '@constella/shared/ipc';

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

/** 执行面传输注入位（§8 替换点①——实装=preload 面，协议不变）；缺省=无 cron 源 */
export interface RunTransport {
  /** cron 到点推送（cron:fired，02 §3.4）——到点复查三闸后 startRun（01 A-6.6） */
  onCronFired(fn: (e: { flowId: string }) => void): () => void;
}

/** toast 注入位（三种违例各自 toast＋日志，02 §10 #9）；应用壳接 uiStore toast 队列，缺省仅日志 */
export type NotifyFn = (level: LogLevel, msg: string) => void;
