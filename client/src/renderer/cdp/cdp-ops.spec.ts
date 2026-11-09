// C-04 CdpOps 操作语义单测（T4-05；TDD-C-04 §1 cdp.* 三操作＋S-3 判据 3 参数；
// C-03 ExecDispatcher 消费面——CommandTransport 注入）。断言面：
//   坑① attach 后先导航再发命令（open 必先 navigate；未导航 extract/click 被拒——规格面序断言，
//      真实 CDP 拒绝=§6.2b 集成段→T4-18 electron 头跑）；
//   坑④ 就绪等待=Page.enable＋readyState 轮询兜底（loadEventFired 由 cdp:navigate 通道在 main 侧等待）；
//   extract=Runtime.evaluate（returnByValue）主路径＋DOM.getDocument→querySelector→getOuterHTML 备选双路径；
//   click=Input.dispatchMouseEvent（mousePressed＋mouseReleased 于 getBoundingClientRect 中心）。
import { describe, expect, it } from 'vitest';
import { createCdpOps, NotNavigatedError, type CdpOps } from './cdp-ops';
import { BridgeCommandError, type BridgeCdpMethod, type CommandTransport } from './command-transport';

/** 命令帧记录（method/params 逐帧——序断言与帧形断言的数据源） */
interface SendCall {
  method: BridgeCdpMethod;
  params: Record<string, unknown>;
}

/** fake transport：script 按帧序返回结果（i=帧序号）。send 发生时刻即可断言网关序（坑①）。 */
function fakeTransport(script: (call: SendCall, i: number) => unknown) {
  const calls: SendCall[] = [];
  const transport: CommandTransport = {
    send: async (method, params) => {
      const i = calls.length;
      const call = { method, params };
      calls.push(call);
      return script(call, i);
    },
    close: () => undefined,
  };
  return { calls, transport };
}

/** 会话网关 fake（cdp:navigate 通道注入位）＋已导航 URL 序列 */
function fakeSession() {
  const navigated: string[] = [];
  return {
    navigated,
    session: {
      navigate: async (url: string): Promise<void> => {
        navigated.push(url);
      },
    },
  };
}

/** delay fake（确定性轮询——记每次间隔） */
function fakeDelay() {
  const waits: number[] = [];
  return { waits, delay: async (ms: number): Promise<void> => void waits.push(ms) };
}

/** CDP evaluate 成功响应形（returnByValue 结果包在 result.value） */
const evalOk = (value: unknown): unknown => ({ result: { value } });
const evalExc = { exceptionDetails: { text: 'boom' } };

function makeOps(
  script: (call: SendCall, i: number) => unknown,
): { ops: CdpOps; calls: SendCall[]; navigated: string[]; waits: number[] } {
  const { calls, transport } = fakeTransport(script);
  const { navigated, session } = fakeSession();
  const { waits, delay } = fakeDelay();
  return { ops: createCdpOps({ transport, session, delay }), calls, navigated, waits };
}

