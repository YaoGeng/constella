// ExecDispatcher 组件套件（T4-02＋T4-03；TDD-C-03 §3 ExecDispatcher 行；02 §10 #6/#10＋§8.5＋§14）。
// 断言面：
//   custom → run:spawnScript 请求形（lang python→py、scriptPath/entry/params/input、
//   timeoutMs/retries 缺省 30000/0＋显式 0 值透传〔X-4〕、laneKey）；
//   stdout JSON 行协议（S-5 冻结/K-01 bootstrap）：log 帧→[lane] 前缀日志、result 帧→NodeOut、
//   exit 0 → resolve；exit 非 0 → reject（error 帧消息＞stderr 尾行诊断＞退出码）；exit 0 缺
//   result → reject；result 载荷非对象 → reject（NodeOut 形校验）；stderr 分片 → [lane] warn
//   透传＋并入非零退出诊断（移交项 #1）；单 chunk 多 JSON 行（粘包）逐行重组（移交项 #5）；
//   emit 帧提前出口：ctx.emit(branch,payload)；emit 出口未命中 N2 outs → reject；
//   N5 inner 内联展开＝单进程多步骤：spawnScript 恰一次＋`[lane] ▸ 步骤N` 前缀日志（02 §8.5）；
//   活跃登记（onScriptActive）：spawn 前 true、settle 后 false（AbortCoordinator kill 数据源）；
//   delay → 可中断计时（50ms 步进查 abort：中断抛 ExecAbortedError、完整返回 {data:input}）；
//   logic.branch → BranchFilter 真实求值（T-1 对称语义两侧＋求值异常 reject）；
//   human.* → 断点门闩（setStatus(waiting)＋挂起；T4-04：resolve 载荷=交付下游数据
//   〔confirm=合并值/skip=原始 input——HitCoordinator〕；终止放行=reject ExecAbortedError）；
//   cdp.* → env:cdpProbe 前置探活（失败→reject＋ctx.failRun〔X-3〕；ok→ensureSession）＋
//   命令经注入 CommandTransport（帧形=T0-07 冻结；错误帧→reject；未注入→extract/click 抛错）；
//   无专属执行体的平台内置类型 → {data: input} 占位直通（不 spawn）。
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { BridgeRequest, BridgeResponse, FlowNode, LogLevel, ScriptEvent, SpawnScriptReq } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import { ExecAbortedError, ExecDispatcher, type ExecContext } from './exec-dispatcher';
import { LaneManager } from './lane-manager';
import type { CommandTransport, NodeStatus, RunRegistryLike, RunTransport } from './types';

// ————————————————————————————————————————————
// fixture
// ————————————————————————————————————————————

function def(type: string, over: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type,
    kind: type.startsWith('custom.') ? 'custom' : 'builtin',
    meta: { name: type, icon: 'x', category: '数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
    paramsSchema: [],
    exec: type.startsWith('custom.') ? { lang: 'ts', file: `scripts/${type}.ts`, entry: 'run' } : null,
    version: '1.0.0',
    packageVersion: '1.0.0',
    ...over,
  };
}

/**
 * fake 执行面传输：脚本行为按 nodeId 可编程（spawn 时同步回放帧）；帧也可在 spawn 后
 * 经 pushRaw/exit0/exitFail 手动驱动（订阅先于 spawn，dispatcher 事件面不丢帧）。
 */
