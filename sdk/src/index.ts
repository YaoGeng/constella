// @constella/sdk "." —— 类型面＋identity 参考实现（02 §14 冻结契约；K-01 §1 ts 段）。
//
// NodeOut 纯数据形归 X-01：自 '@constella/shared/dsl' re-export，方向不可反转
// （K-01 §2 裁决——X-01 是 L0 根且 dependencies={} 硬约束，反转即 L0 挂运行时包）。
// ctx 能力形（NodeCtx/各 Cap）归本包域（与 X-01 §8③ 预留一致）。
//
// 运行链路注意：本包源码由 node ≥23.6 原生 type-stripping 直跑（契约测试/C-M1 entry 链路），
// 相对 import 一律带显式 .ts 扩展名（esbuild 打包同样支持——S-5/T4-12 链路）。
export type { NodeOut } from '@constella/shared/dsl';
import type { NodeOut } from '@constella/shared/dsl';
export type {
  AgentCap,
  BrowserCap,
  FileCap,
  ImCap,
  LlmCap,
  LlmContentPart,
  LlmMessage,
  NetCap,
  VaultCap,
} from './caps.ts';
export { SdkCapUnavailableError, unboundCap } from './caps.ts';
import type { AgentCap, BrowserCap, FileCap, ImCap, LlmCap, NetCap, VaultCap } from './caps.ts';

/** 节点脚本运行上下文（02 §14 冻结成员集：params/input＋七 Cap＋log/sleep/emit） */
export interface NodeCtx {
  /** 合并后参数（脚本内置默认 ← config/*.yaml ← 节点实例 params——02 §14 覆盖顺序；合并归 C-M1，本包只承载约定） */
  params: Record<string, unknown>;
  /** 上游交付数据（汇合=最后到达支；单入边=上游 data，02 §14） */
  input: unknown;
  browser: BrowserCap;
  llm: LlmCap;
  net: NetCap;
  file: FileCap;
  im: ImCap;
  vault: VaultCap;
  agent: AgentCap;
  log(msg: string): void;
  sleep(ms: number): Promise<void>;
  /** 命令式分支发射（组合节点内提前出口，demo L1019-1023；声明式见返回值 branch） */
  emit(branch: string, payload?: unknown): Promise<void>;
}

// SDK 参考实现（S-5 判据「import { run } from '@constella/sdk'」值导入形态）：identity 透传
// { data: ctx.input }——节点作者脚本各自导出 run，此参考实现供直接复用。
export async function run(ctx: NodeCtx): Promise<NodeOut> {
  return { data: ctx.input };
}
