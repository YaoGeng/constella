// T6-18 种子流程构架 spec（demo L1080-1226 构架事实源逐流对齐＋全流可运行性；01 §9/D-8 剧本前提）。
//
// 断言面（main 域投影断言——种子不经 C-02 validateDefinition〔momus 观察2，03 §7.4#2〕，
// 流程级数据质量由本 spec 守护；定义级=C-02 spec＋check-builtin-seed）：
//   1. 逐流构架：节点数/节点类型集合/边全集（端口元组级）对 demo 行锚逐流断言；
//   2. 类型全集核对：每节点 type ∈ BUILTIN 12 ∪ EXAMPLE_TYPES 10（demo 构架所引类型逐一
//      核对——xhs.comment.post 由 T6-18 PM 裁决补为第 10 枚示例资产）；
//   3. 可运行性（RunGate=renderer/run/run-gate.ts 查序的等价投影）：③ 每流 ≥1 触发节点
//      （def ports.ins=[]）＋ ④ 全部类型有定义（isBroken 面零命中）＋ ⑤ custom 定义
//      exec≠null 且节点无 noScript（强节点缺脚本拦截面零命中）；
//   4. 参数投影：paramsSchema required 键齐备＋PRD §9 锚关键参数抽查（branch 表达式/
//      cron/频控参数/断点选项）＋边端口全部落在定义 ports 内。
//
// demo→正式版 DSL 映射登记（T6-18 预研表采纳，PM 2026-11-11）：
//   - 端口映射：cdp.open/cdp.click demo 出口 'out'（demo L872/L876）→ 正式版 'ok'（builtin 规格）；
//     human.review demo 出口 'out'（demo L890）→ 正式版 'approve'（延续语义=确认后继续；
//     demo f3「跳过」原始数据直接下发同走该出口；'reject' 出口在种子构架无落点）。
//   - 参数丢弃（demo 有、正式版 schema 无——取正式版 DSL 键）：trigger.manual note、
//     cdp.open wait、ai.llm model（模型路由=V1.1 TDD-C-18 域）；human.review options
//     多行文本 → json 数组（键同名，值形转正式版）。
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import { BUILTIN_DEFINITIONS, SEED_FLOWS } from './seed-data';
import { EXAMPLE_ASSETS } from '../../zip/example-assets';

/** 正式版定义全集索引（BUILTIN 12 ∪ EXAMPLE 10——种子可引用类型宇宙） */
const DEF_INDEX: ReadonlyMap<string, NodeDefinition> = new Map(
  [...BUILTIN_DEFINITIONS, ...EXAMPLE_ASSETS.map((a) => a.definition)].map((d) => [d.type, d] as const),
);

interface EdgeExpect {
  /** demo 节点 id（种子 id=f<flow>-<demoId>） */
  from: string;
  /** 出口端口（正式版 DSL 键） */
  fp: string;
  to: string;
}

interface FlowExpect {
  id: string;
  name: string;
  anchor: string;
  /** demoId → type（节点全集） */
  nodes: Readonly<Record<string, string>>;
  edges: readonly EdgeExpect[];
}