function fakeTransport() {
  const scriptSubs = new Set<(e: ScriptEvent) => void>();
  const spawns: SpawnScriptReq[] = [];
  const behaviors = new Map<string, (push: (frame: unknown) => void) => void>();
  let portSeq = 9220;
  const pushRaw = (nodeRunId: string, frame: unknown): void => {
    const chunk = `${JSON.stringify(frame)}\n`;
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'stdout', chunk });
  };
  /** 原始分片直推（行缓冲验证用） */
  const pushChunk = (nodeRunId: string, chunk: string): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'stdout', chunk });
  };
  /** stderr 分片直推（非零退出诊断路径） */
  const pushStderr = (nodeRunId: string, chunk: string): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'stderr', chunk });
  };
  const transport: RunTransport = {
    onCronFired: () => () => undefined,
    onScriptEvent: (fn) => (scriptSubs.add(fn), () => scriptSubs.delete(fn)),
    spawnScript: async (req) => {
      spawns.push(req);
      const nodeId = req.nodeRunId.split(':')[1] ?? req.nodeRunId;
      const behavior = behaviors.get(nodeId);
      if (behavior) behavior((frame) => pushRaw(req.nodeRunId, frame));
      return { ok: true, pid: 100 + spawns.length };
    },
    cdpCreateSession: async () => ({ port: ++portSeq, partition: 'persist:f1·main' }),
    cdpNavigate: async () => ({ ok: true }),
    killScript: async () => ({ ok: true }),
    cdpDestroyRun: async () => ({ ok: true }),
    envCdpProbe: async () => ({ ok: true }),
  };
  const exit0 = (nodeRunId: string): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'exit', code: 0, ms: 12 });
  };
  const exitFail = (nodeRunId: string, code = 1): void => {
    for (const fn of scriptSubs) fn({ nodeRunId, kind: 'exit', code, ms: 12 });
  };
  return { transport, spawns, behaviors, pushRaw, pushChunk, pushStderr, exit0, exitFail };
}

/** fake CommandTransport（T0-07 帧形消费面）：记录请求、可编程响应 */
function fakeCommandTransport(respond?: (req: Omit<BridgeRequest, 'id'>) => BridgeResponse) {
  const frames: Omit<BridgeRequest, 'id'>[] = [];
  const commandTransport: CommandTransport = {
    send: async (req) => {
      frames.push(req);
      return respond ? respond(req) : { id: 0, ok: true, result: 'ok-result' };
    },
  };
  return { commandTransport, frames };
}

/** 执行上下文记录器（dispatcher 的驱动面；hitGate/failRun 可编程） */
function recorderCtx(over: Partial<ExecContext> = {}) {
  const logs: { level: LogLevel; msg: string }[] = [];
  const emits: { branch: string; payload: unknown }[] = [];
  const statuses: { status: NodeStatus; error?: string }[] = [];
  const failures: string[] = [];
  let release: (payload: unknown) => void = () => undefined;
  const hitGate = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const ctx: ExecContext = {
    lane: { key: 'main', label: '主支' },
    nodeRunId: 'r1:x',
    log: (level, msg) => logs.push({ level, msg }),
    emit: (branch, payload) => emits.push({ branch, payload }),
    setStatus: (status, error) => statuses.push({ status, error }),
    isAborted: () => false,
    holdAtBreakpoint: () => hitGate,
    failRun: (reason) => failures.push(reason),
    ...over,
  };
  return { ctx, logs, emits, statuses, failures, releaseHit: (payload?: unknown) => release(payload) };
}

function makeDispatcher(
  defs: readonly NodeDefinition[],
  over: { transport?: RunTransport; commandTransport?: CommandTransport; onScriptActive?: (nodeRunId: string, active: boolean) => void } = {},
): ExecDispatcher {
  const registry: RunRegistryLike = { get: (type) => defs.find((d) => d.type === type), isBroken: () => false };
  const lanes = new LaneManager({ runId: 'r1', ...(over.transport ? { transport: over.transport } : {}) });
  return new ExecDispatcher({
    registry,
    lanes,
    runId: 'r1',
    ...(over.transport ? { transport: over.transport } : {}),
    ...(over.commandTransport ? { commandTransport: over.commandTransport } : {}),
    ...(over.onScriptActive ? { onScriptActive: over.onScriptActive } : {}),
  });
}

