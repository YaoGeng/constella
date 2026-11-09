// SandboxExecutor —— ts/python 沙箱执行链编排（T4-16 ts 链＋T4-17 py 链＋ProcessKiller 换装；
// TDD-C-M1 §3 SandboxExecutor 组件行）。
//
// 冻结面（§3 组件行＋02 §12.1/§12.2#3/§14）：
//   - spawnScript(req) → {ok,pid}：脚本路径限 node-types/ 资产白名单（相对形按 nodeTypesRoot
//     解析——X-01 ExecSpec.file；越界/不存在 → RUN-SCRIPT-NOT-FOUND）；lang ∈ {'py','ts'} 外 →
//     RUN-INVALID-LANG；'py' 链：PyExecutor 解释器发现失败/包源未装配 → RUN-ENV-MISSING
//     （02 §12.1 节点级执行环境缺失降级；S-4 ②~⑥ 形参/包同置/v1.0d 垫片/TEMP·TMP 三同——
//     细节见 py-executor.ts 文件头）；
//   - env 组装（02 §12.1 v1.0a 勘误口径）：传入 env 块＝白名单 5 项
//     （SystemRoot/TEMP/TMP/PATHEXT/ComSpec）＋CONSTELLA_*（CTX/RUN_ID/NODE_ID/VAULT_PATH/
//     LLM_BASE_URL/LLM_API_KEY〔=SecretVault.reveal 解密注入，T4-15 消费接线〕恒在；
//     CDP_WS＝req.laneKey 解析出已开 lane 端点时注入〔T0-06 会签条件键〕；NET_WS＝节点 N1
//     网络类目时注入〔宿主 NetProxyBridge=T4-20/P5，装配注入位 netEndpointOf〕）——不继承
//     主进程全量 env（libuv 强制注入 11 系统变量不可关闭、不进断言面，S-4 ⑤）；py 链
//     executorEnv 覆盖 TEMP/TMP=run 私有目录（§6.1e 三同——T4-16 评审偏差⑦收口：ts 链
//     host 透传口径不动，py 链按 S-4 ⑥）；
//   - configYaml 合并（02 §14 冻结序，M4 #5）：req 携 configYaml 时解析并入 CONSTELLA_CTX.params
//     （config ← 实例 params；yaml 解析收窄 config-yaml.ts 单点）；
//   - workdir＝sandbox/<runId>/<nodeId>/{config.yaml,scripts/,vault.json,out/}（WorkdirFactory；
//     runId/nodeId 取自 nodeRunId `${runId}:${nodeId}` 形——C-03 RunLoop 冻结拆分位，自拟承接留痕）；
//   - killScript(nodeRunId)：in-band 幂等 {ok:true}（已退出亦 ok；强杀本体=ProcessKiller
//     〔T4-17 换装：taskkill /T /F＋杀后复查 KillReport——survivors 残留告警留痕〕）；
//   - sweepOrphans（runId 标记＋启动清扫）／dispose（在跑树 killTree）；
//   - onScriptEvent → run:scriptEvent：stdout/stderr 分片转发前统一过 SecretMasker（sk-***）；
//   - exit 帧 settled 守卫（T4-16 评审移交②）：子进程 error 后 close 仍可能跟发（Node 语义）
//     → 极端双 exit 帧，守卫后 exit 帧恰一。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcErrorCode,
  type KillScriptRes,
  type ScriptEvent,
  type SpawnScriptReq,
  type SpawnScriptRes,
} from '@constella/shared/ipc';
import type { InvokeRegistry } from '../runtime/domain-channels';
import { mergeParams } from './config-yaml';
import { mask } from './secret-masker';
import { registerSandboxChannels } from './sandbox-channels';
import { WorkdirFactory, assertSafeId, type WorkdirLayout } from './workdir-factory';
import { TsExecutor, type SdkModulePaths } from './ts-executor';
import { PyExecutor, type LauncherPython } from './py-executor';
import { ProcessKiller, type KillReport } from './process-killer';
import { Watchdog, type KillTreeFn } from './watchdog';

/** Sandbox 业务错误（Error+string code——经 IpcGateway serializeError 归一 {code,message}，§1 铁律） */
export class SandboxError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

