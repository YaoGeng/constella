// PlanValidator 六查套件（T5-04；TDD-C-07 §6.3；02 §9.1 六查冻结序权威）。
// 断言面：
//   ①结构连通——触发节点 BFS 可达全部、无孤儿＋edge 索引越界拦截（T5-02 转交项）；
//   ②参数 schema——C-02 validateParams 逐字段（required/min-max，错误定位步骤）；
//   ③触发节点——恰 ≥1 个 ins=[] 步骤；
//   ④端口匹配——from 出口 ∈ 上游 N2 outs / to 端口 ∈ 下游 ins（缺省线性边同查）；
//   ⑤IO 契约——C-02 checkIoCompat：下游引用字段在上游出口交付目录可寻；
//   ⑥强节点脚本齐备——noScript 计划卡阶段预拦截警告（X-10 第⑥查）。
//   失败逐条列出（不全有全无）＋冻结序 ①→⑥；✨new 未注册步骤跳过定义面四查（自检归 T5-03）；
//   合法计划通过。
// C-05 get／C-02 ②⑤／⑥资产预检＝注入位（P-3 单测 stub；②⑤缺省绑 definition/ 真源）。
import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PlanCard, PlanStep } from './flow-planner';
import { createPlanValidator, type PlanIssue } from './plan-validator';

// ————————————————————————————————————————————
// fixture（注册表 stub：C-05 get 注入位）
// ————————————————————————————————————————————

const def = (over: Partial<NodeDefinition> & { type: string }): NodeDefinition => ({
  kind: 'custom',
  meta: { name: over.type, icon: '🔧', category: '测试' },
  ports: { ins: ['in'], outs: [{ id: 'out', label: '出口' }] },
  paramsSchema: [],
  exec: null,
  version: '1.0.0',
  packageVersion: '1.0.0',
  ...over,
});

/** 触发节点（ins=[]——③查判定输入；交付 title/url 两字段） */
const TRIGGER = def({
  type: 'trigger.manual',
  meta: { name: '手动触发', icon: '⚡', category: '触发' },
  ports: { ins: [], outs: [{ id: 'out', label: '出口' }] },
  io: { output: { fields: [{ name: 'title', type: 'string' }, { name: 'url', type: 'string' }] } },
});

/** 出口非 'out' 的触发节点（缺省线性边端口错配用） */
const TRIGGER_GO = def({
  type: 'trigger.go',
  meta: { name: 'Go 触发', icon: '⚡', category: '触发' },
  ports: { ins: [], outs: [{ id: 'go', label: '出发' }] },
});

/** 多出口强节点（hit/miss/unknown 三出口——MA-1 ai-judge 形；rule 必填） */
const JUDGE = def({
  type: 'ai.judge',
  meta: { name: 'AI 判定', icon: '🧠', category: 'AI' },
  ports: { ins: ['in'], outs: [{ id: 'hit', label: '命中' }, { id: 'miss', label: '未中' }, { id: 'unknown', label: '未知' }] },
  paramsSchema: [
    { k: 'rule', t: 'textarea', label: '判定规则', required: true },
    { k: 'noteLimit', t: 'number', label: '条数', validate: { min: 1, max: 200 } },
  ],
  io: { input: { fields: [{ name: 'title', type: 'string' }] }, output: { fields: [{ name: 'score', type: 'number' }] } },
  exec: { lang: 'ts', file: 'scripts/ai-judge.ts', entry: 'run' },
});

/** 下游库节点（io.input 引用 url——⑤查用） */
const VAULT = def({
  type: 'data.vault',
  meta: { name: '数据仓', icon: '🗄️', category: '数据' },
  io: { input: { fields: [{ name: 'url', type: 'string' }] } },
});

/** 通知弱节点（exec=null——⑥查不适用） */
const NOTIFY = def({ type: 'http.notify', meta: { name: '通知', icon: '📨', category: '网络' } });

/** 通知强节点（exec 声明脚本——⑥查对象） */
const NOTIFY_STRONG = def({
  type: 'http.notify.strong',
  meta: { name: '通知强节点', icon: '📨', category: '网络' },
  exec: { lang: 'python', file: 'scripts/notify.py', entry: 'run' },
});

const step = (type: string, over: Partial<PlanStep> = {}): PlanStep => ({
  src: 'lib',
  type,
  name: type,
  params: {},
  ...over,
});

const plan = (steps: PlanStep[], edges?: [number, string, number, string][]): PlanCard => ({
  id: 'plan-test',
  flowName: '测试流程',
  steps,
  ...(edges !== undefined ? { edges } : {}),
});

const registryOf = (...defs: NodeDefinition[]) => {
  const map = new Map(defs.map((d) => [d.type, d]));
  return (type: string) => map.get(type);
};

