// Watchdog —— 退出看门狗＋N6 超时强杀（T4-16 / TDD-C-M1 §3 Watchdog 组件行；S-5 ④＋02 §8.6）。
//
// 语义冻结：
//   - 退出看门狗（S-5 ④）：宿主对子进程生命周期兜底——即便脚本产出终帧后进程不退出
//     （P1 实测：漏注 ELECTRON_RUN_AS_NODE 按 Electron main 语义执行且不退出），到点强杀；
//   - N6 timeoutMs 到点超时强杀（02 §8.6）：arm(pid,timeoutMs) 起 = 轮询 pid 存活＋超时计时；
//     到点仍活 → killTree（win32 冻结 taskkill /PID x /T /F）→ 等退出 → resolve {timedOut:true}；
//     pid 先死 → resolve {timedOut:false}；
//   - timeoutMs=0 → 不武装（C-03 §N6 0 值语义——调用方〔SandboxExecutor〕不调 arm；本组件
//     arm 对 ≤0 拒绝——misuse 防御）；
//   - 观测按 code 不按 signal（S-4 ③——signal 名 Windows 不可依赖）；code 权威值由
//     SandboxExecutor 持有的 child 'close' 事件承载，本组件 ExitInfo 只报存活/超时/耗时。
//
// 强杀本体=ProcessKiller（T4-17：taskkill /T /F＋杀后复查 KillReport）——缺省注入位已换装
// ProcessKiller（S-4 ① 复查面）；deps.killTree 仍为测试/定制注入缝，返回值容 KillReport。
import { spawn } from 'node:child_process';
import { ProcessKiller } from './process-killer';

/** arm 观测结果（退出码权威面=SandboxExecutor child close；见文件头） */
export interface ExitInfo {
  pid: number;
  /** 到点超时强杀（false=自然退出先于到点） */
  timedOut: boolean;
  /** arm 起至观测退出耗时 ms */
  ms: number;
}

/** 树杀面（T4-17 ProcessKiller.killTree 已换装缺省——返回 KillReport 亦可注入；void 形兼容） */
export type KillTreeFn = (pid: number) => Promise<unknown>;

/** 最小树杀（win32 冻结形参；无复查——独立最小面，SandboxExecutor/Watchdog 缺省走 ProcessKiller） */
export async function taskkillTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    p.on('close', () => resolve());
    p.on('error', () => resolve());
  });
}

/** 缺省树杀体（ProcessKiller——S-4 ① 杀后复查；模块级单例，arm 多次复用） */
const defaultProcessKiller = new ProcessKiller();

/** 存活探测（signal 0；ESRCH=已退） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'; // EPERM 等=按存活处理
  }
}

/** 构造依赖 */
export interface WatchdogDeps {
  /** 树杀实现（缺省=ProcessKiller.killTree——T4-17 换装：taskkill /T /F＋杀后复查） */
  killTree?: KillTreeFn;
  /** 存活轮询间隔（缺省 50ms；测试可收紧） */
  pollIntervalMs?: number;
}

/**
 * Watchdog（§3 组件级接口 `arm(pid,timeoutMs): Promise<ExitInfo>`——单实例可重复 arm
 * 多 pid〔每 arm 一次观测〕；resolve 后计时器全清）。
 */
export class Watchdog {
  constructor(private readonly deps: WatchdogDeps = {}) {}

  /** 武装一个 pid：到点强杀或观测自然退出（timeoutMs≤0 拒绝——0 值=调用方不武装） */
  arm(pid: number, timeoutMs: number): Promise<ExitInfo> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error(`Watchdog.arm：非法 timeoutMs（≤0 须由调用方不武装——N6 0 值语义）: ${timeoutMs}`));
    }
    const killTree = this.deps.killTree ?? ((pid: number) => defaultProcessKiller.killTree(pid));
    const pollMs = this.deps.pollIntervalMs ?? 50;
    const startedAt = Date.now();
    return new Promise<ExitInfo>((resolve) => {
      let timedOut = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let poller: ReturnType<typeof setInterval> | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (poller !== undefined) clearInterval(poller);
        resolve({ pid, timedOut, ms: Date.now() - startedAt });
      };
      poller = setInterval(() => {
        if (!isAlive(pid)) finish();
      }, pollMs);
      poller.unref?.();
      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        // 触发树杀（缺省=ProcessKiller：taskkill /T /F＋杀后复查）；杀后退出确认仍由轮询观测
        void killTree(pid).catch((err) => {
          // T4-16 评审移交③（静默丢弃面补 warn）：树杀失败留痕——孤儿清扫兜底面数据源
          console.error('[constella-watchdog] 超时树杀失败（孤儿清扫面兜底）:', err);
        });
      }, timeoutMs);
      timer.unref?.();
    });
  }
}
