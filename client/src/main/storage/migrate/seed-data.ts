// 种子数据（T1-03；02 §13.2；demo L1246-1255/L3102-3107 语义源）。
//
// 口径（P1 波）：12 内置定义（type 集 ≡ shared BUILTIN_TYPE_IDS——运行时 import 对账）＋
// 9 种子流程 f1~f9（A-15.1 示例资产与验收剧本）＋ 节点库初始 3 项。
// ⚠② ExamplePreloader 随 P5（C-08）：示例 9 定义不经种子——open() 挂点在迁移后、种子前预装；
//   本波 definitions=12 过基线（=21 全量断言随 P5 C-08 接线补跑）。
// 种子不经 C-02 校验（momus 观察2，03 §7.4#2）——数据质量由 §6.1d＋check-builtin-seed 守护。
import { BUILTIN_TYPE_IDS, type BuiltinTypeId } from '@constella/shared/constants';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { FlowEdge, FlowNode, LibraryEntry } from '@constella/shared/ipc';

interface DefSpec {
  meta: NodeDefinition['meta'];
  ports: NodeDefinition['ports'];
  paramsSchema: NodeDefinition['paramsSchema'];
}

/** Record 键集由 BUILTIN_TYPE_IDS 派生（编译期穷尽：缺一个 type 即 TS 错误） */
const BUILTIN_DEF_SPECS: Record<BuiltinTypeId, DefSpec> = {
  'trigger.manual': {
    meta: { name: '手动触发', icon: '▶️', category: '触发', description: '点击运行按钮手动启动流程' },
    ports: { ins: [], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [],
  },
  'trigger.cron': {
    meta: { name: '定时触发', icon: '⏰', category: '触发', description: '按 cron 表达式周期启动流程' },
    ports: { ins: [], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'cron', label: 'cron 表达式', t: 'text', required: true, ph: '0 9 * * *', mono: true },
    ],
  },
  'cdp.open': {
    meta: { name: '打开页面', icon: '🌐', category: 'CDP', description: '在 lane 会话中打开目标网址' },
    ports: { ins: ['in'], outs: [{ id: 'ok', label: '成功' }] },
    paramsSchema: [{ k: 'url', label: '网址', t: 'text', required: true }],
  },
  'cdp.extract': {
    meta: { name: '提取内容', icon: '🔎', category: 'CDP', description: '按选择器提取页面内容' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'selector', label: '选择器', t: 'text', required: true, mono: true },
      { k: 'attr', label: '属性（可选）', t: 'text' },
    ],
  },
  'cdp.click': {
    meta: { name: '点击元素', icon: '🖱️', category: 'CDP', description: '按选择器点击页面元素' },
    ports: { ins: ['in'], outs: [{ id: 'ok', label: '成功' }] },
    paramsSchema: [{ k: 'selector', label: '选择器', t: 'text', required: true, mono: true }],
  },
  'http.request': {
    meta: { name: 'HTTP 请求', icon: '📡', category: '网络', description: '发起 HTTP 请求取回数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'url', label: 'URL', t: 'text', required: true },
      { k: 'method', label: '方法', t: 'select', opts: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
    ],
  },
  'ai.llm': {
    meta: { name: 'AI 处理', icon: '✨', category: 'AI', description: '调用大模型处理上游输入' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'prompt', label: '提示词', t: 'textarea', required: true },
      { k: 'temperature', label: '温度', t: 'slider', min: 0, max: 2, step: 0.1, default: 0.7 },
    ],
  },
  'data.transform': {
    meta: { name: '数据加工', icon: '🧮', category: '数据', description: '表达式/模板加工上游数据' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [{ k: 'expr', label: '表达式', t: 'textarea', required: true, mono: true }],
  },
  'logic.branch': {
    meta: { name: '条件分支', icon: '🔀', category: '逻辑', description: '按条件走 true/false 出口' },
    ports: { ins: ['in'], outs: [{ id: 'true', label: '真' }, { id: 'false', label: '假' }] },
    paramsSchema: [{ k: 'expr', label: '条件表达式', t: 'text', required: true, mono: true }],
  },
  delay: {
    meta: { name: '延时等待', icon: '⏳', category: '逻辑', description: '等待指定毫秒后继续' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [{ k: 'ms', label: '毫秒', t: 'number', default: 1000, min: 0 }],
  },
  'file.write': {
    meta: { name: '写入文件', icon: '💾', category: '数据', description: '把上游数据写入沙箱工作目录文件' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
    paramsSchema: [
      { k: 'path', label: '相对路径', t: 'text', required: true, mono: true },
      { k: 'content', label: '内容', t: 'textarea' },
    ],
  },
  'human.review': {
    meta: { name: '人工确认', icon: '🙋', category: '交互', description: '断点等待人工选择后继续（A-7）' },
    ports: { ins: ['in'], outs: [{ id: 'approve', label: '通过' }, { id: 'reject', label: '驳回' }] },
    paramsSchema: [
      { k: 'question', label: '问题', t: 'textarea', required: true },
      { k: 'options', label: '选项', t: 'json', ph: '["通过","驳回"]' },
    ],
  },
};

/** 内置 12 类定义（N1~N8 全维度落地；exec=null=平台内置实现非脚本节点；type 集 ≡ BUILTIN_TYPE_IDS） */
export const BUILTIN_DEFINITIONS: readonly NodeDefinition[] = BUILTIN_TYPE_IDS.map((type) => {
  const spec = BUILTIN_DEF_SPECS[type];
  if (spec === undefined) {
    throw new Error(`BUILTIN_TYPE_IDS 与种子定义集不齐：缺 ${type}——两处必须同步维护`);
  }
  return {
    type,
    kind: 'builtin' as const,
    meta: spec.meta,
    ports: spec.ports,
    paramsSchema: spec.paramsSchema,
    exec: null,
    inner: null,
    policy: null,
    io: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
});

/** 种子流程节点构造简写 */
function n(
  flowId: string,
  idx: number,
  type: string,
  name: string,
  params: Record<string, unknown> = {},
): FlowNode {
  return { id: `${flowId}-n${idx}`, type, name, position: { x: 120 * idx, y: 80 }, params };
}

/** 边构造简写（from/to=端口元组 [nodeId, portId]） */
function e(flowId: string, fromNodeIdx: number, toNodeIdx: number, fromPort = 'out', toPort = 'in'): FlowEdge {
  return {
    id: `${flowId}-e${fromNodeIdx}-${toNodeIdx}`,
    from: [`${flowId}-n${fromNodeIdx}`, fromPort],
    to: [`${flowId}-n${toNodeIdx}`, toPort],
  };
}

export interface SeedFlow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 9 条种子流程（f1~f9；覆盖 12 内置类型的常见组合，验收剧本载体） */
export const SEED_FLOWS: readonly SeedFlow[] = [
  {
    id: 'f1',
    name: '示例·手动数据加工',
    nodes: [n('f1', 1, 'trigger.manual', '开始'), n('f1', 2, 'data.transform', '加工', { expr: '$input' })],
    edges: [e('f1', 1, 2, 'out', 'in')],
  },
  {
    id: 'f2',
    name: '示例·定时取数',
    nodes: [
      n('f2', 1, 'trigger.cron', '每天九点', { cron: '0 9 * * *' }),
      n('f2', 2, 'http.request', '取接口', { url: 'https://example.com/api', method: 'GET' }),
    ],
    edges: [e('f2', 1, 2, 'out', 'in')],
  },
  {
    id: 'f3',
    name: '示例·AI 文案',
    nodes: [
      n('f3', 1, 'trigger.manual', '开始'),
      n('f3', 2, 'ai.llm', '生成', { prompt: '润色上游文本', temperature: 0.7 }),
    ],
    edges: [e('f3', 1, 2, 'out', 'in')],
  },
  {
    id: 'f4',
    name: '示例·页面信息提取',
    nodes: [
      n('f4', 1, 'cdp.open', '打开', { url: 'https://example.com' }),
      n('f4', 2, 'cdp.extract', '提取', { selector: 'h1', attr: 'textContent' }),
    ],
    edges: [e('f4', 1, 2, 'ok', 'in')],
  },
  {
    id: 'f5',
    name: '示例·分支路由',
    nodes: [
      n('f5', 1, 'cdp.extract', '提取', { selector: '.price' }),
      n('f5', 2, 'logic.branch', '阈值分支', { expr: '$input > 100' }),
    ],
    edges: [e('f5', 1, 2, 'out', 'in')],
  },
  {
    id: 'f6',
    name: '示例·延时落盘',
    nodes: [
      n('f6', 1, 'trigger.manual', '开始'),
      n('f6', 2, 'delay', '等一秒', { ms: 1000 }),
      n('f6', 3, 'file.write', '写文件', { path: 'out/result.txt' }),
    ],
    edges: [e('f6', 1, 2, 'out', 'in'), e('f6', 2, 3, 'out', 'in')],
  },
  {
    id: 'f7',
    name: '示例·人工审核',
    nodes: [
      n('f7', 1, 'trigger.manual', '开始'),
      n('f7', 2, 'human.review', '审核', { question: '结果可用吗？', options: ['通过', '驳回'] }),
    ],
    edges: [e('f7', 1, 2, 'out', 'in')],
  },
  {
    id: 'f8',
    name: '示例·自动点击',
    nodes: [
      n('f8', 1, 'cdp.extract', '找按钮', { selector: 'button.next' }),
      n('f8', 2, 'cdp.click', '点击', { selector: 'button.next' }),
    ],
    edges: [e('f8', 1, 2, 'out', 'in')],
  },
  {
    id: 'f9',
    name: '示例·AI 汇总输出',
    nodes: [
      n('f9', 1, 'trigger.cron', '整点', { cron: '0 * * * *' }),
      n('f9', 2, 'ai.llm', '汇总', { prompt: '汇总上游数据' }),
      n('f9', 3, 'data.transform', '格式化', { expr: 'JSON.stringify($input)' }),
    ],
    edges: [e('f9', 1, 2, 'out', 'in'), e('f9', 2, 3, 'out', 'in')],
  },
];

/** 节点库初始 3 项（01 A-11；type 均为已种内置类型——FK 依赖就位） */
export const SEED_LIBRARY: readonly LibraryEntry[] = [
  {
    id: 'lib-seed-1',
    name: '小红书搜索',
    type: 'cdp.extract',
    params: { selector: '.note-item', attr: 'textContent' },
    scriptMeta: { lang: 'python', file: 'scripts/xhs_search.py' },
    updatedAt: 0,
  },
  {
    id: 'lib-seed-2',
    name: '接口拉取模板',
    type: 'http.request',
    params: { method: 'GET' },
    scriptMeta: { lang: 'ts', file: 'scripts/fetch_api.ts' },
    updatedAt: 0,
  },
  {
    id: 'lib-seed-3',
    name: '文本清洗',
    type: 'data.transform',
    params: { expr: '$input.trim()' },
    scriptMeta: { lang: 'python', file: 'scripts/clean_text.py' },
    updatedAt: 0,
  },
];
