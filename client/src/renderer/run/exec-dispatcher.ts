// ExecDispatcher —— 类型分派执行体（TDD-C-03 §3 ExecDispatcher 行；02 §10 #10＋§8.5＋§14；T4-02）。
//   custom（exec≠null）→ run:spawnScript：stdout JSON 行协议（S-5 冻结/K-01 bootstrap——
//     log/emit/result/error 四帧＋exit 码）；N5 组合节点 inner 内联展开＝单进程多步骤
//     （02 §8.5——展开实例化=步骤序日志 `[lane] ▸ 步骤N`，子步骤共享进程与 ctx）；
//     emit 帧=提前出口（ctx.emit 即时回调，脚本未退出即交付下游）；
//   human.* → 断点占位（setStatus(waiting)＋直通——HitCoordinator 实装随 T4-04）；
//   delay   → 可中断计时（50ms 步进查 abort，中断抛 ExecAbortedError）；
//   cdp.*   → LaneManager.ensureSession（首建/复用只更新 URL）＋命令经注入 CommandTransport
//     （帧形=T0-07 冻结；M4 PM 裁决 3 方案 A——ws client 实装随 T4-05 共用，本卡 fake 先行；
//     open/extract/click 完整操作语义〔先导航/evaluate returnByValue/中心两击/enable＋轮询〕
//     归 T4-05，本卡落注入 seam 与帧形）；
//   其余平台内置（无 exec/无专属分派）→ {data: input} 占位直通（V1.1 out.* 经内置分支
//     注册接入＝预留位，02 §8.8）。
// N6 重试/backoff/onFailure 路由归 T4-04 PolicyRunner（本卡 policy 只透传 timeoutMs/retries
// ＋缺省 30000/0，02 §8.6）；终止强杀（killScript）与断连分支（env:cdpProbe）归 T4-03。
import type { FlowNode, LogLevel, ScriptEvent, SpawnScriptReq } from '@constella/shared/ipc';
import type { NodeDefinition, NodeOut } from '@constella/shared/dsl';
import type { CommandTransport, Lane, NodeStatus, RunRegistryLike, RunTransport } from './types';
import { LaneManager } from './lane-manager';

/** 节点被终止（run aborted）——调用方按 skipped 收敛、不交付下游（demo L1910 语义） */
export class ExecAbortedError extends Error {
  constructor() {
    super('节点被终止（run aborted）');
    this.name = 'ExecAbortedError';
  }
}

/** 执行上下文（RunLoop 注入：lane/日志/emit 提前出口/状态回调/终止查询） */
export interface ExecContext {
  lane: Lane;
  /** nodeRun 关联键（spawnScript 事件流按此对账） */
  nodeRunId: string;
  /** 节点级日志（msg 由本组件拼 [lane] 前缀；落库/派发归调用方） */
  log(level: LogLevel, msg: string): void;
  /** emit 提前出口（分支路由即时发生；出口校验在本组件，miss=dispatch 失败） */
  emit(branch: string, payload?: unknown): void;
  /** 节点态回调（human.* waiting 占位等） */
  setStatus(status: NodeStatus, error?: string): void;
  isAborted(): boolean;
}

export interface ExecDispatcherDeps {
  registry: RunRegistryLike;
  lanes: LaneManager;
  runId: string;
  transport?: RunTransport;
  commandTransport?: CommandTransport;
}

/** 可中断计时步进（demo L1777-1787：50ms 轮询自觉退出） */
const ABORT_STEP_MS = 50;
/** delay 缺省时长（demo L1906 同值） */
const DELAY_DEFAULT_MS = 500;
/** N6 缺省守护 30s（02 §8.6） */
const DEFAULT_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ExecDispatcher {
  constructor(private readonly deps: ExecDispatcherDeps) {}

  /** §3 组件级接口：dispatch(node,input)→NodeOut（ctx=执行上下文注入位） */
  async dispatch(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
    if (node.type === 'delay') return this.runDelay(node, input, ctx);
    if (node.type.startsWith('human.')) return this.runHumanPlaceholder(node, input, ctx);
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

  /** human.* → 断点占位：waiting＋直通（hits.create/resume/300ms 放行随 T4-04 HitCoordinator） */
  private runHumanPlaceholder(node: FlowNode, input: unknown, ctx: ExecContext): NodeOut {
    ctx.setStatus('waiting');
    ctx.log('info', `等待人工确认：${node.name}（断点协调实装随 T4-04——本卡占位直通）`);
    return { data: input };
  }

  /** cdp.* → ensureSession＋命令经注入 CommandTransport（帧形=T0-07） */
  private async runCdp(node: FlowNode, input: unknown, ctx: ExecContext): Promise<NodeOut> {
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
      let settled = false;
      const done = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        unsub();
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
        if (ev.kind === 'exit') {
          const code = ev.code ?? -1;
          if (code === 0) {
            const finalOut = result;
            if (finalOut !== undefined) done(() => resolve(finalOut));
            else done(() => reject(new Error('脚本退出码 0 但缺少 result 终帧')));
          } else {
            done(() => reject(new Error(errorMessage ?? `脚本退出码 ${code}`)));
          }
        }
      };
      // 订阅先于 spawn：spawn 期间同步回放的帧不丢
      const unsub = transport.onScriptEvent((ev) => {
        if (ev.nodeRunId === ctx.nodeRunId) onEvent(ev);
      });
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