/** F1~F9 构架期望（节点/边逐流=demo L1085-1220；出口端口已按映射登记转正式版键） */
const FLOW_EXPECT: readonly FlowExpect[] = [
  {
    id: 'f1',
    name: '商品价格监控',
    anchor: 'demo L1085-1100（F1：branch 双路，true→ai.llm→file.write / false→http.request）',
    nodes: {
      a1: 'trigger.manual', a2: 'cdp.open', a3: 'cdp.extract', a4: 'logic.branch',
      a5: 'ai.llm', a6: 'file.write', a7: 'http.request',
    },
    edges: [
      { from: 'a1', fp: 'out', to: 'a2' },
      { from: 'a2', fp: 'ok', to: 'a3' }, // demo 'out'→'ok'（cdp.open 端口映射）
      { from: 'a3', fp: 'out', to: 'a4' },
      { from: 'a4', fp: 'true', to: 'a5' },
      { from: 'a4', fp: 'false', to: 'a7' },
      { from: 'a5', fp: 'out', to: 'a6' },
    ],
  },
  {
    id: 'f2',
    name: '每日数据备份',
    anchor: 'demo L1101-1108（F2：cron 0 9 * * *）',
    nodes: { b1: 'trigger.cron', b2: 'data.transform', b3: 'file.write' },
    edges: [
      { from: 'b1', fp: 'out', to: 'b2' },
      { from: 'b2', fp: 'out', to: 'b3' },
    ],
  },
  {
    id: 'f3',
    name: 'JD 岗位筛选',
    anchor: 'demo L1109-1123（F3：human.review 断点 5 选项剧本构架）',
    nodes: {
      j1: 'trigger.manual', j2: 'cdp.extract', j3: 'human.review', j4: 'ai.llm', j5: 'file.write',
    },
    edges: [
      { from: 'j1', fp: 'out', to: 'j2' },
      { from: 'j2', fp: 'out', to: 'j3' },
      { from: 'j3', fp: 'approve', to: 'j4' }, // demo 'out'→'approve'（human.review 端口映射）
      { from: 'j4', fp: 'out', to: 'j5' },
    ],
  },
  {
    id: 'f4',
    name: '多城市社保上传',
    anchor: 'demo L1124-1147（F4：三 lane 汇合构架，11 节点 11 边）',
    nodes: {
      t1: 'trigger.manual', d1: 'data.transform',
      c1: 'cdp.open', c2: 'cdp.click', s1: 'cdp.open', s2: 'cdp.click', g1: 'cdp.open', g2: 'cdp.click',
      j1: 'ai.llm', n1: 'http.request',
    },
    edges: [
      { from: 't1', fp: 'out', to: 'd1' },
      { from: 'd1', fp: 'out', to: 'c1' },
      { from: 'd1', fp: 'out', to: 's1' },
      { from: 'd1', fp: 'out', to: 'g1' },
      { from: 'c1', fp: 'ok', to: 'c2' }, // demo 'out'→'ok'
      { from: 's1', fp: 'ok', to: 's2' },
      { from: 'g1', fp: 'ok', to: 'g2' },
      { from: 'c2', fp: 'ok', to: 'j1' }, // demo 'out'→'ok'（cdp.click）
      { from: 's2', fp: 'ok', to: 'j1' },
      { from: 'g2', fp: 'ok', to: 'j1' },
      { from: 'j1', fp: 'out', to: 'n1' },
    ],
  },
  {
    id: 'f5',
    name: '小红书·爆款采集判定',
    anchor: 'demo L1150-1167（F5=MA-1：gate.login ok 出口＋ai.classify hit 出口）',
    nodes: {
      t1: 'trigger.manual', g1: 'gate.login', s1: 'xhs.search', d1: 'xhs.detail',
      v1: 'data.vault', c1: 'ai.classify', v2: 'data.vault', n1: 'http.request',
    },
    edges: [
      { from: 't1', fp: 'out', to: 'g1' },
      { from: 'g1', fp: 'ok', to: 's1' }, // blocked 出口=demo 构架未连线（blocked 挂起语义）
      { from: 's1', fp: 'out', to: 'd1' },
      { from: 'd1', fp: 'out', to: 'v1' },
      { from: 'v1', fp: 'out', to: 'c1' },
      { from: 'c1', fp: 'hit', to: 'v2' }, // miss 出口=demo 构架未连线（死路径级联 ⊘）
      { from: 'v2', fp: 'out', to: 'n1' },
    ],
  },
  {
    id: 'f6',
    name: '小红书·私信触达',
    anchor: 'demo L1168-1184（F6=MA-2：vault 读名单→human.review→copygen→dm.send）',
    nodes: {
      t1: 'trigger.manual', v1: 'data.vault', h1: 'human.review', cp1: 'ai.copygen',
      dm1: 'xhs.dm.send', n1: 'http.request',
    },
    edges: [
      { from: 't1', fp: 'out', to: 'v1' },
      { from: 'v1', fp: 'out', to: 'h1' },
      { from: 'h1', fp: 'approve', to: 'cp1' }, // demo 'out'→'approve'
      { from: 'cp1', fp: 'out', to: 'dm1' },
      { from: 'dm1', fp: 'out', to: 'n1' },
    ],
  },
  {
    id: 'f7',
    name: '小红书·智能评论',
    anchor: 'demo L1185-1197（F7=MA-3：xhs.comment.post 载体=T6-18 PM 裁决第 10 枚示例资产）',
    nodes: {
      t1: 'trigger.manual', v1: 'data.vault', cp1: 'ai.copygen', cm1: 'xhs.comment.post', v2: 'data.vault',
    },
    edges: [
      { from: 't1', fp: 'out', to: 'v1' },
      { from: 'v1', fp: 'out', to: 'cp1' },
      { from: 'cp1', fp: 'out', to: 'cm1' },
      { from: 'cm1', fp: 'out', to: 'v2' },
    ],
  },
  {
    id: 'f8',
    name: '小红书·即时回复值守',
    anchor: 'demo L1198-1209（F8=MA-4：auto-reply replied/escalated 双出）',
    nodes: { t1: 'trigger.manual', a1: 'xhs.auto-reply', v1: 'data.vault', h1: 'human.review' },
    edges: [
      { from: 't1', fp: 'out', to: 'a1' },
      { from: 'a1', fp: 'replied', to: 'v1' },
      { from: 'a1', fp: 'escalated', to: 'h1' },
    ],
  },
  {
    id: 'f9',
    name: '小红书·账号健康日报',
    anchor: 'demo L1210-1220（F9=MA-5：cron 0 20 * * *）',
    nodes: { c1: 'trigger.cron', v1: 'data.vault', l1: 'ai.llm', n1: 'http.request' },
    edges: [
      { from: 'c1', fp: 'out', to: 'v1' },
      { from: 'v1', fp: 'out', to: 'l1' },
      { from: 'l1', fp: 'out', to: 'n1' },
    ],
  },
];