// ————————————————————————————————————————————
// §6.3 六查逐条（五种坏计划＋①结构/合法通过）
// ————————————————————————————————————————————

describe('plan-validator 六查冻结序（TDD-C-07 §6.3——02 §9.1 权威）', () => {
  it('plan-validator-合法计划通过（显式分支路由 edges 全合法 → 零 issue）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER, JUDGE, NOTIFY) });
    const issues = v.validate(
      plan(
        [step('trigger.manual'), step('ai.judge', { params: { rule: '爆款规则', noteLimit: 50 } }), step('http.notify')],
        [
          [0, 'out', 1, 'in'],
          [1, 'hit', 2, 'in'],
        ],
      ),
    );
    expect(issues).toEqual([]);
  });

  it('plan-validator-①结构连通：显式 edges 下不可达步骤＝孤儿，逐条报出（stepIndex 定位）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER, VAULT) });
    const issues = v.validate(
      plan([step('trigger.manual'), step('data.vault'), step('data.vault')], [[0, 'out', 1, 'in']]),
    );
    expect(issues.every((i) => i.check === 'structure')).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.stepIndex).toBe(2); // 孤儿定位＝不可达步骤
    expect(issues[0]!.message).toContain('data.vault');
  });

  it('plan-validator-①越界索引拦截（T5-02 转交：edges 形状合法但索引越步骤界）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER) });
    const issues = v.validate(plan([step('trigger.manual')], [[0, 'out', 9, 'in']]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.check).toBe('structure');
    expect(issues[0]!.message).toContain('9');
  });

  it('plan-validator-②参数 schema：required 缺值与 max 超限逐字段报出（C-02 validateParams）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER, JUDGE) });
    const issues = v.validate(
      plan([step('trigger.manual'), step('ai.judge', { params: { rule: '   ', noteLimit: 999 } })], [[0, 'out', 1, 'in']]),
    );
    const paramIssues = issues.filter((i) => i.check === 'params');
    expect(paramIssues.map((i) => i.message)).toEqual([
      '步骤 1「ai.judge」：「判定规则」为必填项', // 空白串=缺失（required）＋步骤定位前缀
      '步骤 1「ai.judge」：「条数」超出上限 200', // max 超限
    ]);
    expect(paramIssues.every((i) => i.stepIndex === 1)).toBe(true); // 错误定位步骤
  });

  it('plan-validator-③触发节点：全部步骤 ins 非空 → 报「无触发节点」', () => {
    const v = createPlanValidator({ getDefinition: registryOf(JUDGE, VAULT) });
    const issues = v.validate(plan([step('ai.judge', { params: { rule: 'r' } }), step('data.vault')]));
    expect(issues.filter((i) => i.check === 'trigger')).toHaveLength(1);
    expect(issues.filter((i) => i.check === 'trigger')[0]!.message).toContain('触发');
  });

  it('plan-validator-④端口匹配：出口∉上游 outs／端口∉下游 ins 各逐条报（含缺省线性边同查）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(JUDGE, VAULT) });
    // 显式边：出口 'out' 不在 JUDGE outs（hit/miss/unknown）；端口 'nope' 不在 VAULT ins（in）
    const issues = v.validate(
      plan([step('ai.judge', { params: { rule: 'r' } }), step('data.vault')], [[0, 'out', 1, 'nope']]),
    );
    const portIssues = issues.filter((i) => i.check === 'ports');
    expect(portIssues).toHaveLength(2);
    expect(portIssues[0]!.message).toContain('out'); // from 出口报
    expect(portIssues[1]!.message).toContain('nope'); // to 端口报
  });

  it('plan-validator-④缺省线性串联同查：上游 outs 无 out 出口时缺省边报端口错配', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER_GO, JUDGE) });
    // 无显式 edges → 缺省 [0,'out',1,'in']；TRIGGER_GO 出口=go，无 'out'
    const issues = v.validate(plan([step('trigger.go'), step('ai.judge', { params: { rule: 'r' } })]));
    expect(issues.filter((i) => i.check === 'ports')).toHaveLength(1);
  });

  it('plan-validator-⑤IO 契约：下游引用字段不在上游出口输出声明 → 逐字段报（C-02 checkIoCompat）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER, JUDGE, VAULT) });
    // JUDGE hit 出口交付 {score}；VAULT 引用 {url} → url 不可寻
    const issues = v.validate(
      plan(
        [step('trigger.manual'), step('ai.judge', { params: { rule: 'r' } }), step('data.vault')],
        [
          [0, 'out', 1, 'in'],
          [1, 'hit', 2, 'in'],
        ],
      ),
    );
    const ioIssues = issues.filter((i) => i.check === 'io');
    expect(ioIssues).toHaveLength(1);
    expect(ioIssues[0]!.message).toContain('url');
    expect(ioIssues[0]!.stepIndex).toBe(2); // 定位下游
  });

  it('plan-validator-⑥noScript：强节点脚本资产缺失＝计划卡阶段预拦截警告（X-10）', () => {
    const v = createPlanValidator({
      getDefinition: registryOf(TRIGGER, NOTIFY, NOTIFY_STRONG),
      hasScriptAssets: (type) => type !== 'http.notify.strong', // 仅强通知缺资产
    });
    const issues = v.validate(
      plan([step('trigger.manual'), step('http.notify'), step('http.notify.strong')]),
    );
    const noScriptIssues = issues.filter((i) => i.check === 'noScript');
    expect(noScriptIssues).toHaveLength(1);
    expect(noScriptIssues[0]!.stepIndex).toBe(2);
    expect(noScriptIssues[0]!.message).toContain('http.notify.strong');
  });

  it('plan-validator-⑥弱节点（exec=null）不适用；资产预检未注入=信任在场（缺省）', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER, NOTIFY, NOTIFY_STRONG) });
    const issues = v.validate(plan([step('trigger.manual'), step('http.notify'), step('http.notify.strong')]));
    expect(issues.filter((i) => i.check === 'noScript')).toEqual([]); // 弱节点不查＋强节点缺省信任
  });

  it('plan-validator-失败逐条列出（不全有全无）＋冻结序 ①→⑥', () => {
    const v = createPlanValidator({
      getDefinition: registryOf(TRIGGER, JUDGE, VAULT, NOTIFY_STRONG),
      hasScriptAssets: () => false,
    });
    // 一份多查全坏计划（触发在场——①BFS 前提）：s3 孤儿（①）＋rule 缺值（②）＋坏出口（④）
    // ＋url 不可寻（⑤）＋s3 强节点缺脚本（⑥）；③另测（无触发与①互斥——③为根因时不级联①）
    const issues: PlanIssue[] = v.validate(
      plan(
        [step('trigger.manual'), step('ai.judge', { params: { rule: '' } }), step('data.vault'), step('http.notify.strong')],
        [
          [0, 'out', 1, 'in'],
          [0, 'badexit', 1, 'in'],
          [1, 'hit', 2, 'in'],
        ],
      ),
    );
    expect([...new Set(issues.map((i) => i.check))]).toEqual([
      'structure', // ① s3 孤儿
      'params', // ② rule 必填
      'ports', // ④ badexit ∉ outs
      'io', // ⑤ url 不在 hit 交付目录
      'noScript', // ⑥ s3 脚本缺失
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(5); // 逐条不吞并（同查多例不合并）

    // ③序位（②后④前）：无触发计划不级联①、②照列——[params, trigger, ports, io]
    // （缺省线性边 [0,'out',1,'in']：judge 无 out 出口→④；vault url 不可寻→⑤）
    const noTrigger = createPlanValidator({ getDefinition: registryOf(JUDGE, VAULT) }).validate(
      plan([step('ai.judge', { params: { rule: '' } }), step('data.vault')]),
    );
    expect([...new Set(noTrigger.map((i) => i.check))]).toEqual(['params', 'trigger', 'ports', 'io']);
  });

  it('plan-validator-✨new 未注册步骤：跳过定义面四查（②④⑤⑥——自检归 T5-03 定义级校验），拓扑照查', () => {
    const v = createPlanValidator({ getDefinition: registryOf(TRIGGER) });
    // ghost.node 未注册：默认线性边 [0,'out',1,'in'] 的 ④⑤ 与 ②⑥ 对 s1 跳过
    const issues = v.validate(plan([step('trigger.manual'), step('ghost.node', { src: 'new', params: { any: 1 } })]));
    expect(issues).toEqual([]);
  });

  it('plan-validator-全未注册计划：无法确认触发节点 → ③报（不静默放行）', () => {
    const v = createPlanValidator({ getDefinition: registryOf() });
    const issues = v.validate(plan([step('ghost.a', { src: 'new' })]));
    expect(issues.map((i) => i.check)).toEqual(['trigger']);
  });

  it('plan-validator-C-02 注入位：stub ②⑤ 替换真源（装配 seam 存在性）', () => {
    const v = createPlanValidator({
      getDefinition: registryOf(TRIGGER, JUDGE, VAULT),
      validateParams: () => [{ field: 'x', message: 'stub-params', rule: 'required' }],
      checkIoCompat: () => [{ field: 'y', exitId: 'hit', message: 'stub-io' }],
    });
    const issues = v.validate(
      plan([step('trigger.manual'), step('ai.judge', { params: { rule: 'r' } }), step('data.vault')]),
    );
    expect(issues.some((i) => i.check === 'params' && i.message.includes('stub-params'))).toBe(true);
    expect(issues.some((i) => i.check === 'io' && i.message.includes('stub-io'))).toBe(true);
  });
});
