// confirm-host —— InstallConfirm 命令式弹窗宿主（T6-17；T5-10 交付注「装配（弹窗开关与
// Promise 归宿）在应用壳」的落位）。
//   createMarketAssembly(deps).confirm 的**真注入实现**：替换缺省 `(async()=>true)` 开发态放行
//   （market-assembly.ts 缺省仅为开发——T6-17 卡面①）。两拦截点（market 安装框1/导入链框2）
//   共用一框：同一 host 串行服务——**FIFO 数组队列**（一次一框；队首决出后自动上架下一项，
//   任意并发数零悬挂——返工 MINOR-2：替代初版 resolve 猴补丁〔≥3 并发丢帧〕）。
//   React 半段（InstallConfirmHost——app-shell.tsx）经 subscribe/useSyncExternalStore 消费；
//   纯 TS 无 React 依赖（runtime 构造先于渲染）。
import type { LogLevel } from '@constella/shared/ipc';
import type { InstallConfirmData } from '../market/install-confirm';

/** 在途确认请求（resolve 归宿＝宿主 UI 确认/取消钮） */
export interface ConfirmRequest {
  data: InstallConfirmData;
  resolve(ok: boolean): void;
}

export interface ConfirmHost {
  /** createMarketAssembly deps.confirm 真注入面（缺省放行的反义——取消即 false） */
  confirm(data: InstallConfirmData): Promise<boolean>;
  /** 当前展示请求快照（null=队空——useSyncExternalStore getSnapshot 面） */
  snapshot(): ConfirmRequest | null;
  /** 展示变化订阅（上架/决出各一拍；返回退订） */
  subscribe(fn: () => void): () => void;
}

/** 弹窗宿主（FIFO 串行：入队→队首展示→决出弹出→下一项上架） */
export function createConfirmHost(): ConfirmHost {
  const listeners = new Set<() => void>();
  const queue: ConfirmRequest[] = [];
  let current: ConfirmRequest | null = null;
  const emit = (): void => {
    for (const fn of [...listeners]) fn();
  };
  /** 队首上架（空队=null——决出后调用驱动下一项） */
  const present = (): void => {
    current = queue.shift() ?? null;
    emit();
  };
  return {
    confirm(data) {
      return new Promise<boolean>((resolve) => {
        const req: ConfirmRequest = {
          data,
          resolve: (ok) => {
            resolve(ok);
            // 仅当前展示项决出才推进（已决出的陈旧 resolve no-op——防双推进）
            if (current === req) {
              current = null;
              present();
            }
          },
        };
        queue.push(req);
        if (current === null) present();
      });
    },
    snapshot: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

// ————————————————————————————————————————————
// notify 宿主（runtime 构造先于 React——toast 队列绑定位）
// ————————————————————————————————————————————

/** toast 绑定宿主（生产=index.tsx 构造 runtime 时注入，AppShell 挂载后绑定画布 toast 队列） */
export interface NotifyHost {
  notify(level: LogLevel, msg: string): void;
  bind(impl: ((level: LogLevel, msg: string) => void) | null): void;
}

export function createNotifyHost(): NotifyHost {
  let impl: ((level: LogLevel, msg: string) => void) | null = null;
  return {
    notify(level, msg) {
      impl?.(level, msg);
    },
    bind(next) {
      impl = next;
    },
  };
}