describe('T6-18 种子流程构架（demo L1080-1226 逐流对齐）', () => {
  it('九流序与名称=demo（f1~f9；flowOrder 同源 L1222）', () => {
    expect(SEED_FLOWS.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']);
    expect(SEED_FLOWS.map((f) => f.name)).toEqual(FLOW_EXPECT.map((e) => e.name));
  });

  it.each(FLOW_EXPECT)('$id「$name」节点/边全集对齐（$anchor）', (exp) => {
    const flow = SEED_FLOWS.find((f) => f.id === exp.id);
    expect(flow, `种子缺 ${exp.id}`).toBeDefined();
    // 节点：demoId 后缀命名（全局唯一前提）＋类型逐点对齐
    expect(flow!.nodes).toHaveLength(Object.keys(exp.nodes).length);
    for (const [demoId, type] of Object.entries(exp.nodes)) {
      const node = flow!.nodes.find((n) => n.id === `${exp.id}-${demoId}`);
      expect(node, `缺节点 ${exp.id}-${demoId}`).toBeDefined();
      expect(node!.type, `${exp.id}-${demoId} 类型`).toBe(type);
    }
    // 边：端口元组级全集相等（to 恒 'in'——正式版单入口约定）
    const actual = flow!.edges.map((e) => `${e.from[0]}|${e.from[1]}->${e.to[0]}|${e.to[1]}`).sort();
    const expected = exp.edges.map((e) => `${exp.id}-${e.from}|${e.fp}->${exp.id}-${e.to}|in`).sort();
    expect(actual).toEqual(expected);
    expect(flow!.edges).toHaveLength(exp.edges.length);
    // 边 id 全局唯一（edges 无表、id 语义键）
    expect(new Set(flow!.edges.map((e) => e.id)).size).toBe(flow!.edges.length);
  });

  it('节点 id 全局唯一（nodes 表 PK=f1~f9 跨流同名 demoId 命名空间隔离）', () => {
    const ids = SEED_FLOWS.flatMap((f) => f.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('f4 三 lane 布局：京/沪/穗三支 cdp.open y=demo 130/330/530（三 lane 汇合构架的画布可走查面）', () => {
    const f4 = SEED_FLOWS.find((f) => f.id === 'f4')!;
    const yOf = (demoId: string): number => f4.nodes.find((n) => n.id === `f4-${demoId}`)!.position.y;
    expect([yOf('c1'), yOf('s1'), yOf('g1')].sort((a, b) => a - b)).toEqual([130, 330, 530]);
    // 全节点位形良构（整数坐标）
    for (const n of SEED_FLOWS.flatMap((f) => f.nodes)) {
      expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `${n.id} position`).toBe(true);
    }
  });
});

describe('T6-18 全流可运行性（RunGate 查序等价投影）', () => {
  it('③ 每流 ≥1 触发节点（def ports.ins=[]——无 trigger 即被运行闸拒绝，T6-16 walk 阻断①根因）', () => {
    for (const flow of SEED_FLOWS) {
      const triggers = flow.nodes.filter((n) => (DEF_INDEX.get(n.type)?.ports.ins.length ?? 1) === 0);
      expect(triggers.length, `${flow.id} 触发节点`).toBeGreaterThanOrEqual(1);
      expect(
        triggers.map((t) => t.type).every((t) => t === 'trigger.manual' || t === 'trigger.cron'),
        `${flow.id} 触发类型`,
      ).toBe(true);
    }
  });

  it('④ 类型全集核对：每节点 type ∈ BUILTIN 12 ∪ EXAMPLE_TYPES 10（broken-def 拦截面零命中）', () => {
    for (const n of SEED_FLOWS.flatMap((f) => f.nodes)) {
      expect(DEF_INDEX.has(n.type), `${n.id} 类型 ${n.type} 无定义`).toBe(true);
    }
  });

  it('⑤ custom 定义 exec≠null 且节点无 noScript（强节点缺脚本拦截面零命中）', () => {
    for (const n of SEED_FLOWS.flatMap((f) => f.nodes)) {
      const def = DEF_INDEX.get(n.type)!;
      if (def.kind === 'custom') expect(def.exec, `${n.type} exec`).not.toBeNull();
      expect(n.noScript, `${n.id} noScript`).toBeUndefined();
    }
  });

  it('边端口投影：from 端口 ∈ 定义 outs、to 端口 ∈ 定义 ins', () => {
    for (const flow of SEED_FLOWS) {
      const byId = new Map(flow.nodes.map((n) => [n.id, n] as const));
      for (const e of flow.edges) {
        const fromDef = DEF_INDEX.get(byId.get(e.from[0])!.type)!;
        const toDef = DEF_INDEX.get(byId.get(e.to[0])!.type)!;
        expect(
          fromDef.ports.outs.map((o) => o.id),
          `${flow.id} ${e.id} 出口 ${e.from[1]}`,
        ).toContain(e.from[1]);
        expect(toDef.ports.ins, `${flow.id} ${e.id} 入口 ${e.to[1]}`).toContain(e.to[1]);
      }
    }
  });

  it('参数投影：paramsSchema required 键齐备（抽屉保存校验等价面）', () => {
    for (const n of SEED_FLOWS.flatMap((f) => f.nodes)) {
      const def = DEF_INDEX.get(n.type)!;
      for (const field of def.paramsSchema.filter((p) => p.required)) {
        expect(Object.hasOwn(n.params, field.k), `${n.id} 缺必填参数 ${field.k}`).toBe(true);
      }
    }
  });
});

describe('T6-18 关键参数抽查（PRD §9 剧本锚）', () => {
  const node = (flowId: string, demoId: string): Record<string, unknown> =>
    SEED_FLOWS.find((f) => f.id === flowId)!.nodes.find((n) => n.id === `${flowId}-${demoId}`)!.params;

  it('F1：branch 表达式 price < 199（demo L1089）', () => {
    expect(node('f1', 'a4')).toEqual({ expr: 'price < 199' });
  });

  it('F2/F9：cron 表达式 0 9 * * * / 0 20 * * *（demo L1102/L1211）', () => {
    expect(node('f2', 'b1')).toEqual({ cron: '0 9 * * *' });
    expect(node('f9', 'c1')).toEqual({ cron: '0 20 * * *' });
  });

  it('F3：断点 5 选项＋问题文案（demo L1112-1114；options 多行文本→json 数组映射）', () => {
    expect(node('f3', 'j3')).toEqual({
      question: 'JD 提取结果是否准确？勾选硬性筛选条件，可补充要求',
      options: ['年龄 ≤ 35 岁', '本科及以上', '3 年以上经验', '可接受出差', '英语流利'],
    });
  });

  it('F5：采集链参数（keywords 多行/maxNotes=40 number/sort 综合；demo L1152-1156）', () => {
    expect(node('f5', 's1')).toEqual({
      keywords: '装修避坑\n全屋定制\n旧房改造',
      maxNotes: 40,
      sort: '综合',
    });
    expect(node('f5', 'g1')).toEqual({ homeUrl: 'https://www.xiaohongshu.com', probe: '.login-btn' });
    expect(node('f5', 'c1')).toEqual({ rule: '与家居装修业务相关，且互动数据有爆款潜力', model: 'glm-5' });
  });

  it('F6：dm.send 频控 60/30/8（demo L1176）＋断点 4 选项（demo L1172-1173）', () => {
    expect(node('f6', 'dm1')).toEqual({ minInterval: 60, maxPerDay: 30, confirmWait: 8 });
    expect(node('f6', 'h1')).toEqual({
      question: '确认今日私信触达名单与话术要求（可勾选、可补充）',
      options: ['仅发送互动 top20', '话术用朋友口吻', '排除已触达过的', '附笔记标题引用'],
    });
  });

  it('F7：comment 频控 maxLen=50/ratePerMin=4（PRD §9 F7 行参数走查锚；demo L1190）', () => {
    expect(node('f7', 'cm1')).toEqual({ maxLen: 50, ratePerMin: 4 });
  });

  it('F8：auto-reply 角色/冷却/日限（demo L1200）＋人工接管 3 选项（demo L1203-1204）', () => {
    expect(node('f8', 'a1')).toEqual({ persona: '家居定制顾问小雅', cooldownMin: 3, dailyLimit: 50 });
    expect(node('f8', 'h1')).toEqual({
      question: '以下会话 AI 应对不了，请人工接管回复',
      options: ['需要人工回复', '疑似售后问题', '疑似骚扰，建议拉黑'],
    });
  });

  it('映射丢弃面：trigger.manual note / cdp.open wait / ai.llm model 不落正式版参数（取正式版 DSL 键）', () => {
    expect(node('f1', 'a1')).toEqual({});
    expect(node('f1', 'a2')).toEqual({ url: 'https://mall.example.com/p/128' }); // wait 丢弃
    expect(node('f1', 'a5')).toEqual({ prompt: '总结价格变动并给出购买建议，不超过 50 字' }); // model 丢弃
  });
});
