// 种子数据（T1-03；02 §13.2；demo L1246-1255/L3102-3107 语义源；T6-18 种子流程重制）。
//
// 口径：12 内置定义（type 集 ≡ shared BUILTIN_TYPE_IDS——运行时 import 对账）＋
// 9 种子流程 f1~f9（A-15.1 示例资产与验收剧本）＋ 节点库初始 3 项。
// ⚠② ExamplePreloader（C-08）：示例定义不经种子——open() 挂点在迁移后、种子前预装
//   （F5~F9 的 xhs.*/gate.*/data.vault 等示例类型 FK 依赖由此就位；SeedsRunner 按类型
//   载体可用性渐进补种——bare 面（无预装挂点）只种 f1~f4 内置流）。
// 种子不经 C-02 校验（momus 观察2，03 §7.4#2）——数据质量由 §6.1d＋check-builtin-seed＋
// seed-flows.spec（T6-18 逐流构架/可运行性投影断言）守护。
//
// T6-18 重制（PM 裁决 2026-11-11）：f1~f9 按 demo L1080-1226 构架事实源逐流对齐
// （F1 branch 双路/F3 断点/F4 三 lane 汇合/F5~F9=MA-1~5；每流必有触发节点——T6-16 walk
// 上线级阻断①收口）。demo→正式版 DSL 映射登记（预研表 PM 采纳）：
//   - 端口：cdp.open/cdp.click demo 出口 'out' → 正式版 'ok'；human.review 'out' → 'approve'；
//   - 参数丢弃（正式版 schema 无该键）：trigger.manual note、cdp.open wait、ai.llm model；
//     human.review options 多行文本 → json 数组；数值参数统一 number 型。
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

/** 种子流程节点构造简写（id=`<flowId>-<demoId>`——demo 短 id 保构架可对照＋跨流命名空间隔离） */
function nd(
  flowId: string,
  demoId: string,
  type: string,
  name: string,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): FlowNode {
  return { id: `${flowId}-${demoId}`, type, name, position: { x, y }, params };
}

/** 边构造简写（from/to=端口元组 [nodeId, portId]；出口端口=正式版 DSL 键——映射登记见文件头） */
function ed(flowId: string, fromDemo: string, fromPort: string, toDemo: string, toPort = 'in'): FlowEdge {
  return {
    id: `${flowId}-${fromDemo}-${fromPort}-${toDemo}-${toPort}`,
    from: [`${flowId}-${fromDemo}`, fromPort],
    to: [`${flowId}-${toDemo}`, toPort],
  };
}

export interface SeedFlow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 通知 webhook（demo 各流共用 https://hooks.example.com/notify） */
const NOTIFY = 'https://hooks.example.com/notify';

/**
 * 9 条种子流程（f1~f9；demo L1080-1226 构架事实源逐流对齐——T6-18 重制，节点/连线/参数/
 * 坐标=demo 原值；D-8 验收剧本载体：F1 branch 双路/F3 断点/F4 三 lane 汇合/F5~F9=MA-1~5）。
 */
