// main/sandbox 域导出面（T4-16 / TDD-C-M1 §3 SandboxExecutor·TsExecutor·Watchdog·SecretMasker·
// WorkdirFactory 五组件＋run:* 通道挂载）。
// 消费方：AppRuntime 装配（service-slots SandboxExecutorSlot——组合根接线随 T4-20 组收尾，同
// cdp/vault 先例）；SecretVault.reveal 注密（T4-15 对端）；CdpBridge.endpointOf（T4-18 对端——
// CONSTELLA_CDP_WS 条件注入）。
export { SandboxError, SandboxExecutor, ENV_WHITELIST_KEYS, assembleChildEnv, resolveScriptPath, splitNodeRunId, type AssembleEnvInput, type SandboxExecutorDeps, type LlmEnvSource, type ScriptEventPush } from './sandbox-executor';
export { registerSandboxChannels, type SandboxExecutorChannelFace } from './sandbox-channels';
export { TsExecutor, type SdkModulePaths, type TsExecutorDeps } from './ts-executor';
export { Watchdog, taskkillTree, type ExitInfo, type KillTreeFn, type WatchdogDeps } from './watchdog';
export { WorkdirFactory, RUN_PIDS_MARKER, assertSafeId, type WorkdirFactoryDeps, type WorkdirLayout } from './workdir-factory';
export { SECRET_MASK, mask } from './secret-masker';
export { ConfigYamlError, mergeParams, parseConfigYaml } from './config-yaml';
