// CronParser 规格（T4-19 / TDD-C-M1 §6.3a——fake timers 口径之外的纯函数面；
// 五段式=分 时 日 月 周〔X-18〕，支持 `* , - /步进`，DOM/DOW 均非 `*` 按 POSIX OR）。
import { describe, expect, it } from 'vitest';
import { CronParser } from './cron-parser';

const parser = new CronParser();

/** 局部时间构造（五段式语义=本地墙钟） */
function at(y: number, m0: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m0, d, h, min, s);
}

describe('CronParser.parse/next §6.3a：0 20 * * * nextFire=当日/次日 20:00', () => {
  it('当日 14:00 → next=当日 20:00；次日 01:00 → next=次日 20:00', () => {
    const r = parser.parse('0 20 * * *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2026-11-09（周一）
    expect(parser.next(r.schedule, at(2026, 10, 9, 14, 0, 0))?.getTime()).toBe(
      at(2026, 10, 9, 20, 0, 0).getTime(),
    );
    // 已过 20:00 → 次日
    expect(parser.next(r.schedule, at(2026, 10, 9, 21, 0, 0))?.getTime()).toBe(
      at(2026, 10, 10, 20, 0, 0).getTime(),
    );
    // 恰在 20:00:00 整点 → 严格之后 → 次日（next 半开语义）
    expect(parser.next(r.schedule, at(2026, 10, 9, 20, 0, 0))?.getTime()).toBe(
      at(2026, 10, 10, 20, 0, 0).getTime(),
    );
  });
});

describe('CronParser */5 步进', () => {
  it('14:03 → 14:05；14:56 → 15:00（跨小时）；23:57 → 次日 00:00（跨日）', () => {
    const r = parser.parse('*/5 * * * *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 10, 9, 14, 3, 0))?.getTime()).toBe(
      at(2026, 10, 9, 14, 5, 0).getTime(),
    );
    expect(parser.next(r.schedule, at(2026, 10, 9, 14, 56, 0))?.getTime()).toBe(
      at(2026, 10, 9, 15, 0, 0).getTime(),
    );
    expect(parser.next(r.schedule, at(2026, 10, 9, 23, 57, 30))?.getTime()).toBe(
      at(2026, 10, 10, 0, 0, 0).getTime(),
    );
  });

  it('区间步进 0-30/10 → :00/:10/:20/:30；列表 9,17 双点；区间 9-11 三点', () => {
    const stepped = parser.parse('0-30/10 * * * *');
    expect(stepped.ok).toBe(true);
    if (stepped.ok) {
      expect(parser.next(stepped.schedule, at(2026, 10, 9, 14, 5, 0))?.getTime()).toBe(
        at(2026, 10, 9, 14, 10, 0).getTime(),
      );
      expect(parser.next(stepped.schedule, at(2026, 10, 9, 14, 30, 0))?.getTime()).toBe(
        at(2026, 10, 9, 15, 0, 0).getTime(),
      );
    }
    const listed = parser.parse('0 9,17 * * *');
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(parser.next(listed.schedule, at(2026, 10, 9, 10, 0, 0))?.getTime()).toBe(
        at(2026, 10, 9, 17, 0, 0).getTime(),
      );
      expect(parser.next(listed.schedule, at(2026, 10, 9, 18, 0, 0))?.getTime()).toBe(
        at(2026, 10, 10, 9, 0, 0).getTime(),
      );
    }
    const ranged = parser.parse('0 9-11 * * *');
    expect(ranged.ok).toBe(true);
    if (ranged.ok) {
      expect(parser.next(ranged.schedule, at(2026, 10, 9, 9, 30, 0))?.getTime()).toBe(
        at(2026, 10, 9, 10, 0, 0).getTime(),
      );
      expect(parser.next(ranged.schedule, at(2026, 10, 9, 11, 0, 0))?.getTime()).toBe(
        at(2026, 10, 10, 9, 0, 0).getTime(),
      );
    }
  });

  it('月字段 0 0 1 3 * → 次年 3 月 1 日', () => {
    const r = parser.parse('0 0 1 3 *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 10, 9, 0, 0, 0))?.getTime()).toBe(
      at(2027, 2, 1, 0, 0, 0).getTime(),
    );
  });
});

