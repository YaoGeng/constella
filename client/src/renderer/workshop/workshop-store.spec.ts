// workshopStore 套件（T5-02；02 §3.3 workshopStore 行：对话流、计划卡草稿挂点、rail 状态字
// ——01 A-10.1 待命/思考中/规划中/并行 N 任务；内存 store 不持久化〔无 persist 中间件、
// 不入历史栈〕）。转交流程工坊（handoffToFlowWorkshop）断言面在 intent-router.spec.ts
// （intent-flow 前缀——§6.1 末项归属意图路由）。
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkshopStore } from './workshop-store';
import type { PlanCard } from './flow-planner';

const card: PlanCard = {
  id: 'plan-9',
  flowName: '私信触达',
  steps: [
    { src: 'lib', type: 'trigger.manual', name: '手动触发', params: {} },
    { src: 'new', type: 'xhs.dm.send', name: '私信发送', params: { minIntervalSec: 60 } },
  ],
};

describe('planner-workshopStore（02 §3.3——对话流/计划卡挂点/rail 状态字；不持久化）', () => {
  beforeEach(() => {
    useWorkshopStore.getState().reset();
  });

  it('workshopStore-对话流：user/assistant 消息按序追加（id 唯一）', () => {
    const s = useWorkshopStore.getState();
    const u = s.pushMessage('user', '开发一个抓库存的节点');
    const a = s.pushMessage('assistant', '好的，草稿如下 —');
    const list = useWorkshopStore.getState().messages;
    expect(list.map((m) => [m.role, m.text])).toEqual([
      ['user', '开发一个抓库存的节点'],
      ['assistant', '好的，草稿如下 —'],
    ]);
    expect(new Set(list.map((m) => m.id)).size).toBe(2);
    expect(u.role).toBe('user');
    expect(a.role).toBe('assistant');
  });

  it('workshopStore-计划卡挂点：card.kind=plan 挂 assistant 消息（确认闸产物停卡片——A-10.2）', () => {
    useWorkshopStore.getState().pushMessage('assistant', '计划已出——请确认后一键生成', {
      kind: 'plan',
      plan: card,
    });
    const msg = useWorkshopStore.getState().messages.find((m) => m.card?.kind === 'plan');
    expect(msg?.card).toEqual({ kind: 'plan', plan: card });
  });

  it('workshopStore-rail 状态字四态（01 A-10.1：待命/思考中/规划中/并行 N 任务）', () => {
    const s = useWorkshopStore.getState();
    s.setRailActivity('thinking');
    expect(useWorkshopStore.getState().rail.activity).toBe('thinking');
    s.setRailActivity('planning');
    expect(useWorkshopStore.getState().rail.activity).toBe('planning');
    s.setRailActivity('parallel', 3);
    expect(useWorkshopStore.getState().rail).toEqual({ tab: 'node', activity: 'parallel', parallelCount: 3 });
    s.setRailActivity('idle');
    expect(useWorkshopStore.getState().rail.activity).toBe('idle');
  });

  it('workshopStore-双 tab 互斥数据源：node↔flow 切换（A-10.1）＋需求预填', () => {
    const s = useWorkshopStore.getState();
    s.switchRail('flow');
    expect(useWorkshopStore.getState().rail.tab).toBe('flow');
    s.setFlowRequest('小红书爆款监控+私信');
    expect(useWorkshopStore.getState().flowRequest).toBe('小红书爆款监控+私信');
    s.switchRail('node');
    expect(useWorkshopStore.getState().rail.tab).toBe('node');
  });

  it('workshopStore-reset 测试隔离（内存态全清——不持久化的行为面）', () => {
    const s = useWorkshopStore.getState();
    s.pushMessage('user', 'x');
    s.switchRail('flow');
    s.setRailActivity('thinking');
    useWorkshopStore.getState().reset();
    const after = useWorkshopStore.getState();
    expect(after.messages).toEqual([]);
    expect(after.rail).toEqual({ tab: 'node', activity: 'idle', parallelCount: 0 });
    expect(after.flowRequest).toBe('');
  });
});
