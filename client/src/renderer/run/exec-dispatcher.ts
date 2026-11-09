// ExecDispatcher —— 类型分派执行体（TDD-C-03 §3 ExecDispatcher 行；02 §10 #10＋§8.5＋§14；T4-02~04）。
//   custom（exec≠null）→ run:spawnScript：stdout JSON 行协议（S-5 冻结/K-01 bootstrap——
//     log/emit/result/error 四帧＋exit 码；stderr 分片按 [lane] warn 日志透传＋并入非零
//     退出诊断）；N5 组合节点 inner 内联展开＝单进程多步骤（02 §8.5——展开实例化=步骤序
//     日志 `[lane] ▸ 步骤N`，子步骤共享进程与 ctx）；emit 帧=提前出口（ctx.emit 即时
//     回调，脚本未退出即交付下游）；result 帧显式校验 plain object（NodeOut 形）；
//   human.* → 断点门闩（setStatus(waiting)＋ctx.holdAtBreakpoint 挂起＝T4-04
//     HitCoordinator.hit：hits.create pending＋resolve 载荷=交付下游数据〔confirm=合并值/
//     skip=原始 input 直发，01 A-7.1〕；终止放行=reject ExecAbortedError→⊘ 收敛）；
//   delay   → 可中断计时（50ms 步进查 abort，中断抛 ExecAbortedError）；
//   logic.branch → BranchFilter expr 真实求值（T-1 对称语义，02 §10 #6）；
//   cdp.*   → env:cdpProbe 前置探活（失败→节点 error＋ctx.failRun 失败终止不走 failBranch，
//     X-3/B-14）＋LaneManager.ensureSession（首建/复用只更新 URL）＋命令经注入
//     CommandTransport（帧形=T0-07 冻结；M4 PM 裁决 3 方案 A——ws client 实装随 T4-05
//     共用，本卡 fake 先行；open/extract/click 完整操作语义〔先导航/evaluate
//     returnByValue/中心两击/enable＋轮询〕归 T4-05，本卡落注入 seam 与帧形）；
//   其余平台内置（无 exec/无专属分派）→ {data: input} 占位直通（V1.1 out.* 经内置分支
//     注册接入＝预留位，02 §8.8）。
// N6 重试/backoff/onFailure 路由归 T4-04 PolicyRunner（本组件 policy 只透传 timeoutMs/
// retries＋缺省 30000/0，02 §8.6；重试编排与出口路由在 RunLoop）。终止强杀（killScript）
// 在 AbortCoordinator（onScriptActive 为其活跃脚本数据源）。
import type { FlowNode, LogLevel, ScriptEvent, SpawnScriptReq } from '@constella/shared/ipc';
import type { NodeDefinition, NodeOut } from '@constella/shared/dsl';
import type { CommandTransport, Lane, NodeStatus, RunRegistryLike, RunTransport } from './types';
import { BranchFilter, type BranchRoute } from './branch-filter';
import { LaneManager } from './lane-manager';
import { DEFAULT_TIMEOUT_MS } from './policy-runner';

/** 节点被终止（run aborted）——调用方按 skipped 收敛、不交付下游（demo L1910 语义） */
export class ExecAbortedError extends Error {
  constructor() {
    super('节点被终止（run aborted）');
    this.name = 'ExecAbortedError';
  }
}