export const SEED_FLOWS: readonly SeedFlow[] = [
  {
    // demo L1085-1100：F1 商品价格监控（branch 双路，7 节点 6 边）
    id: 'f1',
    name: '商品价格监控',
    nodes: [
      nd('f1', 'a1', 'trigger.manual', '手动触发', 40, 246),
      nd('f1', 'a2', 'cdp.open', '打开商品页', 284, 246, { url: 'https://mall.example.com/p/128' }),
      nd('f1', 'a3', 'cdp.extract', '提取价格', 528, 246, { selector: '.price', attr: 'textContent' }),
      nd('f1', 'a4', 'logic.branch', '低于 199 ？', 772, 246, { expr: 'price < 199' }),
      nd('f1', 'a5', 'ai.llm', 'AI 生成摘要', 1016, 132, { prompt: '总结价格变动并给出购买建议，不超过 50 字' }),
      nd('f1', 'a6', 'file.write', '写入报告', 1272, 132, { path: './out/price-report.md' }),
      nd('f1', 'a7', 'http.request', '推送通知', 1016, 392, { method: 'POST', url: NOTIFY }),
    ],
    edges: [
      ed('f1', 'a1', 'out', 'a2'),
      ed('f1', 'a2', 'ok', 'a3'), // demo 'out'→'ok'（cdp.open 端口映射）
      ed('f1', 'a3', 'out', 'a4'),
      ed('f1', 'a4', 'true', 'a5'),
      ed('f1', 'a4', 'false', 'a7'),
      ed('f1', 'a5', 'out', 'a6'),
    ],
  },
  {
    // demo L1101-1108：F2 每日数据备份（cron 0 9 * * *，3 节点）
    id: 'f2',
    name: '每日数据备份',
    nodes: [
      nd('f2', 'b1', 'trigger.cron', '每天 09:00', 80, 210, { cron: '0 9 * * *' }),
      nd('f2', 'b2', 'data.transform', '打包 JSON', 360, 210, { expr: 'return { date: today(), rows: db.export() }' }),
      nd('f2', 'b3', 'file.write', '落盘备份', 650, 210, { path: './backup/daily.json' }),
    ],
    edges: [ed('f2', 'b1', 'out', 'b2'), ed('f2', 'b2', 'out', 'b3')],
  },
  {
    // demo L1109-1123：F3 JD 岗位筛选（human.review 断点 5 选项剧本构架，5 节点）
    id: 'f3',
    name: 'JD 岗位筛选',
    nodes: [
      nd('f3', 'j1', 'trigger.manual', '手动触发', 40, 250),
      nd('f3', 'j2', 'cdp.extract', '提取 JD', 280, 250, { selector: '.job-desc', attr: 'textContent' }),
      nd('f3', 'j3', 'human.review', '确认 JD 与硬性条件', 520, 250, {
        question: 'JD 提取结果是否准确？勾选硬性筛选条件，可补充要求',
        options: ['年龄 ≤ 35 岁', '本科及以上', '3 年以上经验', '可接受出差', '英语流利'],
      }),
      nd('f3', 'j4', 'ai.llm', '合并为岗位画像', 780, 250, {
        prompt: '将确认结果与补充要求合并为岗位画像 JSON（jd / filters / notes）',
      }),
      nd('f3', 'j5', 'file.write', '写入画像', 1030, 250, { path: './out/jd-profile.json' }),
    ],
    edges: [
      ed('f3', 'j1', 'out', 'j2'),
      ed('f3', 'j2', 'out', 'j3'),
      ed('f3', 'j3', 'approve', 'j4'), // demo 'out'→'approve'（human.review 端口映射）
      ed('f3', 'j4', 'out', 'j5'),
    ],
  },
  {
    // demo L1124-1147：F4 多城市社保上传（三 lane 汇合构架，10 节点 11 边——T6-16 终审 M-2 计数勘正）
    id: 'f4',
    name: '多城市社保上传',
    nodes: [
      nd('f4', 't1', 'trigger.manual', '手动触发', 40, 330),
      nd('f4', 'd1', 'data.transform', '读取名单·按城市拆分', 280, 330, {
        expr: 'return staff.groupBy(city) // 北京 / 上海 / 广州',
      }),
      nd('f4', 'c1', 'cdp.open', '北京人社局', 520, 130, { url: 'https://beijing.rsj.example.com' }),
      nd('f4', 'c2', 'cdp.click', '上传缴费文件', 760, 130, { selector: '#upload-btn' }),
      nd('f4', 's1', 'cdp.open', '上海人社局', 520, 330, { url: 'https://shanghai.rsj.example.com' }),
      nd('f4', 's2', 'cdp.click', '上传缴费文件', 760, 330, { selector: '#upload-btn' }),
      nd('f4', 'g1', 'cdp.open', '广州人社局', 520, 530, { url: 'https://guangzhou.rsj.example.com' }),
      nd('f4', 'g2', 'cdp.click', '上传缴费文件', 760, 530, { selector: '#upload-btn' }),
      nd('f4', 'j1', 'ai.llm', '汇总各城市回执', 1010, 330, { prompt: '汇总三城市社保上传回执，生成办理状态清单' }),
      nd('f4', 'n1', 'http.request', '企微通知', 1250, 330, { method: 'POST', url: NOTIFY }),
    ],
    edges: [
      ed('f4', 't1', 'out', 'd1'),
      ed('f4', 'd1', 'out', 'c1'),
      ed('f4', 'd1', 'out', 's1'),
      ed('f4', 'd1', 'out', 'g1'),
      ed('f4', 'c1', 'ok', 'c2'), // demo 'out'→'ok'（cdp.open/cdp.click 端口映射，下同）
      ed('f4', 's1', 'ok', 's2'),
      ed('f4', 'g1', 'ok', 'g2'),
      ed('f4', 'c2', 'ok', 'j1'),
      ed('f4', 's2', 'ok', 'j1'),
      ed('f4', 'g2', 'ok', 'j1'),
      ed('f4', 'j1', 'out', 'n1'),
    ],
  },
  {
    // demo L1150-1167：F5 小红书·爆款采集判定（=MA-1 种子版示例；gate.login ok/ai.classify hit 出口）
    id: 'f5',
    name: '小红书·爆款采集判定',
    nodes: [
      nd('f5', 't1', 'trigger.manual', '手动启动采集', 40, 210),
      nd('f5', 'g1', 'gate.login', '登录/验证码闸', 290, 210, {
        homeUrl: 'https://www.xiaohongshu.com',
        probe: '.login-btn',
      }),
      nd('f5', 's1', 'xhs.search', '关键词搜索采集', 540, 210, {
        keywords: '装修避坑\n全屋定制\n旧房改造',
        maxNotes: 40,
        sort: '综合',
      }),
      nd('f5', 'd1', 'xhs.detail', '笔记详情+评论', 790, 210, { fields: 'title\ndesc\nlikes\ncomments', withComments: '是' }),
      nd('f5', 'v1', 'data.vault', '笔记库 upsert', 1040, 210, { op: 'upsert 笔记', cursorKey: 'last_note_id' }),
      nd('f5', 'c1', 'ai.classify', '爆款潜力判定', 1290, 210, {
        rule: '与家居装修业务相关，且互动数据有爆款潜力',
        model: 'glm-5',
      }),
      nd('f5', 'v2', 'data.vault', '标记待触达', 1540, 90, { op: '标记待触达', cursorKey: '' }),
      nd('f5', 'n1', 'http.request', '企微通知', 1790, 90, { method: 'POST', url: NOTIFY }),
    ],
    edges: [
      ed('f5', 't1', 'out', 'g1'),
      ed('f5', 'g1', 'ok', 's1'), // blocked 出口=demo 构架未连线（blocked 挂起交人工语义）
      ed('f5', 's1', 'out', 'd1'),
      ed('f5', 'd1', 'out', 'v1'),
      ed('f5', 'v1', 'out', 'c1'),
      ed('f5', 'c1', 'hit', 'v2'), // miss 出口=demo 构架未连线（死路径级联 ⊘）
      ed('f5', 'v2', 'out', 'n1'),
    ],
  },
  {
    // demo L1168-1184：F6 小红书·私信触达（=MA-2 种子版示例；断点确认后才开跑发送链）
    id: 'f6',
    name: '小红书·私信触达',
    nodes: [
      nd('f6', 't1', 'trigger.manual', '手动启动触达', 40, 210),
      nd('f6', 'v1', 'data.vault', '读待触达名单', 290, 210, { op: '读待触达名单', cursorKey: '' }),
      nd('f6', 'h1', 'human.review', '确认名单与风格', 540, 210, {
        question: '确认今日私信触达名单与话术要求（可勾选、可补充）',
        options: ['仅发送互动 top20', '话术用朋友口吻', '排除已触达过的', '附笔记标题引用'],
      }),
      nd('f6', 'cp1', 'ai.copygen', '逐人生成话术', 790, 210, {
        template: '{{nickname}} 你好，看你分享的{{noteTitle}}很有共鸣，我们也是做家居定制的，交个朋友～',
        tone: '朋友口吻',
        antiRepeat: '开',
      }),
      nd('f6', 'dm1', 'xhs.dm.send', '批量私信发送', 1040, 210, { minInterval: 60, maxPerDay: 30, confirmWait: 8 }),
      nd('f6', 'n1', 'http.request', '回执汇总通知', 1290, 210, { method: 'POST', url: NOTIFY }),
    ],
    edges: [
      ed('f6', 't1', 'out', 'v1'),
      ed('f6', 'v1', 'out', 'h1'),
      ed('f6', 'h1', 'approve', 'cp1'), // demo 'out'→'approve'
      ed('f6', 'cp1', 'out', 'dm1'),
      ed('f6', 'dm1', 'out', 'n1'),
    ],
  },
  {
    // demo L1185-1197：F7 小红书·智能评论（=MA-3 种子版示例；xhs.comment.post=T6-18 第 10 枚示例资产）
    id: 'f7',
    name: '小红书·智能评论',
    nodes: [
      nd('f7', 't1', 'trigger.manual', '手动启动', 40, 210),
      nd('f7', 'v1', 'data.vault', '读待评笔记', 290, 210, { op: '读待评笔记', cursorKey: '' }),
      nd('f7', 'cp1', 'ai.copygen', '生成语境化评论', 540, 210, {
        template: '{{noteTitle}} 这篇整理得很细，补充一点：全屋定制先看板材环保等级再谈价格。',
        tone: '专业顾问',
        antiRepeat: '开',
      }),
      nd('f7', 'cm1', 'xhs.comment.post', '发布评论', 790, 210, { maxLen: 50, ratePerMin: 4 }),
      nd('f7', 'v2', 'data.vault', '记录已评论', 1040, 210, { op: '记录已发送', cursorKey: '' }),
    ],
    edges: [
      ed('f7', 't1', 'out', 'v1'),
      ed('f7', 'v1', 'out', 'cp1'),
      ed('f7', 'cp1', 'out', 'cm1'),
      ed('f7', 'cm1', 'out', 'v2'),
    ],
  },
  {
    // demo L1198-1209：F8 小红书·即时回复值守（=MA-4 种子版示例；组合节点 replied/escalated 双出）
    id: 'f8',
    name: '小红书·即时回复值守',
    nodes: [
      nd('f8', 't1', 'trigger.manual', '开始值守', 40, 210),
      nd('f8', 'a1', 'xhs.auto-reply', '回复一体机', 290, 210, {
        persona: '家居定制顾问小雅',
        cooldownMin: 3,
        dailyLimit: 50,
      }),
      nd('f8', 'v1', 'data.vault', '登记会话缓存', 540, 90, { op: '登记会话', cursorKey: '' }),
      nd('f8', 'h1', 'human.review', '人工接管', 540, 330, {
        question: '以下会话 AI 应对不了，请人工接管回复',
        options: ['需要人工回复', '疑似售后问题', '疑似骚扰，建议拉黑'],
      }),
    ],
    edges: [
      ed('f8', 't1', 'out', 'a1'),
      ed('f8', 'a1', 'replied', 'v1'),
      ed('f8', 'a1', 'escalated', 'h1'),
    ],
  },
  {
    // demo L1210-1220：F9 小红书·账号健康日报（=MA-5 种子版示例；cron 0 20 * * *）
    id: 'f9',
    name: '小红书·账号健康日报',
    nodes: [
      nd('f9', 'c1', 'trigger.cron', '每天 20:00', 40, 210, { cron: '0 20 * * *' }),
      nd('f9', 'v1', 'data.vault', '读运营台账', 290, 210, { op: '读运营台账', cursorKey: '' }),
      nd('f9', 'l1', 'ai.llm', '生成健康日报', 540, 210, {
        prompt: '根据运营台账生成日报：发送量/成功率/熔断与限流事件/次日建议，200 字内',
      }),
      nd('f9', 'n1', 'http.request', '推送日报', 790, 210, { method: 'POST', url: NOTIFY }),
    ],
    edges: [ed('f9', 'c1', 'out', 'v1'), ed('f9', 'v1', 'out', 'l1'), ed('f9', 'l1', 'out', 'n1')],
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
