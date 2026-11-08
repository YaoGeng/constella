// run 域 payload（X-01 §1 ipc 行；02 §3.4 run:spawnScript / run:killScript / run:scriptEvent；
// C-M1 §1 Sandbox 行 + M4 收口增补 ⑤⑦：可选 scene（PM 裁决 5 场景注入径，C-18 §1③，V1.1）与
// 可选 laneKey（✅ T0-06 会签：browser 绑定解析——lane 会话存在→注入 CDP_WS，additive 可选字段）。
// spawn 协议细节（stdout JSON 行/exit 0|1|2/看门狗）＝S-5 冻结，归 C-M1/K-01，不属 payload 面）。
import type { SceneKey } from '../settings/settings-keys';

/** run:spawnScript（r→m）：{nodeRunId,lang:'py'|'ts',scriptPath,entry,params,input,configYaml,
 * timeoutMs,retries} → {ok,pid}（02 §3.4 原文形＋M4 增补可选 scene/laneKey）。
 * 脚本路径限 node-types/ 资产白名单（02 §12.2#3）；试跑同面（B-5）；
 * timeoutMs=0/retries=0＝N6 显式 0 值语义（02 §8.6）。 */
export interface SpawnScriptReq {
  nodeRunId: string;
  /** 注意字面量＝'py'|'ts'（02 §3.4 原文；与 N4 ExecSpec.lang 'python'|'ts' 不同源）；
   * 非法值→RUN-INVALID-LANG */
  lang: 'py' | 'ts';
  scriptPath: string;
  entry: string;
  /** 合并后参数（PARAMS ← config ← 实例 params，02 §14；req 携 configYaml 时由 C-M1 按冻结序合并） */
  params: Record<string, unknown>;
  /** 上游交付数据（汇合=最后到达支；单入边=上游 data，02 §14） */
  input: unknown;
  /** 包级默认配置原文（可选；C-M1 configYaml 合并语义，M4 #5） */
  configYaml?: string;
  /** N6 超时守护（0＝不设守护） */
  timeoutMs: number;
  /** N6 重试次数（0＝显式禁用重试） */
  retries: number;
  /** ✅ M4 PM 裁决 5（V1.1）：场景注入径——C-M1 env 组装按 resolve(scene) 注入 LLM 值；
   * V1.0 无 scene＝单配置回退（C-18 §1③） */
  scene?: SceneKey;
  /** ✅ T0-06 会签：browser 绑定解析——lane 会话存在→注入 CONSTELLA_CDP_WS，否则 ctx.browser=未绑定 stub */
  laneKey?: string;
}

export interface SpawnScriptRes {
  ok: boolean;
  pid: number;
}

/** run:killScript（r→m）：{nodeRunId} → {ok}（02 §3.4；taskkill /T /F+杀后复查=S-4①；
 * C-M1 §1：in-band 幂等 {ok:true}（已退出亦 ok）；终止扩散原语＝A-6.4 AbortCoordinator） */
export interface KillScriptReq {
  nodeRunId: string;
}

export interface KillScriptRes {
  ok: boolean;
}

/** run:scriptEvent（m→r 推送）：{nodeRunId,kind:'stdout'|'stderr'|'exit',chunk,code,ms}（02 §3.4）。
 * 转发前经 SecretMasker `sk-***` 掩码（02 §12.3/§12.4；C-M1 §3）。 */
export interface ScriptEvent {
  nodeRunId: string;
  kind: 'stdout' | 'stderr' | 'exit';
  /** stdout/stderr 分片（kind=exit 无） */
  chunk?: string;
  /** 退出码（kind=exit；观测按 code，S-4③） */
  code?: number;
  /** 耗时 ms（kind=exit） */
  ms?: number;
}
