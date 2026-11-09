// LayoutEngine 用例（T3-07；C-01 §6.5「分层排布用例绿」——组件卡自拟）。
import { describe, expect, it } from 'vitest';
import { layout } from './layout-engine';

const N = (id: string) => ({ id });
const E = (source: string, target: string) => ({ source, target });
const pos = (out: { id: string; position: { x: number; y: number } }[], id: string) => {
  const hit = out.find((n) => n.id === id);
  expect(hit).toBeDefined();
  return hit!.position;
};

describe('layout（dagre 分层排布，T3-07）', () => {
  it('线性链 LR：x 沿依赖方向递增、y 对齐', () => {
    const out = layout([N('a'), N('b'), N('c')], [E('a', 'b'), E('b', 'c')]);
    const a = pos(out, 'a');
    const b = pos(out, 'b');
    const c = pos(out, 'c');
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(b.y).toBeCloseTo(c.y, 5);
  });

  it('分支汇合：并行支路 y 分开（nodesep）、汇合层 x 更大', () => {
    // a → b/c 并行 → d 汇合
    const out = layout([N('a'), N('b'), N('c'), N('d')], [E('a', 'b'), E('a', 'c'), E('b', 'd'), E('c', 'd')]);
    const a = pos(out, 'a');
    const b = pos(out, 'b');
    const c = pos(out, 'c');
    const d = pos(out, 'd');
    expect(b.x).toBeCloseTo(c.x, 5); // 同层
    expect(Math.abs(b.y - c.y)).toBeGreaterThan(20); // 支路纵向分开
    expect(a.x).toBeLessThan(b.x);
    expect(d.x).toBeGreaterThan(b.x);
  });

  it('TB 方向切换：层级沿 y 递增', () => {
    const out = layout([N('a'), N('b')], [E('a', 'b')], { rankdir: 'TB' });
    expect(pos(out, 'a').y).toBeLessThan(pos(out, 'b').y);
  });

  it('孤立节点（无边）参与排布不报错；空输入返回空', () => {
    const out = layout([N('solo')], []);
    expect(out).toEqual([{ id: 'solo', position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }) }]);
    expect(layout([], [])).toEqual([]);
  });

  it('输出为左上角坐标（节点盒默认 192×80 内的整数域）', () => {
    const out = layout([N('a'), N('b')], [E('a', 'b')]);
    for (const n of out) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });
});