describe('CronParser 非法形 → CRON-INVALID-EXPR', () => {
  it.each([
    '61 * * * *', // 分越界（§6.3a 验收锚）
    '0 24 * * *', // 时越界
    '0 0 0 * *', // 日 0
    '0 0 32 * *', // 日越界
    '0 0 * 0 *', // 月 0
    '0 0 * 13 *', // 月越界
    '0 0 * * 8', // 周 8
    '*/0 * * * *', // 步进 0
    '5-2 * * * *', // 倒序区间
    '1,,2 * * * *', // 空列表元素
    'a * * * *', // 非数字
    '* * * *', // 4 段
    '* * * * * *', // 6 段
    '', // 空
    '   ', // 空白
  ])('parse(%j) → ok:false + code=CRON-INVALID-EXPR', (expr) => {
    const r = parser.parse(expr);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('CRON-INVALID-EXPR');
    expect(r.error.message.length).toBeGreaterThan(0);
  });
});

describe('CronParser DOM/DOW 语义（POSIX OR——子集本卡冻结）', () => {
  // 2026-12-13=周日；2026-12-14=周一；2026-12-15=周二
  it('均非 *：0 12 13 * 0 → 13 日（周日）与后续周日都命中（OR 含 DOW 支）', () => {
    const r = parser.parse('0 12 13 * 0');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 12/14（周一）之后：13 日已过 → 下一个周日 12/20 命中（日≠13，纯 DOW 支）
    expect(parser.next(r.schedule, at(2026, 11, 14, 0, 0, 0))?.getTime()).toBe(
      at(2026, 11, 20, 12, 0, 0).getTime(),
    );
    // 12/10（周四）之后：12/13（周日=13 日，双支命中）先到
    expect(parser.next(r.schedule, at(2026, 11, 10, 0, 0, 0))?.getTime()).toBe(
      at(2026, 11, 13, 12, 0, 0).getTime(),
    );
  });

  it('日受限、周为 *：0 12 13 * * → 13 日过完跨月至次年 1 月 13 日（AND 化=DOW 放行）', () => {
    const r = parser.parse('0 12 13 * *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 11, 14, 0, 0, 0))?.getTime()).toBe(
      at(2027, 0, 13, 12, 0, 0).getTime(),
    );
  });

  it('*/2 视为受限（仅字面 * 免限）：0 12 */2 * 1 从 12/14 周一晚 → 次日 12/15（奇数日 OR 支）', () => {
    const r = parser.parse('0 12 */2 * 1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 若按 Vixie DOM_STAR（*/2 记作非限）则只有周一命中 → 12/21；POSIX OR 读法 → 12/15（15∈{1,3,…,31}）
    expect(parser.next(r.schedule, at(2026, 11, 14, 20, 0, 0))?.getTime()).toBe(
      at(2026, 11, 15, 12, 0, 0).getTime(),
    );
  });
});

describe('CronParser 边界形', () => {
  it('周 7 归一为周日：0 12 * * 7 ≡ 0 12 * * 0', () => {
    const r = parser.parse('0 12 * * 7');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2026-12-12 周六之后 → 周日 12/13
    expect(parser.next(r.schedule, at(2026, 11, 12, 0, 0, 0))?.getTime()).toBe(
      at(2026, 11, 13, 12, 0, 0).getTime(),
    );
  });

  it('不可达日（2 月 30 日）→ next 返回 null', () => {
    const r = parser.parse('0 0 30 2 *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 0, 1, 0, 0, 0))).toBeNull();
  });

  it('2 月 29 日跨闰年：0 0 29 2 * 从 2026 → 2028-02-29', () => {
    const r = parser.parse('0 0 29 2 *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 0, 1, 0, 0, 0))?.getTime()).toBe(
      at(2028, 1, 29, 0, 0, 0).getTime(),
    );
  });

  it('多空白分隔容忍（五段切分按 \\s+）', () => {
    const r = parser.parse('  0    20  *  *  *  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parser.next(r.schedule, at(2026, 10, 9, 14, 0, 0))?.getTime()).toBe(
      at(2026, 10, 9, 20, 0, 0).getTime(),
    );
  });
});
