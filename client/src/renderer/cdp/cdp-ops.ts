// CdpOps —— C-04 cdp.open/extract/click 操作语义（T4-05；TDD-C-04 §1 三操作＋S-3 判据 3 参数；
// C-03 ExecDispatcher 消费面——CommandTransport＋会话网关注入）。
// 坑①：attach 后必须先导航再发命令（空窗口发 CDP 不可靠）——open 必先 navigate（经 cdp:navigate
//   通道网关），未导航 extract/click 在规格面即拒（真实 CDP 拒绝=§6.2b 集成段→T4-18）；
// 坑④：就绪等待=Page.enable＋readyState 轮询兜底（loadEventFired 由 cdp:navigate 通道在 main 侧
//   Page.enable 后等待——桥 V1.0 无推送帧，renderer 侧收不到事件，轮询为 renderer 侧唯一兜底）。
// 实例作用域=lane 会话（每 lane 一个实例；navigated 状态随会话）。
import { BridgeCommandError, type CommandTransport } from './command-transport';

/** readyState 轮询间隔（自拟规格） */
const READY_POLL_INTERVAL_MS = 100;
/** 就绪等待缺省预算（自拟规格；waitMs=0→单查不重试——「0 值=不武装」口径，N6 timeoutMs 同源哲学） */
const READY_WAIT_DEFAULT_MS = 5_000;

/** 会话网关注入位：导航经 cdp:navigate 通道（ensureSession/createSession 归 C-03 LaneManager） */
export interface LaneSessionPort {
  navigate(url: string): Promise<void>;
}

export interface CdpOpsDeps {
  readonly transport: CommandTransport;
  readonly session: LaneSessionPort;
  /** 轮询间隔等待注入位（测试 fake；缺省真实 setTimeout） */
  readonly delay?: (ms: number) => Promise<void>;
}

/** cdp.open 节点参数（demo L872：url＋wait「等待加载 (ms)」） */
export interface CdpOpenOp {
  readonly url: string;
  readonly waitMs?: number;
}

/** cdp.extract 节点参数（demo L874：selector＋attr，attr 缺省 textContent） */
export interface CdpExtractOp {
  readonly selector: string;
  readonly attr?: string;
}

/** cdp.click 节点参数（demo L876：selector） */
export interface CdpClickOp {
  readonly selector: string;
}

export interface CdpOps {
  open(op: CdpOpenOp): Promise<{ readonly url: string; readonly readyState: string }>;
  extract(op: CdpExtractOp): Promise<{ readonly values: unknown[] }>;
  click(op: CdpClickOp): Promise<{ readonly x: number; readonly y: number }>;
}

/** 坑①规格面拒绝：未导航即发命令（§6.2b 集成段序断言的 renderer 侧对应物） */
export class NotNavigatedError extends Error {
  constructor() {
    super('lane 会话尚未导航：须先 cdp.open（S-3 坑①——attach 后先导航再发命令）');
    this.name = 'NotNavigatedError';
  }
}

