// run:* 两通道 handler（T4-16 / TDD-C-M1 §1 矩阵 run:spawnScript / run:killScript 行）。
//
// 语义冻结（§1 矩阵）：
//   run:spawnScript  r→m  SpawnScriptReq → {ok,pid}（ts 链=S-5 ①~⑤；脚本路径限 node-types/
//                       资产白名单 02 §12.2#3）→ RUN-SCRIPT-NOT-FOUND / RUN-ENV-MISSING /
//                       RUN-INVALID-LANG（SandboxError code 面——经 IpcGateway serializeError
//                       归一 {code,message} reject）
//   run:killScript   r→m  {nodeRunId} → {ok}（in-band 幂等——已退出亦 ok；终止扩散原语=
//                       A-6.4 AbortCoordinator 消费）
//   run:scriptEvent  m→r  推送（无错误语义；转发前 sk-*** 掩码=executor 事件面，不在本文件）
//
// 注册面：InvokeRegistry——SandboxExecutor.init 经装配挂载（缺省 IpcGateway；
// AppRuntimeDeps.invokeRegistry 测试注入缝——T4-13/T4-14 冻结先例）。
import { IPC_CHANNELS, type KillScriptReq, type SpawnScriptReq } from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';

/** 通道面消费的 executor 面 */
export type SandboxExecutorChannelFace = {
  spawnScript(req: SpawnScriptReq): Promise<{ ok: boolean; pid: number }>;
  killScript(nodeRunId: string): Promise<{ ok: boolean }>;
};

/** 注册 run:spawnScript / run:killScript（SandboxExecutor.init 调用；重复注册由 IpcGateway 拒绝） */
export function registerSandboxChannels(sb: SandboxExecutorChannelFace, registry: InvokeRegistry): void {
  registry.handle(IPC_CHANNELS.runSpawnScript, (payload) => {
    const req = payload as SpawnScriptReq; // 形状已过 payload-schemas（T4-14 通道面）
    return sb.spawnScript(req);
  });
  registry.handle(IPC_CHANNELS.runKillScript, (payload) => {
    const req = payload as KillScriptReq;
    return sb.killScript(req.nodeRunId);
  });
}