function node(id: string, type: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

const NR = 'r1:x';

afterEach(() => {
  vi.useRealTimers();
});

// ————————————————————————————————————————————
// custom → run:spawnScript＋stdout JSON 行协议
// ————————————————————————————————————————————

describe('ExecDispatcher custom 脚本分派', () => {
  it('spawn 请求形：lang python→py、scriptPath/entry/params/input、timeoutMs 缺省 30000、retries 缺省 0、laneKey', async () => {
    const fx = fakeTransport();
    fx.behaviors.set('x', (push) => push({ type: 'result', out: { data: 'R' } }));
    const dispatcher = makeDispatcher(
      [def('custom.x', { exec: { lang: 'python', file: 'scripts/x.py', entry: 'run' } })],
      { transport: fx.transport },
    );
    const p = dispatcher.dispatch(node('x', 'custom.x', { k: 1 }), 'IN', recorderCtx().ctx);
    fx.exit0(NR);
    await expect(p).resolves.toEqual({ data: 'R' });
    expect(fx.spawns[0]).toMatchObject({
      nodeRunId: NR,
      lang: 'py',
      scriptPath: 'scripts/x.py',
      entry: 'run',
      params: { k: 1 },
      input: 'IN',
      timeoutMs: 30000,
      retries: 0,
      laneKey: 'main',
    });
  });

  it('result 帧 → NodeOut resolve＋log 帧 [lane] 前缀日志', async () => {
    const fx = fakeTransport();
    fx.behaviors.set('x', (push) => push({ type: 'log', msg: '抓取中…' }));
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, rec.ctx);
    fx.pushRaw(NR, { type: 'result', out: { data: { list: [1, 2] } } });
    fx.exit0(NR);
    await expect(p).resolves.toEqual({ data: { list: [1, 2] } });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] 抓取中…' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] 运行脚本 scripts/custom.x.ts（TypeScript · 入口 run）' });
  });

  it('stdout 分片跨 chunk 重组：JSON 行按换行切分（行缓冲）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, rec.ctx);
    const raw = `${JSON.stringify({ type: 'log', msg: '分片日志' })}\n`;
    const half = Math.floor(raw.length / 2);
    fx.pushChunk(NR, raw.slice(0, half)); // 前半行：不解析（前缀「运行脚本」行已产生——只查分片日志）
    expect(rec.logs.some((l) => l.msg.includes('分片日志'))).toBe(false);
    fx.pushChunk(NR, raw.slice(half)); // 后半行＋换行：整行解析
    fx.pushRaw(NR, { type: 'result', out: { data: 'ok' } });
    fx.exit0(NR);
    await expect(p).resolves.toEqual({ data: 'ok' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] 分片日志' });
  });

  it('policy 显式 0 值透传（X-4）：timeoutMs=0/retries=0 原样下发', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x', { policy: { timeoutMs: 0, retries: 0 } })], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.pushRaw(NR, { type: 'result', out: { data: null } });
    fx.exit0(NR);
    await p;
    expect(fx.spawns[0]).toMatchObject({ timeoutMs: 0, retries: 0 });
  });

  it('policy 非缺省值原样（retries/backoff 编排归 T4-04——本卡只透传）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x', { policy: { timeoutMs: 5000, retries: 2 } })], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.pushRaw(NR, { type: 'result', out: { data: null } });
    fx.exit0(NR);
    await p;
    expect(fx.spawns[0]).toMatchObject({ timeoutMs: 5000, retries: 2 });
  });

  it('exit 非 0 → reject（error 帧消息优先）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.pushRaw(NR, { type: 'error', name: 'Error', message: '网络超时', code: null, stack: null });
    fx.exitFail(NR, 1);
    await expect(p).rejects.toThrow('网络超时');
  });

  it('exit 非 0 且无 error 帧 → reject 携退出码', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.exitFail(NR, 2);
    await expect(p).rejects.toThrow('2');
  });

  it('exit 0 缺 result 终帧 → reject（协议违规）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.exit0(NR);
    await expect(p).rejects.toThrow('result');
  });

  it('result 载荷非对象（字符串/数组/null）→ reject 且文案指明 NodeOut 形（移交项 #2）', async () => {
    for (const bad of ['oops', ['a'], null]) {
      const fx = fakeTransport();
      const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
      const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
      fx.pushRaw(NR, { type: 'result', out: bad });
      fx.exit0(NR);
      await expect(p).rejects.toThrow('NodeOut');
    }
  });

  it('stderr 分片 → [lane] warn 透传＋非零退出时并入诊断（移交项 #1：诊断不丢失）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, rec.ctx);
    fx.pushStderr(NR, 'Traceback (most recent call last):\n');
    fx.pushStderr(NR, '  File "x.py", line 3\n');
    fx.pushStderr(NR, 'ValueError: bad input\n');
    fx.exitFail(NR, 1);
    await expect(p).rejects.toThrow('ValueError: bad input（退出码 1）'); // 尾行并入错误消息
    expect(rec.logs).toContainEqual({ level: 'warn', msg: '[主支] Traceback (most recent call last):' }); // [lane] 透传
    expect(rec.logs.some((l) => l.level === 'warn' && l.msg.includes('ValueError'))).toBe(true);
  });

  it('error 帧消息优先于 stderr 诊断（error 帧=S-5 结构化失败帧）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.pushStderr(NR, 'some stderr noise\n');
    fx.pushRaw(NR, { type: 'error', message: '网络超时' });
    fx.exitFail(NR, 1);
    await expect(p).rejects.toThrow('网络超时');
  });

  it('单 chunk 多 JSON 行（粘包）：逐行重组不丢帧（移交项 #5）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, rec.ctx);
    const l1 = `${JSON.stringify({ type: 'log', msg: '第一行' })}\n`;
    const l2 = `${JSON.stringify({ type: 'log', msg: '第二行' })}\n`;
    fx.pushChunk(NR, l1 + l2); // 两行同一分片
    fx.pushRaw(NR, { type: 'result', out: { data: 'ok' } });
    fx.exit0(NR);
    await expect(p).resolves.toEqual({ data: 'ok' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] 第一行' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] 第二行' });
  });

  it('onScriptActive 活跃登记：spawn 前 true、settle 后 false（AbortCoordinator kill 数据源）', async () => {
    const fx = fakeTransport();
    const active: [string, boolean][] = [];
    const dispatcher = makeDispatcher([def('custom.x')], {
      transport: fx.transport,
      onScriptActive: (id, a) => active.push([id, a]),
    });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.pushRaw(NR, { type: 'result', out: { data: null } });
    fx.exit0(NR);
    await p;
    expect(active).toEqual([[NR, true], [NR, false]]);
  });

  it('spawnScript 返回 ok=false → reject', async () => {
    const fx = fakeTransport();
    const subs = new Set<(e: ScriptEvent) => void>();
    const transport: RunTransport = {
      ...fx.transport,
      spawnScript: async () => ({ ok: false, pid: -1 }),
      onScriptEvent: (fn) => (subs.add(fn), () => subs.delete(fn)),
    };
    const dispatcher = makeDispatcher([def('custom.x')], { transport });
    await expect(dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx)).rejects.toThrow('spawnScript');
  });

  it('未注入执行面传输 → reject（节点 error 路径）', async () => {
    const dispatcher = makeDispatcher([def('custom.x')]);
    await expect(dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx)).rejects.toThrow('执行面传输未注入');
  });
});