/** env 白名单 5 项（02 §12.1 v1.0a：传入 env 块口径；PATH 等其余键不继承） */
export const ENV_WHITELIST_KEYS = ['SystemRoot', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec'] as const;

/** LLM env 值源（llm=env 键恒在——K-01 §4 绑定判据表；settings 接线归 T4-20，装配注入） */
export type LlmEnvSource = () => { baseUrl: string; apiKeyRef: string | null };

/** run:scriptEvent 推送面（fire-and-forget 无错误语义——IpcGateway.send 同形） */
export type ScriptEventPush = (channel: IpcChannel, payload: unknown) => void;

/** 构造依赖 */
export interface SandboxExecutorDeps {
  /** 沙箱根（=userData/sandbox；AppRuntime 装配注入） */
  sandboxRoot: string;
  /** 资产根（=userData/node-types；02 §12.2#3 路径白名单根） */
  nodeTypesRoot: string;
  /** SecretVault.reveal 注密面（LLM_API_KEY 解密注入——T4-15 消费接线） */
  revealSecret: (refKey: string) => string;
  /** sdk 双 subpath TS 源（TsExecutor alias 目标——见 ts-executor.ts 文件头） */
  sdkModules: SdkModulePaths;
  /** constella_sdk py 包源目录（py 链装配位——K-01 §2 包与 entry 同置；未注入='py' 链
   *  spawn → RUN-ENV-MISSING〔装配缺省=节点级执行环境缺失〕；生产接线随 T4-20 组收尾） */
  pyPackageDir?: string;
  /** settings python 路径覆盖（§8①：覆盖优先于 py 启动器解析；缺省=py -0p 一次解析） */
  pythonPathOverride?: string;
  /** py 启动器枚举注入缝（缺省=真 py -0p；测试注入失败态） */
  listLauncherPythons?: () => LauncherPython[];
  /** 子进程可执行文件（缺省 process.execPath；electron 装配=electron.exe＋RUN_AS_NODE） */
  execPath?: string;
  /** LLM env 值源（缺省＝空 baseUrl/无引用键——键面恒在） */
  llm?: LlmEnvSource;
  /** CDP lane 端点解析（CdpBridge.endpointOf 注入位——空串/未注入=不注入 CDP_WS） */
  cdpEndpointOf?: (laneKey: string) => string;
  /** NET 端点解析（NetProxyBridge 宿主=T4-20/P5；N1 网络类目判定在装配侧——null/未注入=不注入 NET_WS） */
  netEndpointOf?: (req: SpawnScriptReq) => string | null;
  /** 树杀实现（缺省=ProcessKiller：taskkill /T /F＋杀后复查 KillReport——T4-17 换装） */
  killTree?: KillTreeFn;
}

/** Windows env 键大小写不敏感取值（精确命中优先，再大小写扫描） */
function hostEnvValue(key: string): string | undefined {
  const direct = process.env[key];
  if (direct !== undefined) return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** env 组装输入（assembleChildEnv 单测面——不 spawn 即可断言键集合） */
export interface AssembleEnvInput {
  mergedParams: Record<string, unknown>;
  input: unknown;
  runId: string;
  nodeId: string;
  workdir: WorkdirLayout;
  laneKey?: string;
  revealSecret: (refKey: string) => string;
  llm?: LlmEnvSource;
  cdpEndpointOf?: (laneKey: string) => string;
  netEndpointOf?: (req: SpawnScriptReq) => string | null;
  req: SpawnScriptReq;
  /** 执行器附加 env（TsExecutor ELECTRON_RUN_AS_NODE——S-5 ④） */
  executorEnv?: Record<string, string>;
}

/**
 * 传入 env 块组装（02 §12.1 v1.0a＋T0-06 条件键；断言面=键集合严格相等——libuv 11 注入
 * 不在断言面，S-4 ⑤）。
 */
export function assembleChildEnv(input: AssembleEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_WHITELIST_KEYS) {
    const v = hostEnvValue(key);
    if (v !== undefined) env[key] = v; // 主进程缺该键（非 win32 宿主）→ 不注入该键
  }
  env.CONSTELLA_RUN_ID = input.runId;
  env.CONSTELLA_NODE_ID = input.nodeId;
  env.CONSTELLA_CTX = JSON.stringify({ params: input.mergedParams, input: input.input });
  env.CONSTELLA_VAULT_PATH = input.workdir.vaultJsonFile;
  const llm = input.llm?.() ?? { baseUrl: '', apiKeyRef: null };
  env.CONSTELLA_LLM_BASE_URL = llm.baseUrl; // llm=env 键恒在（K-01 §4 绑定判据表）
  env.CONSTELLA_LLM_API_KEY =
    llm.apiKeyRef !== null && llm.apiKeyRef !== '' ? input.revealSecret(llm.apiKeyRef) : '';
  // V1.1 场景注入（M4 PM 裁决 5）：req.scene → 按 resolve(scene) 换注 LLM 两键值（键面不变）——
  // 归 C-18 波；V1.0 无 scene＝上方单配置回退（本卡口径）。
  if (input.laneKey !== undefined && input.cdpEndpointOf !== undefined) {
    const endpoint = input.cdpEndpointOf(input.laneKey);
    if (endpoint !== '') env.CONSTELLA_CDP_WS = endpoint; // lane 已开 → 注入（T0-06 条件键）
  }
  if (input.netEndpointOf !== undefined) {
    const endpoint = input.netEndpointOf(input.req);
    if (endpoint !== null && endpoint !== '') env.CONSTELLA_NET_WS = endpoint; // N1 网络类目 → 注入
  }
  return { ...env, ...input.executorEnv };
}

/** nodeRunId 拆分（C-03 RunLoop 冻结形 `${runId}:${nodeId}`——首冒号拆分；畸形=main 侧装配错 INTERNAL） */
export function splitNodeRunId(nodeRunId: string): { runId: string; nodeId: string } {
  const idx = nodeRunId.indexOf(':');
  if (idx <= 0 || idx === nodeRunId.length - 1) {
    throw new Error(`nodeRunId 形非法（期望 '<runId>:<nodeId>'，C-03 RunLoop 冻结形）: ${nodeRunId}`);
  }
  return { runId: nodeRunId.slice(0, idx), nodeId: nodeRunId.slice(idx + 1) };
}

/** 脚本路径白名单解析（02 §12.2#3：node-types/ 注册资产外一律拒绝；win32 大小写不敏感） */
export function resolveScriptPath(nodeTypesRoot: string, scriptPath: string): string {
  const abs = path.isAbsolute(scriptPath) ? path.normalize(scriptPath) : path.normalize(path.join(nodeTypesRoot, scriptPath));
  const base = nodeTypesRoot.endsWith(path.sep) ? nodeTypesRoot : nodeTypesRoot + path.sep;
  if (!abs.toLowerCase().startsWith(base.toLowerCase())) {
    throw new SandboxError(
      'RUN-SCRIPT-NOT-FOUND',
      `脚本路径越界（限 node-types/ 注册资产白名单，02 §12.2#3）: ${scriptPath}`,
    );
  }
  if (!existsSync(abs)) {
    throw new SandboxError('RUN-SCRIPT-NOT-FOUND', `脚本文件不存在（node-types/ 资产）: ${scriptPath}`);
  }
  return abs;
}

/** 在跑子进程台账 */
interface LiveChild {
  pid: number;
  child: ChildProcess;
  runId: string;
  startedAt: number;
}

/**
 * SandboxExecutor（§3 组件行：spawnScript/killScript/sweepOrphans/dispose＋事件
 * onScriptEvent→run:scriptEvent；S-5 ①~⑤ 经 TsExecutor/Watchdog 全吸收）。
 */
export class SandboxExecutor {
  private readonly factory: WorkdirFactory;
  private readonly ts: TsExecutor;
  private readonly py: PyExecutor | undefined;
  private readonly processKiller = new ProcessKiller();
  private readonly killTreeImpl: KillTreeFn;
  private readonly watchdog: Watchdog;
  private readonly live = new Map<string, LiveChild>();
  private readonly listeners = new Set<(e: ScriptEvent) => void>();
  private inited = false;
  private disposed = false;

  constructor(private readonly deps: SandboxExecutorDeps) {
    this.factory = new WorkdirFactory({ sandboxRoot: deps.sandboxRoot });
    this.ts = new TsExecutor({ sdkModules: deps.sdkModules, execPath: deps.execPath });
    this.py =
      deps.pyPackageDir !== undefined
        ? new PyExecutor({
            pyPackageDir: deps.pyPackageDir,
            pythonPathOverride: deps.pythonPathOverride,
            listLauncherPythons: deps.listLauncherPythons,
          })
        : undefined; // 未装配：'py' spawn → RUN-ENV-MISSING（装配缺省=执行环境缺失）
    this.killTreeImpl = deps.killTree ?? ((pid: number) => this.processKiller.killTree(pid));
    this.watchdog = new Watchdog({ killTree: this.killTreeImpl });
  }

  /**
   * 装配入口（AppRuntime 组合根/T4-20 组收尾接线；同 SecretVault.init 先例）：挂
   * run:spawnScript/run:killScript 两通道＋事件面→run:scriptEvent 推送（经 SecretMasker）。
   */
  init(options: { registry: InvokeRegistry; push?: ScriptEventPush }): void {
    if (this.inited) throw new Error('SandboxExecutor.init 已调用（单次语义）');
    this.inited = true;
    registerSandboxChannels(this, options.registry);
    if (options.push !== undefined) {
      this.onScriptEvent((e) => options.push!(IPC_CHANNELS.runScriptEvent, e));
    }
  }

  /** 事件订阅（stdout/stderr 已过 SecretMasker；exit 权威码在此） */
  onScriptEvent(handler: (e: ScriptEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** run:spawnScript（§3 组件级接口 `spawnScript(req): {ok,pid}`） */
  async spawnScript(req: SpawnScriptReq): Promise<SpawnScriptRes> {
    if (this.disposed) throw new Error('SandboxExecutor.spawnScript：已 dispose（退出序后不再接受 spawn）');
    if (req.lang !== 'ts' && req.lang !== 'py') {
      throw new SandboxError('RUN-INVALID-LANG', `未知脚本语言: ${String(req.lang)}（期望 'py'|'ts'）`);
    }
    if (req.lang === 'py') {
      // py 链执行环境降级面（02 §12.1：节点级执行环境缺失，非崩溃）——先于脚本路径白名单检
      // （环境缺失=粗粒度用户可见条件，试跑/运行前检测并提示语义）
      if (this.py === undefined) {
        throw new SandboxError(
          'RUN-ENV-MISSING',
          'python 执行链未装配（constella_sdk 包源未注入 pyPackageDir）——节点级执行环境缺失（02 §12.1）',
        );
      }
      const resolution = this.py.resolve();
      if (resolution.missing) {
        throw new SandboxError(
          'RUN-ENV-MISSING',
          `python 解释器不可用: ${resolution.reason}——节点级执行环境缺失（02 §12.1 降级）`,
        );
      }
    }
    const { runId, nodeId } = splitNodeRunId(req.nodeRunId);
    assertSafeId(runId, 'runId');
    assertSafeId(nodeId, 'nodeId');
    const scriptAbs = resolveScriptPath(this.deps.nodeTypesRoot, req.scriptPath);
    const mergedParams = mergeParams(req.params, req.configYaml); // 02 §14 冻结序（config ← 实例）
    const workdir = this.factory.create(runId, nodeId, req.configYaml);
    const spec =
      req.lang === 'py'
        ? this.py!.prepare(scriptAbs, req.entry, workdir) // S-4 ②：python -I -X utf8 <entry>＋包同置＋v1.0d 垫片
        : await this.ts.prepare(scriptAbs, this.writeTsEntry(scriptAbs, workdir, req.entry));
    const env = assembleChildEnv({
      mergedParams,
      input: req.input,
      runId,
      nodeId,
      workdir,
      laneKey: req.laneKey,
      revealSecret: this.deps.revealSecret,
      llm: this.deps.llm,
      cdpEndpointOf: this.deps.cdpEndpointOf,
      netEndpointOf: this.deps.netEndpointOf,
      req,
      executorEnv: spec.env,
    });

    // 同 nodeRunId 再 spawn（N6 重试同 id 重跑）：先杀旧进程（替换语义）
    const existing = this.live.get(req.nodeRunId);
    if (existing !== undefined) await this.killLive(req.nodeRunId);

    const child = spawn(spec.cmd, spec.args, {
      cwd: workdir.root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const startedAt = Date.now();
    if (child.pid === undefined || child.stdout === null || child.stderr === null) {
      // spawn 即败（execPath 消失等）：观察者先挂（error 后 close 跟发=Node 语义——settled
      // 守卫单 exit 帧收敛＋无 unhandled 'error'），再抛原语义 RUN-ENV-MISSING
      this.observeChild(child, req.nodeRunId, runId, -1, startedAt);
      throw new SandboxError('RUN-ENV-MISSING', `子进程未取得 pid/stdio（execPath=${spec.cmd}）`);
    }
    const pid = child.pid;
    this.live.set(req.nodeRunId, { pid, child, runId, startedAt });
    this.factory.addPid(runId, pid);
    this.observeChild(child, req.nodeRunId, runId, pid, startedAt);

    // N6 timeoutMs（02 §8.6 0 值语义）：0=不武装；>0=到点强杀（Watchdog；退出看门狗同体）
    if (req.timeoutMs > 0) {
      void this.watchdog.arm(pid, req.timeoutMs).then(
        (info) => {
          if (info.timedOut) {
            console.error(`[constella-sandbox] 超时强杀（N6）：nodeRunId=${req.nodeRunId} pid=${pid} ${info.ms}ms`);
          }
        },
        () => undefined,
      );
    }
    return { ok: true, pid };
  }

  /** run:killScript（in-band 幂等 {ok:true}——已退出亦 ok） */
  async killScript(nodeRunId: string): Promise<KillScriptRes> {
    await this.killLive(nodeRunId);
    return { ok: true };
  }

  /** 启动清扫（AppRuntime 启动序末步）：杀残留 pid 树＋删非在跑 run 目录（runId 标记） */
  async sweepOrphans(): Promise<void> {
    const liveRuns = new Set([...this.live.values()].map((c) => c.runId));
    for (const runId of this.factory.listRunIds()) {
      if (liveRuns.has(runId)) continue;
      for (const pid of this.factory.readPids(runId)) {
        await this.killTreeSafely(pid, `sweepOrphans runId=${runId}`);
      }
      this.factory.removeRun(runId);
    }
  }

  /** 退出序：在跑树 killTree＋等待退出（§3 生命周期段；ProcessKiller 杀后复查） */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const ids = [...this.live.keys()];
    await Promise.all(ids.map((id) => this.killLive(id)));
  }

  // ————————————————————————————————————————————

  private emit(e: ScriptEvent): void {
    for (const l of this.listeners) l(e);
  }

  /**
   * 子进程观察者挂载（stdout/stderr 掩码转发＋exit 帧 settled 守卫——移交②：error 后
   * close 仍可能跟发〔Node 语义，spawn ENOENT 实测 error:ENOENT→close:-4058 双发〕→
   * 极端双 exit 帧，守卫后 exit 帧恰一；首到者权威——error 期 code=-1、close 期 code 权威值）。
   */
  private observeChild(
    child: ChildProcess,
    nodeRunId: string,
    runId: string,
    pid: number,
    startedAt: number,
  ): void {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.emit({ nodeRunId, kind: 'stdout', chunk: mask(chunk) });
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.emit({ nodeRunId, kind: 'stderr', chunk: mask(chunk) }); // stderr 同过掩码（02 §12.3）
    });
    let exitSettled = false;
    const emitExitOnce = (code: number): void => {
      if (exitSettled) return;
      exitSettled = true;
      this.emit({ nodeRunId, kind: 'exit', code, ms: Date.now() - startedAt });
      this.cleanupChild(nodeRunId, pid, runId);
    };
    child.on('error', (err) => {
      // spawn 后异步失败（execPath 消失等）——按退出面收敛
      emitExitOnce(-1);
      console.error('[constella-sandbox] 子进程错误:', err);
    });
    child.on('close', (code) => {
      // 观测按 code（S-4 ③；taskkill 后 code=1、signal=null）
      emitExitOnce(code ?? -1);
    });
  }

  /** ts 链 entry 落盘（scripts/entry.ts——S-5 冻结形；返回 entry 绝对路径供 prepare） */
  private writeTsEntry(scriptAbs: string, workdir: WorkdirLayout, entryFn: string): string {
    const entryPath = path.join(workdir.scriptsDir, 'entry.ts');
    this.ts.writeEntry(scriptAbs, entryPath, entryFn);
    return entryPath;
  }

  private cleanupChild(nodeRunId: string, pid: number, runId: string): void {
    const entry = this.live.get(nodeRunId);
    if (entry !== undefined && entry.pid === pid) this.live.delete(nodeRunId);
    this.factory.removePid(runId, pid);
  }

  /** 树杀＋失败/残留告警留痕（T4-16 评审移交③：静默丢弃面补 warn——孤儿清扫兜底面数据源） */
  private async killTreeSafely(pid: number, what: string): Promise<void> {
    try {
      this.warnSurvivors(pid, await this.killTreeImpl(pid), what);
    } catch (err) {
      console.error(`[constella-sandbox] 树杀异常（${what}）: pid=${pid}`, err);
    }
  }

  /** KillReport 残留告警（ProcessKiller 返回面——survivors 非空不静默） */
  private warnSurvivors(pid: number, report: unknown, what: string): void {
    const r = report as KillReport | null | undefined;
    if (r !== null && r !== undefined && Array.isArray(r.survivors) && r.survivors.length > 0) {
      console.error(`[constella-sandbox] 树杀复查残留（${what}）: pid=${pid} survivors=${r.survivors.join(',')}——孤儿清扫面兜底`);
    }
  }

  private async killLive(nodeRunId: string): Promise<void> {
    const entry = this.live.get(nodeRunId);
    if (entry === undefined) return; // 已退出/未知 → 幂等 ok
    await this.killTreeSafely(entry.pid, `killScript nodeRunId=${nodeRunId}`);
    const closed = new Promise<void>((resolve) => {
      entry.child.once('close', () => resolve());
      entry.child.once('error', () => resolve());
    });
    await Promise.race([closed, sleep(3000)]);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
