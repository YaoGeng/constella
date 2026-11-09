// C-04 端口池规格单测（T4-05 验收＝TDD-C-04 §6.1c；02 §15.2 N7＋03 §1 生命周期表端口行）。
// 递增分配（demo L1748 cdpPortSeq=9221 语义）/创建前探活冲突跳号（N7 对策）/回收归还复用/
// 耗尽=CDP-PORT-EXHAUSTED 且 detail 含 lane 收敛提示（N7：≤10 并行 lane 内存指标）。
import { describe, expect, it } from 'vitest';
import { CDP_PORT_RANGE, createPortPool } from './port-pool';

describe('PortPool 递增分配（demo L1748 cdpPortSeq=9221）', () => {
  it('缺省池从 9221 起递增：9221→9222→9223（每 lane 一口）', async () => {
    const pool = createPortPool();
    expect(await pool.acquire()).toEqual({ ok: true, port: 9221 });
    expect(await pool.acquire()).toEqual({ ok: true, port: 9222 });
    expect(await pool.acquire()).toEqual({ ok: true, port: 9223 });
  });

  it('回收口优先复用（最小归还口），池尽后回到递增段（lane 收尾销毁→端口还池供新 lane）', async () => {
    const pool = createPortPool();
    await pool.acquire(); // 9221
    await pool.acquire(); // 9222（待回收）
    await pool.acquire(); // 9223
    pool.release(9222);
    expect(await pool.acquire()).toEqual({ ok: true, port: 9222 }); // 复用归还口
    expect(await pool.acquire()).toEqual({ ok: true, port: 9224 }); // 续递增
  });

  it('release 未分配口为无操作（不污染池——重复归还不得双记）', async () => {
    const pool = createPortPool();
    pool.release(9221); // 从未 acquire
    expect(await pool.acquire()).toEqual({ ok: true, port: 9221 });
    pool.release(9221);
    pool.release(9221); // 重复归还
    expect(await pool.acquire()).toEqual({ ok: true, port: 9221 });
    expect(await pool.acquire()).toEqual({ ok: true, port: 9222 }); // 9221 只还了一次
  });
});

describe('创建前探活冲突跳号（02 §15.2 N7）', () => {
  it('探活占用口跳过：9221 被外部占用→首配 9222', async () => {
    const pool = createPortPool(CDP_PORT_RANGE, async (port) => port === 9221);
    expect(await pool.acquire()).toEqual({ ok: true, port: 9222 });
  });

  it('段内零散占用全跳过，仅取首个空闲口', async () => {
    const busy = new Set([9221, 9222, 9224]);
    const pool = createPortPool(CDP_PORT_RANGE, async (port) => busy.has(port));
    expect(await pool.acquire()).toEqual({ ok: true, port: 9223 });
  });
});

describe('TDD-C-04 §6.1c 耗尽=CDP-PORT-EXHAUSTED＋lane 收敛提示（N7）', () => {
  it('注入小池 2 口全部分配后→耗尽错误（code 手锚字面量，不 mirror 常量）', async () => {
    const pool = createPortPool({ first: 9300, last: 9301 });
    expect(await pool.acquire()).toEqual({ ok: true, port: 9300 });
    expect(await pool.acquire()).toEqual({ ok: true, port: 9301 });
    const exhausted = await pool.acquire();
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) {
      expect(exhausted.error.code).toBe('CDP-PORT-EXHAUSTED');
      expect(exhausted.error.message).toContain('lane');
    }
  });

  it('探活全占用（跳号遍历整段无空闲）→同样耗尽', async () => {
    const pool = createPortPool({ first: 9300, last: 9301 }, async () => true);
    const exhausted = await pool.acquire();
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) {
      expect(exhausted.error.code).toBe('CDP-PORT-EXHAUSTED');
    }
  });
});