// ————————————————————————————————————————————
// emit 提前出口＋N5 inner 内联展开（02 §8.5）
// ————————————————————————————————————————————

describe('ExecDispatcher emit/N5 内联展开', () => {
  const N5 = def('custom.reply', {
    inner: ['取材·列表复放', '会话判向', '意图识别'],
    ports: { ins: ['in'], outs: [{ id: 'replied', label: '已回复' }, { id: 'escalated', label: '转人工' }, { id: 'skipped', label: '拒答' }] },
  });

  it('emit 帧 → ctx.emit(branch,payload) 提前出口（脚本未退出即回调）', async () => {
    const fx = fakeTransport();
    fx.behaviors.set('x', (push) => {
      push({ type: 'emit', branch: 'out', payload: { uid: 7 } });
      push({ type: 'result', out: { data: 'done' } });
    });
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, rec.ctx);
    fx.exit0(NR);
    await expect(p).resolves.toEqual({ data: 'done' });
    expect(rec.emits).toEqual([{ branch: 'out', payload: { uid: 7 } }]);
  });

  it('emit 出口未命中 N2 outs → reject（防拼写错路由，02 §14）', async () => {
    const fx = fakeTransport();
    fx.behaviors.set('x', (push) => {
      push({ type: 'emit', branch: 'escalated', payload: null });
    });
    const dispatcher = makeDispatcher([def('custom.x')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('x', 'custom.x'), null, recorderCtx().ctx);
    fx.exit0(NR);
    await expect(p).rejects.toThrow('出口未命中');
  });

  it('N5：spawnScript 恰一次（单进程）＋`[lane] ▸ 步骤N` 前缀日志＋emit 与最终 {data} 并行成立', async () => {
    const fx = fakeTransport();
    fx.behaviors.set('reply', (push) => {
      push({ type: 'emit', branch: 'escalated', payload: { session: 's1' } });
      push({ type: 'result', out: { data: { handled: 1 } } });
    });
    const dispatcher = makeDispatcher([N5], { transport: fx.transport });
    const rec = recorderCtx({ nodeRunId: 'r1:reply' });
    const p = dispatcher.dispatch(node('reply', 'custom.reply'), null, rec.ctx);
    fx.exit0('r1:reply');
    await expect(p).resolves.toEqual({ data: { handled: 1 } });
    expect(fx.spawns).toHaveLength(1);
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] ▸ 步骤1 取材·列表复放' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] ▸ 步骤2 会话判向' });
    expect(rec.logs).toContainEqual({ level: 'info', msg: '[主支] ▸ 步骤3 意图识别' });
    expect(rec.emits).toEqual([{ branch: 'escalated', payload: { session: 's1' } }]);
  });
});

