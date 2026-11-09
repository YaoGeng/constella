// IoContractKit 验收（T4-09；C-02 §6.1d＋§3 IoContractKit 行；X-5 per-exit 分列/B-13 未声明
// 回退 `out → {data}` 契约文案/PlanValidator⑤ 复用位 checkIoCompat）。
//
// node 直跑（§6「校验器/ParamValidator/IoContractKit node 直跑」）。§1 只冻结签名
// （ioView(io,outs)/checkIoCompat(up,exitId,down)），返回形自拟——以 B-13（02 §11 B-13 行：
// 按 N7 声明展示、多出口按出口分列、未声明回退契约文案）＋X-5（02 §8.1「未声明的出口回退
// 单 output」）为锚，留痕于 io-contract-kit.ts。
// 验收源：MA-4 三出口 replied/escalated/skipped 各自输出 schema（01a §2.c N7 行逐字段）。
import { describe, expect, it } from 'vitest';
import type { IoContract } from '@constella/shared/dsl';
import { checkIoCompat, ioView } from './io-contract-kit';

/** MA-4 三出口（01a §2.c N2 行：out×3 replied/escalated/skipped） */
const MA4_OUTS = [
  { id: 'replied', label: '已回复' },
  { id: 'escalated', label: '升级人工' },
  { id: 'skipped', label: '主动拒答' },
];

/** MA-4 N7 per-exit 三出口声明（01a §2.c N7 行逐字段：replied→{handled}/escalated→{pending}/skipped→{skipped}） */
const MA4_IO: IoContract = {
  outputs: {
    replied: { fields: [{ name: 'handled', type: 'object[]', example: '[{convId,kind,text}]' }] },
    escalated: { fields: [{ name: 'pending', type: 'object[]', example: '[{convId,reason}]' }] },
    skipped: { fields: [{ name: 'skipped', type: 'object[]', example: '[{convId,intent}]' }] },
  },
};

describe('ioView：per-exit 分列（X-5，§6.1d）', () => {
  it('MA-4 三出口声明 → 三出口分列，各列字段目录=各自 per-exit fields', () => {
    const view = ioView(MA4_IO, MA4_OUTS);
    expect(view.exits).toHaveLength(3);
    expect(view.exits.map((e) => e.exitId)).toEqual(['replied', 'escalated', 'skipped']);
    expect(view.exits.map((e) => e.label)).toEqual(['已回复', '升级人工', '主动拒答']);
    expect(view.exits[0]?.fields).toEqual([
      { name: 'handled', type: 'object[]', example: '[{convId,kind,text}]' },
    ]);
    expect(view.exits[1]?.fields.map((f) => f.name)).toEqual(['pending']);
    expect(view.exits[2]?.fields.map((f) => f.name)).toEqual(['skipped']);
    expect(view.exits.every((e) => e.source === 'outputs')).toBe(true);
    expect(view.exits.every((e) => e.contractText === undefined)).toBe(true);
  });

  it('未声明出口回退单 output（X-5：outputs 缺该出口键 → output 承接）', () => {
    const io: IoContract = {
      output: { fields: [{ name: 'notes', type: 'object[]' }] },
      outputs: { replied: { fields: [{ name: 'handled', type: 'object[]' }] } },
    };
    const view = ioView(io, MA4_OUTS);
    expect(view.exits[0]?.source).toBe('outputs');
    expect(view.exits[1]?.source).toBe('output');
    expect(view.exits[1]?.fields.map((f) => f.name)).toEqual(['notes']);
  });
});

describe('ioView：未声明回退契约文案（B-13，§6.1d）', () => {
  it('未声明节点（io 缺省）单出口 out → 契约文案 `out → {data}`', () => {
    const view = ioView(undefined, [{ id: 'out', label: '输出' }]);
    expect(view.exits).toHaveLength(1);
    expect(view.exits[0]?.source).toBe('fallback');
    expect(view.exits[0]?.fields).toEqual([]);
    expect(view.exits[0]?.contractText).toBe('out → {data}');
  });

  it('多出口节点未声明出口逐出口兜底（skipped → {data}）', () => {
    const view = ioView(
      { outputs: { replied: { fields: [{ name: 'handled', type: 'object[]' }] } } },
      MA4_OUTS,
    );
    expect(view.exits[1]?.contractText).toBe('escalated → {data}');
    expect(view.exits[2]?.contractText).toBe('skipped → {data}');
  });

  it('输入侧：声明展示字段目录，未声明回退「in ← 上游 data」（demo L2064 形态正式化）', () => {
    const declared = ioView({ input: { fields: [{ name: 'keywords', type: 'string[]' }] } }, [
      { id: 'out', label: 'out' },
    ]);
    expect(declared.input.fields.map((f) => f.name)).toEqual(['keywords']);
    expect(declared.input.contractText).toBeUndefined();

    const fallback = ioView(undefined, [{ id: 'out', label: 'out' }]);
    expect(fallback.input.fields).toEqual([]);
    expect(fallback.input.contractText).toBe('in ← 上游 data');
  });
});

describe('checkIoCompat：上下游兼容核对（N7 用途③；供 PlanValidator⑤ 复用）', () => {
  const DOWN: IoContract = { input: { fields: [{ name: 'handled', type: 'object[]' }] } };

  it('下游引用字段在上游 per-exit outputs 可寻 → 0 issue', () => {
    expect(checkIoCompat(MA4_IO, 'replied', DOWN)).toEqual([]);
  });

  it('下游引用字段在上游单 output 可寻（X-5 回退出口） → 0 issue', () => {
    const up: IoContract = { output: { fields: [{ name: 'handled', type: 'object[]' }] } };
    expect(checkIoCompat(up, 'replied', DOWN)).toEqual([]);
  });

  it('上游出口声明不含下游字段 → issue 定位 field＋exitId', () => {
    const issues = checkIoCompat(MA4_IO, 'escalated', DOWN);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('handled');
    expect(issues[0]?.exitId).toBe('escalated');
    expect(issues[0]?.message).toContain('handled');
    expect(issues[0]?.message).toContain('escalated');
  });

  it('上游未声明输出契约（兜底 {data}）→ 下游具名声明字段不可寻，逐字段报 issue', () => {
    const down: IoContract = {
      input: { fields: [{ name: 'notes', type: 'object[]' }, { name: 'total', type: 'number' }] },
    };
    const issues = checkIoCompat(undefined, 'out', down);
    expect(issues.map((i) => i.field)).toEqual(['notes', 'total']);
    expect(issues.every((i) => i.message.includes('out'))).toBe(true);
  });

  it('下游未声明 input → 无核对面，0 issue', () => {
    expect(checkIoCompat(MA4_IO, 'replied', {})).toEqual([]);
    expect(checkIoCompat(MA4_IO, 'replied', { input: { fields: [] } })).toEqual([]);
  });
});
