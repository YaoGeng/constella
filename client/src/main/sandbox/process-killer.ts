// ProcessKiller —— 树杀＋杀后复查（T4-17 / TDD-C-M1 §3 ProcessKiller 组件行＋S-4 ①③；
// win32 冻结 `taskkill /PID x /T /F`＋tasklist 复查——S-4 spike 实证直接输入）。
//
// 冻结面（§3 组件行＋spike S-4 结论）：
//   - taskkill /PID x /T /F（win32 冻结形参；/T 按 PID 快照遍历树——re-parent 后代会漏杀）；
//   - 杀后复查（S-4 ①）：每轮 kill 后 tasklist 枚举记录 PID（ASCII CSV 判活，不依赖
//     GBK 本地化文案），仍活→补杀（re-parent 残留），轮数耗尽→survivors 如实上报；
//   - KillReport：{pid, attempts, survivors}——调用面（watchdog 触发位/killScript/dispose/
//     sweepOrphans）按 survivors 残留告警（T4-16 评审移交③：静默丢弃面补 warn）；
//   - exit 观测按 code（code=1/signal=null，勿依赖 signal 名，S-4 ③）——观测权在
//     SandboxExecutor child close 事件，本组件只报 kill 面结果；
//   - 非 win32 树杀=§8⑤ 扩展位不在本卡（win32 冻结=taskkill）。
import { spawn } from 'node:child_process';

/** 杀后复查报告（§3 `killTree(pid): Promise<KillReport>`——残留=0 为常态判据） */
export interface KillReport {
  /** 强杀目标根 pid */
  pid: number;
  /** taskkill /T /F 执行轮数（首轮＋残留补杀） */
  attempts: number;
  /** 复查（tasklist 枚举）后仍存活的 pid——残留（理想 []；非空=告警面） */
  survivors: number[];
}

/** 构造依赖 */
export interface ProcessKillerDeps {
  /** 复查补杀轮数上限（缺省 3——spike ensureDead 同口径） */
  rounds?: number;
  /** 每轮 kill 后复查前等待 ms（缺省 250——taskkill 异步生效） */
  settleMs?: number;
  /** taskkill 执行注入缝（缺省真执行；测试注入 no-op 验证复查循环/残留上报） */
  taskkill?: (pid: number) => Promise<void>;
}

/** tasklist 枚举判活（/FI PID eq x /FO CSV /NH——ASCII CSV 列 2 比对，本地化无关） */
export function tasklistAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    p.on('error', () => resolve(false)); // tasklist 不可用=按死判（极端环境面）
    p.on('close', (code) => {
      if (code !== 0 && code !== null) {
        resolve(false); // 非零退出（过滤器无匹配等）=不存活（spike 同口径）
        return;
      }
      resolve(
        out.split(/\r?\n/).some((line) => {
          const cols = line.split(',');
          return cols.length > 1 && cols[1] === `"${pid}"`;
        }),
      );
    });
  });
}

/** taskkill /PID x /T /F 单轮执行（失败吞没——复查面 tasklist 判权威，spike 同口径） */
function taskkillTreeOnce(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    p.on('close', () => resolve());
    p.on('error', () => resolve());
  });
}

/**
 * ProcessKiller（§3 组件行：taskkill /T /F＋杀后复查；Watchdog/SandboxExecutor 换装体）。
 */
export class ProcessKiller {
  constructor(private readonly deps: ProcessKillerDeps = {}) {}

  /** 树杀＋复查（§3 冻结签名 `killTree(pid): Promise<KillReport>`） */
  async killTree(pid: number): Promise<KillReport> {
    const rounds = this.deps.rounds ?? 3;
    const settleMs = this.deps.settleMs ?? 250;
    const doKill = this.deps.taskkill ?? taskkillTreeOnce;
    let attempts = 0;
    let alive = true;
    for (let round = 0; round < rounds; round++) {
      attempts += 1;
      await doKill(pid);
      await new Promise((resolve) => setTimeout(resolve, settleMs)); // taskkill 异步生效
      alive = await tasklistAlive(pid); // 杀后复查（S-4 ①）：仍活→补杀（re-parent 残留）
      if (!alive) break;
    }
    const survivors = alive ? [pid] : [];
    if (survivors.length > 0) {
      // T4-16 评审移交③（T4-19 🟡 同口径精神）：残留不静默——告警留痕（孤儿清扫面兜底）
      console.error(`[constella-process-killer] 树杀后复查残留 pid=${pid}（${attempts} 轮 taskkill 后仍活）——KillReport.survivors 上报`);
    }
    return { pid, attempts, survivors };
  }
}