// ————————————————————————————————————————————
// delay 可中断计时＋human.* 断点占位＋内置直通
// ————————————————————————————————————————————

describe('ExecDispatcher delay/human/内置直通', () => {
  it('delay：完整计时后返回 {data: input}（50ms 步进）', async () => {
    vi.useFakeTimers();
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('delay')], { transport: fx.transport });
    const p = dispatcher.dispatch(node('d', 'delay', { ms: 120 }), 'PASS', recorderCtx().ctx);
    const assertion = expect(p).resolves.toEqual({ data: 'PASS' });
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(fx.spawns).toHaveLength(0); // 不走脚本进程
  });

  it('delay：ms 非法/缺省 → 500 兜底', async () => {
    vi.useFakeTimers();
    const dispatcher = makeDispatcher([def('delay')]);
    const p = dispatcher.dispatch(node('d', 'delay', { ms: 'abc' }), null, recorderCtx().ctx);
    const assertion = expect(p).resolves.toEqual({ data: null });
    await vi.advanceTimersByTimeAsync(550);
    await assertion;
  });

  it('delay：中途 abort → 抛 ExecAbortedError（可中断）', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const dispatcher = makeDispatcher([def('delay')]);
    const p = dispatcher.dispatch(node('d', 'delay', { ms: 200 }), null, recorderCtx({ isAborted: () => aborted }).ctx);
    const assertion = expect(p).rejects.toBeInstanceOf(ExecAbortedError);
    await vi.advanceTimersByTimeAsync(80); // 第一步进后置位
    aborted = true;
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });

  it('human.*：断点门闩——setStatus(waiting)＋挂起；resolve 载荷=交付数据（T4-04：confirm=合并值/skip=原始 input——载荷由 HitCoordinator 决定）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('human.review')], { transport: fx.transport });
    const rec = recorderCtx();
    const p = dispatcher.dispatch(node('h', 'human.review', { question: '请确认' }), 'UP', rec.ctx);
    await Promise.resolve(); // microtask：确认挂起（不因直通提前 resolve）
    expect(rec.statuses).toContainEqual({ status: 'waiting' });
    expect(rec.logs.some((l) => l.msg.includes('等待人工确认'))).toBe(true);
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // 门闩关闭：挂起中
    rec.releaseHit({ merged: 'DOWN' }); // 放行＝HitCoordinator confirm 语义（resolve 载荷透传）
    await expect(p).resolves.toEqual({ data: { merged: 'DOWN' } });
    expect(fx.spawns).toHaveLength(0);
  });

  it('human.*：门闩 reject（终止放行）→ ExecAbortedError 传播（⊘ 收敛路径）', async () => {
    const dispatcher = makeDispatcher([def('human.review')]);
    let rejectGate: (e: Error) => void = () => undefined;
    const gate = new Promise<void>((_, reject) => {
      rejectGate = reject;
    });
    const rec = recorderCtx({ holdAtBreakpoint: () => gate });
    const p = dispatcher.dispatch(node('h', 'human.review'), null, rec.ctx);
    rejectGate(new ExecAbortedError());
    await expect(p).rejects.toBeInstanceOf(ExecAbortedError);
  });

  it('无专属执行体的平台内置类型 → {data: input} 占位直通（不 spawn）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('trigger.manual'), def('data.transform')], { transport: fx.transport });
    await expect(dispatcher.dispatch(node('t', 'trigger.manual'), undefined, recorderCtx().ctx)).resolves.toEqual({ data: undefined });
    await expect(dispatcher.dispatch(node('a', 'data.transform'), 'X', recorderCtx().ctx)).resolves.toEqual({ data: 'X' });
    expect(fx.spawns).toHaveLength(0);
  });
});

