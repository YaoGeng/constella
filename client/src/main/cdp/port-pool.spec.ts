// CdpPortPool（main 物理执行面）单测（T4-18 / TDD-C-M1 §3 PortPool 行）。
//
// 与 renderer 规格件（renderer/cdp/port-pool.ts，T4-05）语义同步、接口形差异=T4-05 评审冻结的
// main 侧同步形：acquire(): number（耗尽 throw CdpChannelError〔Error+string code——IpcGateway
// serializeError 识别序 ②〕）＋markBusy（创建前探活/绑定冲突跳号记账）＋warmUp（启动序预热，
// C-M1 §3 生命周期「CdpSessionManager.init（PortPool 预热）」）。
// 断言面：递增分配/回收复用最小归还口/探活跳号/耗尽=CDP-PORT-EXHAUSTED＋lane 收敛提示（N7）/
// 物理探活（真 net bind 试探——本套件 node 直跑真 socket）。
import net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { CdpChannelError } from './errors';
import { CDP_PORT_RANGE_MAIN, CdpPortPool, probePortOccupied } from './port-pool';

/** 持住一批 127.0.0.1 端口的真实 net server（物理探活判据用） */
const holders: net.Server[] = [];
async function occupy(port: number): Promise<void> {
  const srv = net.createServer();
  holders.push(srv);
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', resolve);
  });
}
afterAll(async () => {
  await Promise.all(holders.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('CdpPortPool 同步 acquire（T4-05 评审：main 侧同步形）', () => {
  it('缺省池从 9221 起递增：9221→9222→9223（renderer 规格件同语义）', () => {
    const pool = new CdpPortPool();
    expect(pool.acquire()).toBe(9221);
    expect(pool.acquire()).toBe(9222);
    expect(pool.acquire()).toBe(9223);
  });

  it('回收口优先复用（最小归还口），池尽后回到递增段（destroyRun 还池→新 lane 复用）', () => {
    const pool = new CdpPortPool();
    pool.acquire(); // 9221
    pool.acquire(); // 9222（待回收）
    pool.acquire(); // 9223
    pool.release(9222);
    expect(pool.acquire()).toBe(9222); // 复用归还口
    expect(pool.acquire()).toBe(9224); // 续递增
  });

  it('release 未分配口为无操作（重复归还不双记）', () => {
    const pool = new CdpPortPool();
    pool.release(9221); // 从未 acquire
    expect(pool.acquire()).toBe(9221);
    pool.release(9221);
    pool.release(9221); // 重复归还
    expect(pool.acquire()).toBe(9221);
    expect(pool.acquire()).toBe(9222); // 9221 只还了一次
  });
});

describe('创建前探活冲突跳号（02 §15.2 N7；markBusy=warmUp/绑定冲突记账面）', () => {
  it('markBusy 口跳过：9221 标记占用→首配 9222；标记口恒不入分配', () => {
    const pool = new CdpPortPool();
    pool.markBusy(9221);
    expect(pool.acquire()).toBe(9222);
    pool.release(9222);
    expect(pool.acquire()).toBe(9222); // 回收口优先复用（recycled 先于段扫描）
    expect(pool.acquire()).toBe(9223); // 递增段跳过 9221（busy 恒不入分配）
  });

  it('warmUp 以注入探活全段扫描，占用口全记账（C-M1 §3 生命周期「PortPool 预热」）', async () => {
    const busy = new Set([9221, 9222, 9224]);
    const pool = new CdpPortPool(CDP_PORT_RANGE_MAIN, async (port) => busy.has(port));
    await pool.warmUp();
    expect(pool.acquire()).toBe(9223); // 段内零散占用全跳过
  });
});

describe('TDD-C-M1 §6.2d 耗尽=CDP-PORT-EXHAUSTED＋lane 收敛提示（N7）', () => {
  it('注入小池 2 口全部分配后→acquire throw CdpChannelError（code 手锚字面量）', () => {
    const pool = new CdpPortPool({ first: 9300, last: 9301 });
    expect(pool.acquire()).toBe(9300);
    expect(pool.acquire()).toBe(9301);
    const err: unknown = (() => {
      try {
        return pool.acquire();
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(CdpChannelError);
    if (err instanceof CdpChannelError) {
      expect(err.code).toBe('CDP-PORT-EXHAUSTED');
      expect(err.message).toContain('lane');
      expect(err.message).toContain('9300'); // detail 含段范围（定位用）
    }
  });

  it('探活全占用（跳号遍历整段无空闲）→同样耗尽', async () => {
    const pool = new CdpPortPool({ first: 9300, last: 9301 }, async () => true);
    await pool.warmUp();
    expect(() => pool.acquire()).toThrow(CdpChannelError);
    expect(() => pool.acquire()).toThrow(/CDP-PORT-EXHAUSTED|耗尽/);
  });

  it('归还口与游标段同时耗尽才报错（回收口仍可用时不耗尽）', () => {
    const pool = new CdpPortPool({ first: 9300, last: 9300 });
    expect(pool.acquire()).toBe(9300);
    pool.release(9300);
    expect(pool.acquire()).toBe(9300); // 回收口复用，不耗尽
  });
});

describe('物理探活 probePortOccupied（net bind 试探——缺省探活源）', () => {
  // 探活判据用 lane 池段（9221–9320）外端口——并行 head-run 套件的 electron 真绑该段
  it('被真实占用→true；空闲→false', async () => {
    await occupy(9527);
    expect(await probePortOccupied(9527)).toBe(true);
    expect(await probePortOccupied(9528)).toBe(false);
  });

  it('warmUp＋物理探活真链：外部占用口在预热后不入分配', async () => {
    await occupy(9530);
    const pool = new CdpPortPool({ first: 9530, last: 9532 }, probePortOccupied);
    await pool.warmUp();
    expect(pool.acquire()).toBe(9531);
  });
});
