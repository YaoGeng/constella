// @constella/sdk/bootstrap —— 子进程入口 trampoline（C-M1 SandboxExecutor 生成 entry 时引用，
// 随用户脚本一并打包执行——S-5 链路）。
//
// stdout JSON 行协议（S-5① 冻结，02 §8.4/§14；stderr 不承载协议）：
//   {"type":"log","msg":"..."}                                   ← ctx.log
//   {"type":"emit","branch":"...","payload":...}                 ← ctx.emit（命令式分支发射）
//   {"type":"result","out":<NodeOut>,"runtime":{...}}            ← 成功终帧（恰一且末行），exit 0
//   {"type":"error","name","message","code","stack"}             ← 失败终帧
// runtime={node,electron,execPath,sdkVersion}（K-01 §1；双运行时同构对照时剥除——§6.2）。
// 退出码（S-5② 冻结）：0=成功；1=脚本自身错误（run 抛出/拒绝、NodeOut 形状违规 OUT_INVALID、
// 能力 stub 抛错 SDK_CAP_UNAVAILABLE）；2=装配错误（ENTRY_NO_RUN/CTX_MISSING/CTX_INVALID_JSON，
// 重试无意义）。
//
// ctx 构造（02 §14/T0-06 会签绑定判据表）：log/sleep/emit 为真实现；七 Cap 绑定面——
// net=CONSTELLA_NET_WS 在场→真 cap（T5-12b 绑定客户端，net.ts）、缺场=未绑定 stub；
// browser/llm/file/im/vault/agent 仍一律未绑定 stub（访问即抛 SDK_CAP_UNAVAILABLE）——
// browser/llm=ws/env 注入位、file/vault=本地无桥，绑定实装随后续卡接入（K-01 §3 caps 行）。
import { unboundCap } from './caps.ts';
import { makeNetCap } from './net.ts';
import type { NodeCtx, NodeOut } from './index.ts';
import pkg from '../package.json' with { type: 'json' };

/** 协议级错误（帧 name=SdkError，code 携带具体错误码；exitCode 1|2） */
class SdkError extends Error {
  readonly code: string;
  readonly exitCode: 1 | 2;

  constructor(code: string, message: string, exitCode: 1 | 2) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

const send = (o: unknown): void => {
  process.stdout.write(JSON.stringify(o) + '\n');
};

function makeCtx(params: Record<string, unknown>, input: unknown, netClient: ReturnType<typeof makeNetCap> | null): NodeCtx {
  return {
    params,
    input,
    browser: unboundCap('browser'),
    llm: unboundCap('llm'),
    net: netClient ?? unboundCap('net'),
    file: unboundCap('file'),
    im: unboundCap('im'),
    vault: unboundCap('vault'),
    agent: unboundCap('agent'),
    log: (msg: string) => send({ type: 'log', msg: String(msg) }),
    // 可中断语义（aborted 时抛 Cancelled，02 §14「sleep→可中断」）归绑定实装/宿主强杀链路（C-M1）
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    emit: async (branch: string, payload?: unknown) => {
      send({ type: 'emit', branch, payload: payload ?? null });
    },
  };
}

/** NodeOut 联合校验（02 §14）：恰含 data 或 branch 之一；branch 必须为字符串——违规=OUT_INVALID（exit 1） */
function validateOut(out: unknown): asserts out is NodeOut {
  if (typeof out !== 'object' || out === null || Array.isArray(out)) {
    throw new SdkError('OUT_INVALID', 'run 返回值必须是 { data } 或 { branch, ... } 对象（02 §14 NodeOut）', 1);
  }
  const o = out as Record<string, unknown>;
  const hasData = 'data' in o;
  const hasBranch = 'branch' in o;
  if (hasData === hasBranch) {
    throw new SdkError('OUT_INVALID', 'run 返回值须恰含 data 或 branch 之一（02 §14 NodeOut）', 1);
  }
  if (hasBranch && typeof o.branch !== 'string') {
    throw new SdkError('OUT_INVALID', 'branch 必须为字符串（02 §14）', 1);
  }
}

export async function boot(userRun: unknown): Promise<void> {
  // net 绑定判据（T0-06 会签：N1 权限类目含「网络」→宿主注入 CONSTELLA_NET_WS）——
  // 在场=真 cap、缺场=未绑定 stub（三态 unbound 语义不破，K-01 §6.1）。
  // 终帧后须显式 close：ws 保活句柄会阻止子进程按 exitCode 退出（懒连接句柄在
  // 进程收尾面由 trampoline 释放——宿主强杀链路不依赖此处）。
  const netEndpoint = process.env.CONSTELLA_NET_WS;
  const netClient = netEndpoint !== undefined && netEndpoint !== '' ? makeNetCap(netEndpoint) : null;
  try {
    if (typeof userRun !== 'function') {
      throw new SdkError('ENTRY_NO_RUN', '脚本未导出 run(ctx)', 2);
    }
    const raw = process.env.CONSTELLA_CTX;
    if (!raw) {
      throw new SdkError('CTX_MISSING', '缺少 CONSTELLA_CTX 环境变量', 2);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SdkError('CTX_INVALID_JSON', 'CONSTELLA_CTX 不是合法 JSON', 2);
    }
    const p = (parsed ?? {}) as { params?: Record<string, unknown>; input?: unknown };
    const ctx = makeCtx(p.params ?? {}, p.input, netClient);
    const out = await (userRun as (ctx: NodeCtx) => Promise<unknown>)(ctx);
    validateOut(out);
    send({
      type: 'result',
      out,
      runtime: {
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        execPath: process.execPath,
        sdkVersion: pkg.version,
      },
    });
    process.exitCode = 0;
  } catch (e) {
    const err = e as Error & { code?: string; exitCode?: number };
    send({
      type: 'error',
      name: err.name,
      message: err.message,
      code: err.code ?? null,
      stack: typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 4).join('\n') : null,
    });
    process.exitCode = err instanceof SdkError ? err.exitCode : 1;
  } finally {
    netClient?.close(); // 释放 net 连接（终帧已落——close 只清保活句柄）
  }
}