// ————————————————————————————————————————————
// cdp.*：ensureSession＋命令经注入 CommandTransport（T0-07 帧形）
// ————————————————————————————————————————————

describe('ExecDispatcher cdp.* 分派', () => {
  it('cdp.open：lane 首建 cdp:createSession＋返回 {data:{url,port}}', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('cdp.open')], { transport: fx.transport });
    await expect(dispatcher.dispatch(node('o', 'cdp.open', { url: 'https://a.example.com' }), null, recorderCtx().ctx)).resolves.toEqual({
      data: { url: 'https://a.example.com', port: 9221 },
    });
  });

  it('cdp.extract：经 CommandTransport 发 Runtime.evaluate 帧（returnByValue）＋结果入 data', async () => {
    const fx = fakeTransport();
    const { commandTransport, frames } = fakeCommandTransport();
    const dispatcher = makeDispatcher([def('cdp.extract')], { transport: fx.transport, commandTransport });
    await expect(
      dispatcher.dispatch(node('e', 'cdp.extract', { selector: '.title', attr: 'href' }), null, recorderCtx().ctx),
    ).resolves.toEqual({ data: 'ok-result' });
    expect(frames).toEqual([
      {
        ns: 'cdp',
        method: 'Runtime.evaluate',
        params: expect.objectContaining({ returnByValue: true, expression: expect.stringContaining('.title') }),
      },
    ]);
  });

  it('cdp.click：Input.dispatchMouseEvent 两帧（pressed＋released）', async () => {
    const fx = fakeTransport();
    const { commandTransport, frames } = fakeCommandTransport();
    const dispatcher = makeDispatcher([def('cdp.click')], { transport: fx.transport, commandTransport });
    await dispatcher.dispatch(node('c', 'cdp.click', { x: 100, y: 200 }), null, recorderCtx().ctx);
    expect(frames.map((f) => f.method)).toEqual(['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
    expect(frames[0]?.params).toMatchObject({ type: 'mousePressed', x: 100, y: 200 });
    expect(frames[1]?.params).toMatchObject({ type: 'mouseReleased', x: 100, y: 200 });
  });

  it('CommandTransport 错误帧 → reject（携带帧错误码）', async () => {
    const fx = fakeTransport();
    const { commandTransport } = fakeCommandTransport(() => ({
      id: 0,
      ok: false,
      error: { code: 'CDP-COMMAND-FAILED', message: 'evaluate 失败' },
    }));
    const dispatcher = makeDispatcher([def('cdp.extract')], { transport: fx.transport, commandTransport });
    await expect(dispatcher.dispatch(node('e', 'cdp.extract', { selector: '.x' }), null, recorderCtx().ctx)).rejects.toThrow(
      'CDP-COMMAND-FAILED',
    );
  });

  it('未注入 CommandTransport → extract 抛错（open 不需要命令帧仍可用）', async () => {
    const fx = fakeTransport();
    const dispatcher = makeDispatcher([def('cdp.open'), def('cdp.extract')], { transport: fx.transport });
    await expect(dispatcher.dispatch(node('o', 'cdp.open', { url: 'https://a.example.com' }), null, recorderCtx().ctx)).resolves.toBeTruthy();
    await expect(dispatcher.dispatch(node('e', 'cdp.extract', { selector: '.x' }), null, recorderCtx().ctx)).rejects.toThrow(
      '命令传输未注入',
    );
  });

  it('env:cdpProbe 失败 → reject（CDP 环境未连接）＋ctx.failRun 失败终止（X-3：不走 failBranch）', async () => {
    const fx = fakeTransport();
    const probeTransport: RunTransport = {
      ...fx.transport,
      envCdpProbe: async () => ({ ok: false, detail: '会话进程未连接' }),
    };
    const dispatcher = makeDispatcher([def('cdp.open')], { transport: probeTransport });
    const rec = recorderCtx();
    await expect(dispatcher.dispatch(node('o', 'cdp.open', { url: 'https://a.example.com' }), null, rec.ctx)).rejects.toThrow(
      'CDP 环境未连接',
    );
    expect(rec.failures).toEqual([expect.stringContaining('CDP 环境未连接')]);
  });
});