/** 执行上下文（RunLoop 注入：lane/日志/emit 提前出口/状态回调/终止查询/断点门闩/环境级失败） */
export interface ExecContext {
  lane: Lane;
  /** nodeRun 关联键（spawnScript 事件流按此对账） */
  nodeRunId: string;
  /** 节点级日志（msg 由本组件拼 [lane] 前缀；落库/派发归调用方） */
  log(level: LogLevel, msg: string): void;
  /** emit 提前出口（分支路由即时发生；出口校验在本组件，miss=dispatch 失败） */
  emit(branch: string, payload?: unknown): void;
  /** 节点态回调（human.* waiting 等） */
  setStatus(status: NodeStatus, error?: string): void;
  isAborted(): boolean;
  /**
   * 断点门闩（human.* 挂起位）：T4-04 起由 HitCoordinator 承载——resolve 载荷=交付下游
   * 数据（confirm=合并值/skip=原始 input）；终止放行=reject ExecAbortedError（⊘ 收敛）。
   */
  holdAtBreakpoint(): Promise<unknown>;
  /** 环境级失败终止（X-3：不走 failBranch——cdpProbe 失败等；置 failed 停派生，run 终态=error） */
  failRun(reason: string): void;
}

export interface ExecDispatcherDeps {
  registry: RunRegistryLike;
  lanes: LaneManager;
  runId: string;
  transport?: RunTransport;
  commandTransport?: CommandTransport;
  /** 活跃脚本登记（AbortCoordinator killScript 数据源；active=true=脚本进程在跑） */
  onScriptActive?(nodeRunId: string, active: boolean): void;
}

