// ConnectValidator 三查逐条（T3-04；C-01 §6.1a；01 A-3.4）。
import { describe, expect, it } from 'vitest';
import { validateConnection, violationMessage, type ConnectionContext } from './connect-validator';

const ctxFactory = (overrides?: Partial<ConnectionContext>): ConnectionContext => ({
  targetHasInput: true,
  edges: [],
  ...overrides,
});

describe('validateConnection（检查序 self → no-input → duplicate，demo L1520-1533）', () => {
  it('ok：合法连线', () => {
    expect(
      validateConnection({ nodeId: 'a', portId: 'out' }, { nodeId: 'b', portId: 'in' }, ctxFactory()),
    ).toBe('ok');
  });

  it('self：同节点自连（先于其他检查）', () => {
    expect(
      validateConnection({ nodeId: 'a', portId: 'out' }, { nodeId: 'a', portId: 'in' }, ctxFactory()),
    ).toBe('self');
    // 即使目标无入口且重复边存在，自连优先报
    expect(
      validateConnection(
        { nodeId: 'a', portId: 'out' },
        { nodeId: 'a', portId: 'in' },
        ctxFactory({ targetHasInput: false, edges: [{ from: ['a', 'out'], to: ['a', 'in'] }] }),
      ),
    ).toBe('self');
  });

  it('no-input：目标 ins=[] 触发节点无入口', () => {
    expect(
      validateConnection({ nodeId: 'a', portId: 'out' }, { nodeId: 't', portId: 'in' }, ctxFactory({ targetHasInput: false })),
    ).toBe('no-input');
  });

  it('duplicate：同 from 节点＋同 from 出口 → 同目标即重复（demo L1528 不比 to 端口）', () => {
    const edges = [{ from: ['a', 'out'] as const, to: ['b', 'in'] as const }];
    expect(
      validateConnection({ nodeId: 'a', portId: 'out' }, { nodeId: 'b', portId: 'in' }, ctxFactory({ edges })),
    ).toBe('duplicate');
    // 不同 from 出口 → 同目标：不重复（branch true/false 双出口到同节点合法）
    expect(
      validateConnection({ nodeId: 'a', portId: 'false' }, { nodeId: 'b', portId: 'in' }, ctxFactory({ edges })),
    ).toBe('ok');
    // 不同来源节点 → 同目标：不重复
    expect(
      validateConnection({ nodeId: 'c', portId: 'out' }, { nodeId: 'b', portId: 'in' }, ctxFactory({ edges })),
    ).toBe('ok');
  });

  it('三违例 toast 文案逐字（demo L1524/L1526/L1528）', () => {
    expect(violationMessage('self', 'X')).toBe('不能连接自己');
    expect(violationMessage('no-input', '手动触发')).toBe('「手动触发」是触发节点，没有输入口');
    expect(violationMessage('duplicate', 'X')).toBe('这条连线已存在');
  });
});