// ————————————————————————————————————————————
// logic.branch：BranchFilter 真实求值（T-1 对称语义，02 §10 #6）
// ————————————————————————————————————————————

describe('ExecDispatcher logic.branch 分派', () => {
  const BRANCH = def('logic.branch', {
    ports: { ins: ['in'], outs: [{ id: 'true', label: '是' }, { id: 'false', label: '否' }] },
  });

  it('expr 求值 truthy → {branch:"true"}＋条件成立日志', async () => {
    const dispatcher = makeDispatcher([BRANCH]);
    const rec = recorderCtx();
    await expect(dispatcher.dispatch(node('b', 'logic.branch', { expr: 'price < 199' }), { price: 129 }, rec.ctx)).resolves.toEqual({
      branch: 'true',
    });
    expect(rec.logs.some((l) => l.msg.includes('条件成立 → 走 true 分支'))).toBe(true);
  });

  it('expr 求值 falsy → {branch:"false"}（对称）', async () => {
    const dispatcher = makeDispatcher([BRANCH]);
    await expect(dispatcher.dispatch(node('b', 'logic.branch', { expr: 'price < 199' }), { price: 500 }, recorderCtx().ctx)).resolves.toEqual({
      branch: 'false',
    });
  });

  it('expr 非法 → reject（节点 error 路径，非 branch-miss）', async () => {
    const dispatcher = makeDispatcher([BRANCH]);
    await expect(dispatcher.dispatch(node('b', 'logic.branch', { expr: 'price <' }), { price: 1 }, recorderCtx().ctx)).rejects.toThrow(
      'expr 求值失败',
    );
  });
});
