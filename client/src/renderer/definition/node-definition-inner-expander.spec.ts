// InnerExpander 验收（T4-09；C-02 §3 InnerExpander 行＋§1 innerView/expand 签名；02 §8.5 N5）。
//
// node 直跑（纯函数零框架依赖）。§1 只冻结签名（innerView(inner)/expand(inner)），返回形
// 未定义——本文件断言的自拟形（ExpandedInnerStep/InnerStepView）以 02 §8.5 执行语义
// （`[lane] ▸ 步骤N` 日志序）＋demo L2066 抽屉展示形态（`组合节点 · 内部 N 步`＋1 基编号列表）
// 为锚，留痕于 inner-expander.ts。
// 验收源：MA-4 inner 六步（02 §9.3 MA-4 行「inner 六步」①~⑥ 逐字）＋demo L933-934 四步原型。
import { describe, expect, it } from 'vitest';
import { expand, innerView } from './inner-expander';

/** 02 §9.3 MA-4 inner 六步（①~⑥ 逐字——xhs-auto-reply 组合节点，验收源） */
const MA4_INNER = [
  '取材 · 列表复放与新鲜度判据',
  '会话判向（末条非我方才算新来信+冷却窗+回声锚）',
  '意图识别与风险 skip',
  '四层装配生成（recentSent 反模板+句末截断 reply_chat 120 / reply_comment 80）',
  '发送 · 私信/评论两路',
  '登记回声缓存并路由三出口',
];

/** demo L933-934 xhs.auto-reply inner 四步（原型形态） */
const DEMO_INNER = [
  '会话判向 · 历史复放判新来信',
  '意图识别 · 咨询/售后/骚扰',
  '生成回复 · 角色卡 persona',
  '发送登记 · 回声写入会话缓存',
];

describe('expand(inner)：执行展开数据（步骤序列供 C-03 内联展开，02 §8.5）', () => {
  it('MA-4 六步 → 1 基序号步骤序列＋logPrefix=「▸ 步骤N」（T4-02 ExecDispatcher 同口径）', () => {
    expect(expand(MA4_INNER)).toEqual([
      { seq: 1, label: MA4_INNER[0], logPrefix: '▸ 步骤1' },
      { seq: 2, label: MA4_INNER[1], logPrefix: '▸ 步骤2' },
      { seq: 3, label: MA4_INNER[2], logPrefix: '▸ 步骤3' },
      { seq: 4, label: MA4_INNER[3], logPrefix: '▸ 步骤4' },
      { seq: 5, label: MA4_INNER[4], logPrefix: '▸ 步骤5' },
      { seq: 6, label: MA4_INNER[5], logPrefix: '▸ 步骤6' },
    ]);
  });

  it('执行侧拼接同构：expand 产物 `[lane] ${logPrefix} ${label}` = T4-02 现行日志行', () => {
    const steps = expand(DEMO_INNER);
    const lines = steps.map((s) => `[dm] ${s.logPrefix} ${s.label}`);
    expect(lines[0]).toBe(`[dm] ▸ 步骤1 ${DEMO_INNER[0]}`);
    expect(lines[3]).toBe(`[dm] ▸ 步骤4 ${DEMO_INNER[3]}`);
  });

  it('空/缺省 inner → 空序列（非组合节点零展开）', () => {
    expect(expand([])).toEqual([]);
  });
});

describe('innerView(inner)：N5 抽屉展示模型（demo L2066 形态）', () => {
  it('demo 四步原型 → 标题「组合节点 · 内部 4 步…」＋1 基编号步骤列表', () => {
    const view = innerView(DEMO_INNER);
    expect(view.total).toBe(4);
    expect(view.title).toBe('组合节点 · 内部 4 步（子流程封装，画布上是 1 个节点）');
    expect(view.steps.map((s) => `${s.seq}. ${s.label}`)).toEqual([
      `1. ${DEMO_INNER[0]}`,
      `2. ${DEMO_INNER[1]}`,
      `3. ${DEMO_INNER[2]}`,
      `4. ${DEMO_INNER[3]}`,
    ]);
  });

  it('MA-4 六步 → total=6＋步骤序连续', () => {
    const view = innerView(MA4_INNER);
    expect(view.total).toBe(6);
    expect(view.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('innerView 与 expand 步骤数据同源（steps ≡ expand(inner)）', () => {
    expect(innerView(MA4_INNER).steps).toEqual(expand(MA4_INNER));
  });
});