/** 可中断计时步进（demo L1777-1787：50ms 轮询自觉退出） */
const ABORT_STEP_MS = 50;
/** delay 缺省时长（demo L1906 同值） */
const DELAY_DEFAULT_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ExecDispatcher {
  private readonly branchFilter = new BranchFilter();

  constructor(private readonly deps: ExecDispatcherDeps) {}

  /** §3 组件级接口：dispatch(node,input)→NodeOut（ctx=执行上下文注入位） */
  async dispatch(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    if (node.type === 'delay') return this.runDelay(node, input, ctx);
    if (node.type === 'logic.branch') return this.runBranch(node, input, ctx);
    if (node.type.startsWith('human.')) return this.runHuman(node, input, ctx);
    if (node.type.startsWith('cdp.')) return this.runCdp(node, input, ctx);
    const def = this.deps.registry.get(node.type);
    if (def?.exec !== null && def !== undefined) return this.runScript(node, input, ctx, def);
    // 平台内置占位直通（无脚本无专属分派）
    return { data: input };
  }

  /** delay → 可中断计时：50ms 步进查 abort；完整走完透传 input */
  private async runDelay(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    const raw = node.params.ms;
    const ms = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DELAY_DEFAULT_MS;
    let elapsed = 0;
    while (elapsed < ms) {
      if (ctx.isAborted()) throw new ExecAbortedError();
      await sleep(ABORT_STEP_MS);
      elapsed += ABORT_STEP_MS;
    }
    if (ctx.isAborted()) throw new ExecAbortedError();
    return { data: input };
  }

  /** human.* → 断点门闩（T4-04 HitCoordinator）：waiting＋挂起——resolve 载荷=交付下游数据
   *  （confirm=合并值/skip=原始 input 直发，01 A-7.1）；终止放行=reject ExecAbortedError→⊘ 收敛 */
  private async runHuman(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    ctx.setStatus('waiting');
    ctx.log('info', `等待人工确认：${node.name}`);
    const payload = await ctx.holdAtBreakpoint();
    return { data: payload };
  }

  /** logic.branch → BranchFilter expr 真实求值（T-1 对称语义；求值异常=节点 error） */
  private runBranch(node: FlowNode, input: unknown, ctx: ExecContext): NodeOut {
    const expr = typeof node.params.expr === 'string' ? node.params.expr : '';
    const r: BranchRoute = this.branchFilter.route(expr, input);
    if (!r.ok) {
      ctx.log('err', `[${ctx.lane.label}] ${node.name} ${r.message}`);
      throw new Error(r.message);
    }
    ctx.log('info', `[${ctx.lane.label}] 条件${r.branch === 'true' ? '成立' : '不成立'} → 走 ${r.branch} 分支`);
    return { branch: r.branch }; // meta=空：下游 input={}（02 §14 input=meta 去 branch 键；demo 无载荷语义）
  }

  /** cdp.* → 前置探活＋ensureSession＋命令经注入 CommandTransport（帧形=T0-07） */
  private async runCdp(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    // 断连分支（02 §10 #10/B-14）：探活失败→节点 error＋run 失败终止且不走 failBranch（X-3）
    const transport = this.deps.transport;
    if (transport !== undefined) {
      const probe = await transport.envCdpProbe({}).catch(() => ({ ok: false, detail: '探活通道不可用' }));
      if (!probe.ok) {
        const detail = probe.detail === undefined || probe.detail === '' ? '' : ` — ${probe.detail}`;
        const msg = `CDP 环境未连接${detail} — ${node.name} 失败，任务终止`;
        ctx.failRun(msg);
        throw new Error(msg);
      }
    }
    const url = typeof node.params.url === 'string' ? node.params.url : undefined;
    const session = await this.deps.lanes.ensureSession(ctx.lane, url);
    if (node.type === 'cdp.open') {
      return { data: { url: session.url, port: session.port } };
    }
    if (node.type === 'cdp.extract') {
      const result = await this.cdpCommand('Runtime.evaluate', {
        ...extractExpression(node.params),
        returnByValue: true,
      });
      return { data: result };
    }
    if (node.type === 'cdp.click') {
      const x = numberOr(node.params.x, 0);
      const y = numberOr(node.params.y, 0);
      await this.cdpCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.cdpCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return { data: { x, y } };
    }
    // 其余 cdp.*：会话确保后直通（操作语义随 T4-05 落地）
    return { data: input };
  }

  private async cdpCommand(method: string, params: Record<string, unknown>): Promise<unknown> {
    const transport = this.deps.commandTransport;
    if (transport === undefined) {
      throw new Error(`命令传输未注入——无法执行 ${method}`);
    }
    const res = await transport.send({ ns: 'cdp', method, params });
    if (!res.ok) {
      throw new Error(`CDP 命令失败 ${res.error.code}：${res.error.message}`);
    }
    return res.result;
  }

  /** custom → run:spawnScript＋stdout JSON 行协议流（S-5 冻结） */
  private runScript(node: FlowNode, input: unknown, ctx: ExecContext, def: NodeDefinition): Promise<NodeOut> {
    const transport = this.deps.transport;
    if (transport === undefined) {
      return Promise.reject(new Error('执行面传输未注入——无法运行脚本节点'));
    }
    const exec = def.exec;
    if (exec === null) return Promise.reject(new Error('脚本节点缺少执行体定义'));
    // N5 内联展开（02 §8.5）：子步骤共享单进程与 ctx——展开实例化＝步骤序日志（`[lane] ▸ 步骤N`）
    const inner = def.inner ?? [];
    for (let i = 0; i < inner.length; i++) {
      ctx.log('info', `[${ctx.lane.label}] ▸ 步骤${i + 1} ${inner[i]}`);
    }
    ctx.log('info', `[${ctx.lane.label}] 运行脚本 ${exec.file}（${exec.lang === 'python' ? 'Python' : 'TypeScript'} · 入口 ${exec.entry}）`);
    const req: SpawnScriptReq = {
      nodeRunId: ctx.nodeRunId,
      lang: exec.lang === 'python' ? 'py' : 'ts',
      scriptPath: exec.file,
      entry: exec.entry,
      params: { ...node.params },
      input,
      timeoutMs: def.policy?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: def.policy?.retries ?? 0,
      laneKey: ctx.lane.key,
    };
    return new Promise<NodeOut>((resolve, reject) => {
      let buffer = '';
      let result: NodeOut | undefined;
      let errorMessage: string | undefined;
      let stderrTail: string | undefined;
      let settled = false;
      const done = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        unsub();
        this.deps.onScriptActive?.(ctx.nodeRunId, false);
        settle();
      };
      const consumeLine = (line: string): void => {
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          ctx.log('info', `[${ctx.lane.label}] ${line}`); // 非 JSON stdout：按日志行透传
          return;
        }
        const f = frame as { type?: unknown; msg?: unknown; branch?: unknown; payload?: unknown; out?: unknown; message?: unknown };
        if (f.type === 'log' && typeof f.msg === 'string') {
          ctx.log('info', `[${ctx.lane.label}] ${f.msg}`);
          return;
        }
        if (f.type === 'emit') {
          const outs = def.ports.outs.map((o) => o.id);
          const branch = f.branch;
          if (typeof branch !== 'string' || !outs.includes(branch)) {
            done(() => reject(new Error(`emit 出口未命中：${String(branch)} ∉ [${outs.join(', ')}]`)));
            return;
          }
          ctx.emit(branch, f.payload ?? null);
          return;
        }
        if (f.type === 'result' && f.out !== undefined) {
          if (typeof f.out !== 'object' || f.out === null || Array.isArray(f.out)) {
            done(() =>
              reject(
                new Error(
                  `result 终帧载荷必须是对象（NodeOut {data}|{branch,meta}），实际：${Array.isArray(f.out) ? 'array' : typeof f.out}`,
                ),
              ),
            );
            return;
          }
          result = f.out as NodeOut;
          return;
        }
        if (f.type === 'error' && typeof f.message === 'string') {
          errorMessage = f.message;
        }
      };
      const onEvent = (ev: ScriptEvent): void => {
        if (ev.kind === 'stdout' && typeof ev.chunk === 'string') {
          buffer += ev.chunk;
          let nl = buffer.indexOf('\n');
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line !== '') consumeLine(line);
            nl = buffer.indexOf('\n');
          }
          return;
        }
        if (ev.kind === 'stderr' && typeof ev.chunk === 'string') {
          // 非零退出诊断不丢失（移交项 #1）：[lane] warn 透传＋尾部行并入错误消息
          const text = ev.chunk.trim();
          if (text !== '') {
            ctx.log('warn', `[${ctx.lane.label}] ${text}`);
            stderrTail = text.split('\n').at(-1) ?? text;
          }
          return;
        }
        if (ev.kind === 'exit') {
          if (ctx.isAborted()) {
            // 被 AbortCoordinator 强杀（killScript 后退出码非 0）：⊘ 收敛、不计节点 error
            done(() => reject(new ExecAbortedError()));
            return;
          }
          const code = ev.code ?? -1;
          if (code === 0) {
            const finalOut = result;
            if (finalOut !== undefined) done(() => resolve(finalOut));
            else done(() => reject(new Error('脚本退出码 0 但缺少 result 终帧')));
          } else {
            const detail = errorMessage ?? (stderrTail !== undefined ? `${stderrTail}（退出码 ${code}）` : undefined);
            done(() => reject(new Error(detail ?? `脚本退出码 ${code}`)));
          }
        }
      };
      // 订阅先于 spawn：spawn 期间同步回放的帧不丢
      const unsub = transport.onScriptEvent((ev) => {
        if (ev.nodeRunId === ctx.nodeRunId) onEvent(ev);
      });
      this.deps.onScriptActive?.(ctx.nodeRunId, true); // 活跃登记先于 spawn（kill 数据源）
      void transport
        .spawnScript(req)
        .then((res) => {
          if (!res.ok) done(() => reject(new Error('脚本未能启动（spawnScript ok=false）')));
        })
        .catch((e: unknown) => done(() => reject(e instanceof Error ? e : new Error(String(e)))));
    });
  }
}

/** extract 表达式（最小实现——DOM 备选双路径/就绪等待随 T4-05） */
function extractExpression(params: Record<string, unknown>): { expression: string } {
  const selector = typeof params.selector === 'string' ? params.selector : '';
  const attr = typeof params.attr === 'string' ? params.attr : null;
  const expression =
    attr !== null
      ? `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attr)})`
      : `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`;
  return { expression };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