export function createCdpOps(deps: CdpOpsDeps): CdpOps {
  const { transport, session } = deps;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let navigated = false;

  // ————————————————————————————————————————————
  // 响应形收窄（send 返回 unknown——桥帧 result 无 schema，按所用字段运行时收窄）
  // ————————————————————————————————————————————
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  /** Runtime.evaluate 成功响应→result.value（string）；异常/缺形→undefined */
  const evalString = (res: unknown): string | undefined => {
    if (isRecord(res) && isRecord(res.result) && typeof res.result.value === 'string') {
      return res.result.value;
    }
    return undefined;
  };
  /** nodeId 提取（DOM.getDocument→root.nodeId／DOM.querySelector→nodeId；缺形=0） */
  const nodeIdOf = (res: unknown, key: 'root' | 'self'): number => {
    const holder = key === 'root' && isRecord(res) ? res.root : res;
    if (isRecord(holder) && typeof holder.nodeId === 'number') return holder.nodeId;
    return 0;
  };
  /** evaluate 成功响应→JSON.parse(result.value)；异常（exceptionDetails）/缺形→undefined */
  const rawJsonOf = (res: unknown): unknown => {
    if (isRecord(res) && 'exceptionDetails' in res) return undefined;
    const raw = evalString(res);
    return raw !== undefined ? JSON.parse(raw) : undefined;
  };

  /** readyState 单查（坑④轮询兜底；帧错误冒泡——N6 策略接管，B-14） */
  const currentReadyState = async (): Promise<string> => {
    const res = await transport.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    return evalString(res) ?? 'unknown';
  };

  return {
    async open(op) {
      await session.navigate(op.url); // 坑①：先导航再发命令（cdp:navigate 通道，main 侧等 loadEventFired）
      navigated = true;
      await transport.send('Page.enable', {}); // 坑④前提（S-3 发现 4）
      const budget = op.waitMs ?? READY_WAIT_DEFAULT_MS;
      let readyState = await currentReadyState(); // t=0 首查
      let elapsed = 0;
      while (readyState !== 'complete' && budget - elapsed >= READY_POLL_INTERVAL_MS) {
        await delay(READY_POLL_INTERVAL_MS);
        elapsed += READY_POLL_INTERVAL_MS;
        readyState = await currentReadyState();
      }
      return { url: op.url, readyState };
    },

    async extract(op) {
      if (!navigated) throw new NotNavigatedError(); // 坑①规格面：未导航即发命令被拒
      // 主路径：Runtime.evaluate（returnByValue）——S-3 判据 3；textContent 为 property 特判，余走 getAttribute
      const selector = JSON.stringify(op.selector);
      const attr = op.attr ?? 'textContent';
      const read = attr === 'textContent' ? 'el.textContent' : `el.getAttribute(${JSON.stringify(attr)})`;
      const expression = `JSON.stringify(Array.from(document.querySelectorAll(${selector})).map(el => ${read}))`;
      let raw: string | undefined;
      try {
        const res = await transport.send('Runtime.evaluate', { expression, returnByValue: true });
        raw = isRecord(res) && !('exceptionDetails' in res) ? evalString(res) : undefined;
      } catch (e) {
        // 仅帧错误降级备选路径（S-3 双路径）；其他错误冒泡
        if (!(e instanceof BridgeCommandError)) throw e;
      }
      if (raw !== undefined) {
        const parsed: unknown = JSON.parse(raw);
        return { values: Array.isArray(parsed) ? parsed : [parsed] };
      }
      // 备选路径：DOM.getDocument→querySelector→getOuterHTML（S-3 同判据双路径；未命中=空结果）
      const rootId = nodeIdOf(
        await transport.send('DOM.getDocument', { depth: -1 }),
        'root',
      );
      if (rootId === 0) return { values: [] };
      const nodeId = nodeIdOf(
        await transport.send('DOM.querySelector', { nodeId: rootId, selector: op.selector }),
        'self',
      );
      if (nodeId === 0) return { values: [] };
      const html = await transport.send('DOM.getOuterHTML', { nodeId });
      return { values: [isRecord(html) && typeof html.outerHTML === 'string' ? html.outerHTML : ''] };
    },

    async click(op) {
      if (!navigated) throw new NotNavigatedError(); // 坑①规格面
      // 先取 getBoundingClientRect 中心（S-3 判据 3），再 pressed＋released 两击
      const selector = JSON.stringify(op.selector);
      const expression =
        `JSON.stringify((() => { const el = document.querySelector(${selector});` +
        ' const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())';
      const res = await transport.send('Runtime.evaluate', { expression, returnByValue: true });
      const parsed: unknown = rawJsonOf(res);
      const x = isRecord(parsed) && typeof parsed.x === 'number' ? parsed.x : undefined;
      const y = isRecord(parsed) && typeof parsed.y === 'number' ? parsed.y : undefined;
      if (x === undefined || y === undefined) {
        throw new Error(`click 中心坐标未取到（selector=${op.selector}）`);
      }
      await transport.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await transport.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      return { x, y };
    },
  };
}