describe('cdp.open（坑①先导航＋坑④ enable＋readyState 轮询兜底）', () => {
  it('序=navigate→Page.enable→readyState 轮询——任何 CDP 帧发出时刻导航已完成（坑①）', async () => {
    const { ops, calls, navigated } = makeOps((call) => {
      // 坑①序断言：帧发出时 navigate 必已发生
      expect(navigated).toEqual(['https://a.b']);
      return call.method === 'Runtime.evaluate' ? evalOk('complete') : {};
    });
    const r = await ops.open({ url: 'https://a.b' });
    expect(r).toEqual({ url: 'https://a.b', readyState: 'complete' });
    expect(calls.map((c) => c.method)).toEqual(['Page.enable', 'Runtime.evaluate']);
    expect(calls[1]?.params).toMatchObject({ expression: 'document.readyState', returnByValue: true });
  });

  it('readyState=loading→间隔后重轮询至 complete（坑④兜底；waitMs 缺省预算内）', async () => {
    let evalCount = 0;
    const { ops, calls, waits } = makeOps((call) => {
      if (call.method === 'Runtime.evaluate') {
        evalCount += 1;
        return evalOk(evalCount === 1 ? 'loading' : 'complete');
      }
      return {};
    });
    const r = await ops.open({ url: 'https://a.b' });
    expect(r.readyState).toBe('complete');
    expect(calls.filter((c) => c.method === 'Runtime.evaluate')).toHaveLength(2);
    expect(waits).toEqual([100]);
  });

  it('waitMs=0→单次取现值不重试不等待（0 值=不武装口径）', async () => {
    const { ops, calls, waits } = makeOps((call) =>
      call.method === 'Runtime.evaluate' ? evalOk('loading') : {},
    );
    const r = await ops.open({ url: 'https://a.b', waitMs: 0 });
    expect(r).toEqual({ url: 'https://a.b', readyState: 'loading' });
    expect(calls.filter((c) => c.method === 'Runtime.evaluate')).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('预算内未达 complete→返回最后值不失败（兜底语义，不武装失败路径）', async () => {
    const { ops, calls, waits } = makeOps((call) =>
      call.method === 'Runtime.evaluate' ? evalOk('loading') : {},
    );
    const r = await ops.open({ url: 'https://a.b', waitMs: 250 });
    expect(r.readyState).toBe('loading');
    expect(calls.filter((c) => c.method === 'Runtime.evaluate')).toHaveLength(3); // t=0/100/200ms
    expect(waits).toEqual([100, 100]); // 剩 50ms 不足再等一轮即止
  });
});

describe('坑①规格面序断言：未导航发命令被拒（§6.2b 集成段的 renderer 规格面）', () => {
  it('未 open 先 extract→NotNavigatedError 且一帧未发', async () => {
    const { ops, calls } = makeOps(() => evalOk('[]'));
    const err: unknown = await ops.extract({ selector: '.price' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NotNavigatedError);
    expect(calls).toEqual([]);
  });

  it('未 open 先 click→同拒（open 是 extract/click 的前置）', async () => {
    const { ops, calls } = makeOps(() => evalOk('{}'));
    await expect(ops.click({ selector: '#go' })).rejects.toBeInstanceOf(NotNavigatedError);
    expect(calls).toEqual([]);
  });
});

describe('cdp.extract 双路径（S-3 判据 3）', () => {
  async function openedOps(script: (call: SendCall, i: number) => unknown) {
    const made = makeOps(script);
    await made.ops.open({ url: 'https://a.b', waitMs: 0 });
    made.calls.length = 0; // open 自身帧不计入操作断言
    return made;
  }

  it('主路径=Runtime.evaluate returnByValue（selector/attr 入表达式）→values 数组', async () => {
    const { ops, calls } = await openedOps((call) =>
      call.method === 'Runtime.evaluate' ? evalOk(JSON.stringify(['¥29', '¥31'])) : {},
    );
    const r = await ops.extract({ selector: '.price', attr: 'data-v' });
    expect(r).toEqual({ values: ['¥29', '¥31'] });
    const frame = calls[0];
    expect(frame?.method).toBe('Runtime.evaluate');
    expect(frame?.params.returnByValue).toBe(true);
    expect(String(frame?.params.expression)).toContain('.price');
    expect(String(frame?.params.expression)).toContain('data-v');
  });

  it('attr 缺省=textContent（demo 表单占位同源）', async () => {
    const { ops, calls } = await openedOps((call) =>
      call.method === 'Runtime.evaluate' ? evalOk(JSON.stringify(['a'])) : {},
    );
    await ops.extract({ selector: '.p' });
    expect(String(calls[0]?.params.expression)).toContain('textContent');
  });

  it('主路径异常（exceptionDetails）→备选 DOM.getDocument→querySelector→getOuterHTML 三连（序断言）', async () => {
    const { ops, calls } = await openedOps((call) => {
      switch (call.method) {
        case 'Runtime.evaluate':
          return evalExc;
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: 7 };
        case 'DOM.getOuterHTML':
          return { outerHTML: '<span id="status">after-click-2</span>' };
        default:
          return {};
      }
    });
    const r = await ops.extract({ selector: '#status' });
    expect(r).toEqual({ values: ['<span id="status">after-click-2</span>'] });
    expect(calls.map((c) => c.method)).toEqual([
      'Runtime.evaluate',
      'DOM.getDocument',
      'DOM.querySelector',
      'DOM.getOuterHTML',
    ]);
    expect(calls[1]?.params).toEqual({ depth: -1 });
    expect(calls[2]?.params).toEqual({ nodeId: 1, selector: '#status' });
    expect(calls[3]?.params).toEqual({ nodeId: 7 });
  });

  it('主路径帧错误（transport reject BridgeCommandError）→同样落备选路径', async () => {
    const { ops, calls } = await openedOps((call, i) => {
      if (call.method === 'Runtime.evaluate' && i === 0) {
        throw new BridgeCommandError('CDP-COMMAND-FAILED', 'bridge down');
      }
      switch (call.method) {
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: 7 };
        case 'DOM.getOuterHTML':
          return { outerHTML: '<b>x</b>' };
        default:
          return {};
      }
    });
    const r = await ops.extract({ selector: 'b' });
    expect(r).toEqual({ values: ['<b>x</b>'] });
    expect(calls.map((c) => c.method)).toContain('DOM.getOuterHTML');
  });

  it('备选 querySelector 未命中（nodeId=0）→空结果不失败', async () => {
    const { ops } = await openedOps((call) => {
      switch (call.method) {
        case 'Runtime.evaluate':
          return evalExc;
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: 0 };
        default:
          return {};
      }
    });
    await expect(ops.extract({ selector: '.none' })).resolves.toEqual({ values: [] });
  });
});

describe('cdp.click 两击（S-3 判据 3：中心 pressed＋released）', () => {
  async function clickOps(script: (call: SendCall, i: number) => unknown) {
    const made = makeOps(script);
    await made.ops.open({ url: 'https://a.b', waitMs: 0 });
    made.calls.length = 0;
    return made;
  }

  it('先取 getBoundingClientRect 中心，再 mousePressed(buttons:1)＋mouseReleased(buttons:0) 两帧（spike 参数逐字段）', async () => {
    const { ops, calls } = await clickOps((call) =>
      call.method === 'Runtime.evaluate' ? evalOk(JSON.stringify({ x: 150, y: 40 })) : {},
    );
    const r = await ops.click({ selector: '#submit' });
    expect(r).toEqual({ x: 150, y: 40 });
    expect(calls.map((c) => c.method)).toEqual([
      'Runtime.evaluate',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    const expr = String(calls[0]?.params.expression);
    expect(expr).toContain('#submit');
    expect(expr).toContain('getBoundingClientRect');
    expect(calls[1]?.params).toEqual({
      type: 'mousePressed',
      x: 150,
      y: 40,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    expect(calls[2]?.params).toEqual({
      type: 'mouseReleased',
      x: 150,
      y: 40,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  });
});
