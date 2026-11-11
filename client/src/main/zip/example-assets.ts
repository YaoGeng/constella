// 示例资产 10 —— 官方分发的强节点示例包数据源（T5-08 / TDD-C-08 §3「示例资产首启装载」段；
// T6-18 增 xhs.comment.post：9→10，PM 裁决 2026-11-11——MA-3 智能评论种子载体，
// 定义形=demo L928-931 强节点/L954 脚本源同构；「示例资产 9/definitions=21」为 P5 收口
// 簿记非契约面，net.fetch 保留不撤）。
//
// 本模块=示例内容**单一事实源**（03 L1890：示例强节点定义+scripts 走 zip 资产包链、
// kind=custom、可被同型自定义节点覆盖——01 A-4.02）：
//   - 生成脚本 client/scripts/gen-examples.mjs 经 esbuild 打包本模块→用 main/zip ZipWriter
//     （ZIP_EPOCH 确定性）产出 client/assets/examples/*.zip 十枚入库产物；
//   - example-preloader.spec 以本模块重产字节与入库 zip 逐枚 SHA-256 比对（漂移即断言失败）；
//   - 运行期 ExamplePreloader 只扫 examplesDir 目录消费 zip 文件，不 import 本模块
//     （预装面=纯文件输入，升级=随分发替换 zip——03 §8 扩展点②）。
//
// 内容口径（卡面约束）：强节点（exec≠null）＋py/ts 双运行时混合（7 py＋3 ts）＋类目多样
// （CDP/社媒/数据/AI/网络）＋「网络」类目 ≥1（net.fetch=ctx.net 面示例，N1 网络门）＋
// 不撞内置 12 命名空间（C-02 checkNamespace 精确匹配口径）。定义形源自 demo L899-938
// 自研强节点十型（参数/出口/inner 同源），补 exec/io/policy 至 N1~N8 全维度；
// 每定义须经 C-02 validateDefinition 八条零错误（spec 断言面）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PackageManifest } from '@constella/shared/manifest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ZIP_EPOCH } from './export-pipeline';
import { createZipWriter, type ZipFileInput } from './zip-writer';

/** demo L2591 原文（deps/requirements.txt——python 按语言；export-pipeline 同源冻结引文） */
const PY_DEPS = '# 自研节点脚本依赖 [AI 生成]\nhttpx>=0.27\npyyaml>=6.0\n';
/** demo L2592 原文（deps/package.json——ts 按语言；export-pipeline 同源冻结引文） */
const TS_DEPS = JSON.stringify(
  { name: 'constella-node-scripts', private: true, dependencies: { '@constella/sdk': '^1.0.0' } },
  null,
  2,
);

/** 单示例资产（定义＋脚本正文＋可选 config——四件套源数据） */
export interface ExampleAsset {
  /** custom 类型 id（不撞 BUILTIN_TYPE_IDS——C-02 N1 命名空间） */
  type: string;
  /** 强节点定义（kind=custom、exec≠null；N1~N8 全维度） */
  definition: NodeDefinition;
  /** scripts/<file> 正文（py/ts 双运行时混合） */
  script: string;
  /** config/<file> 正文（可选——02 §14 覆盖序中间层示例） */
  config?: string;
}

const L = (lines: readonly string[]): string => lines.join('\n') + '\n';

/**
 * 示例资产 10（demo L899-938 自研强节点同源；net.fetch 为 ctx.net 面示例增补——卡面「网络」类目约束；
 * xhs.comment.post 为 T6-18 补入——demo 强节点十型唯一缺位，MA-3 种子载体）。
 * 出口路由三例（gate.login ok/blocked、ai.classify hit/miss、xhs.auto-reply replied/escalated）；
 * io 契约三例（ai.classify per-exit＝X-5、xhs.search/net.fetch 单 output）；N5 inner 一例
 * （xhs.auto-reply）；N6 failBranch 一例（ai.classify→miss，MA-1 unknown 形态同构）；
 * secret 型参数一例（net.fetch token——仅 schema 声明，包内零密文）。
 */
export const EXAMPLE_ASSETS: readonly ExampleAsset[] = [
  {
    type: 'gate.login',
    definition: {
      type: 'gate.login',
      kind: 'custom',
      meta: {
        name: '登录闸',
        icon: '🛂',
        category: 'CDP',
        description:
          '登录探测：导航站点首页等待探针出现，登录按钮可见即未登录 → 走 blocked 分支挂起交人工；通过则放行 ok。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'ok', label: '已登录' }, { id: 'blocked', label: '未登录' }] },
      paramsSchema: [
        { k: 'homeUrl', label: '站点首页 URL', t: 'text', required: true, ph: 'https://www.xiaohongshu.com', mono: true },
        { k: 'probe', label: '登录探针（可见=未登录）', t: 'text', required: true, ph: '.login-btn', mono: true },
      ],
      exec: { lang: 'python', file: 'scripts/gate_login.py', entry: 'run', config: 'config/gate_login.yaml', deps: 'deps/requirements.txt' },
      policy: { timeoutMs: 30_000, retries: 1 },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""登录/验证码闸（官方示例）：ctx.browser 探测登录态，双出口路由。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    home = str(ctx.params["homeUrl"])',
      '    probe = str(ctx.params["probe"])',
      '    await ctx.browser.open(home)',
      '    if await ctx.browser.visible(probe):',
      '        ctx.log("登录探针可见——判定未登录，走 blocked 交人工")',
      '        return {"branch": "blocked", "homeUrl": home}',
      '    ctx.log("登录探针不可见——判定已登录，放行 ok")',
      '    return {"branch": "ok", "homeUrl": home}',
    ]),
    config: L(['# 登录闸默认配置（实例参数可覆盖——02 §14 覆盖序）', 'probeWaitMs: 1500', 'settleRounds: 2']),
  },
  {
    type: 'xhs.search',
    definition: {
      type: 'xhs.search',
      kind: 'custom',
      meta: {
        name: '搜索采集',
        icon: '🔎',
        category: '社媒',
        description:
          '搜索页合成填词提交 → URL 落搜索结果页校验 → 循环滚动采卡（≤20 轮，连续 2 轮无新增即停）。去重、限速内置，多关键词逐个跑完合并。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'keywords', label: '关键词组（每行一个）', t: 'textarea', required: true, ph: '装修避坑\n全屋定制' },
        { k: 'maxNotes', label: '单关键词采集上限', t: 'number', default: 40, min: 1 },
        { k: 'sort', label: '排序', t: 'select', opts: ['综合', '最新', '最热'], default: '综合' },
      ],
      exec: { lang: 'python', file: 'scripts/xhs_search.py', entry: 'run', deps: 'deps/requirements.txt' },
      policy: { timeoutMs: 300_000, retries: 0 },
      io: {
        output: {
          fields: [
            { name: 'notes', type: 'object[]', example: '[{title, likes, url}]' },
            { name: 'keywordCount', type: 'number', example: '2' },
          ],
        },
      },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""搜索采集（滚动翻页）（官方示例）：多关键词逐个采集合并，去重内置。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    keywords = [k for k in str(ctx.params["keywords"]).splitlines() if k.strip()]',
      '    limit = int(ctx.params.get("maxNotes", 40))',
      '    sort = str(ctx.params.get("sort", "综合"))',
      '    notes: list[object] = []',
      '    seen: set[str] = set()',
      '    for kw in keywords:',
      '        ctx.log(f"采集关键词：{kw}（≤{limit} 条，{sort}）")',
      '        cards = await ctx.browser.scrollCollect(kw, limit=limit, sort=sort)',
      '        fresh = [c for c in cards if str((c or {}).get("url", "")) not in seen]',
      '        for c in fresh:',
      '            seen.add(str((c or {}).get("url", "")))',
      '        notes.extend(fresh)',
      '    return {"data": {"notes": notes, "keywordCount": len(keywords)}}',
    ]),
  },
  {
    type: 'xhs.detail',
    definition: {
      type: 'xhs.detail',
      kind: 'custom',
      meta: {
        name: '笔记详情提取',
        icon: '📄',
        category: '社媒',
        description:
          '逐笔记导航原链接 → 等待详情标题 → 提取标题/正文/互动数与初始态媒体直链 → 滚动采尽评论区（按 user_id+content 去重）。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'fields', label: '提取字段（每行一个）', t: 'textarea', ph: 'title\ndesc\nlikes\ncomments' },
        {
          k: 'withComments',
          label: '同时采评论',
          t: 'select',
          opts: ['是', '否'],
          default: '是',
        },
      ],
      exec: { lang: 'python', file: 'scripts/xhs_detail.py', entry: 'run', config: 'config/xhs_detail.yaml', deps: 'deps/requirements.txt' },
      policy: { timeoutMs: 300_000, retries: 1, backoffMs: 2000 },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""笔记详情+评论提取（官方示例）：逐笔记导航提取，评论按 user_id+content 去重。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    items = (ctx.input or {}).get("notes", []) if isinstance(ctx.input, dict) else []',
      '    fields = [f for f in str(ctx.params.get("fields", "title\\ndesc")).splitlines() if f.strip()]',
      '    with_comments = str(ctx.params.get("withComments", "是")) == "是"',
      '    details: list[object] = []',
      '    for it in items:',
      '        url = str((it or {}).get("url", ""))',
      '        if not url:',
      '            continue',
      '        note = await ctx.browser.extractNote(url, fields)',
      '        if with_comments:',
      '            note["comments"] = await ctx.browser.scrollComments(url)',
      '        details.append(note)',
      '        ctx.log(f"已提取 {url}（{len(note)} 字段）")',
      '    return {"data": {"details": details}}',
    ]),
    config: L(['# 详情提取默认配置（实例参数可覆盖——02 §14 覆盖序）', 'commentLimit: 200', 'dedupeBy: user_id+content']),
  },
  {
    type: 'data.vault',
    definition: {
      type: 'data.vault',
      kind: 'custom',
      meta: {
        name: '业务库读写',
        icon: '🗃️',
        category: '数据',
        description:
          '本地单库（db.json）：笔记/人员/判定结果/触达队列/游标一处收口，上游产出落库、下游按 op 取数。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        {
          k: 'op',
          label: '操作',
          t: 'select',
          required: true,
          opts: ['upsert 笔记', '标记待触达', '读待触达名单', '读待评笔记', '记录已发送', '登记会话', '读运营台账'],
        },
        { k: 'cursorKey', label: '游标键（可续跑）', t: 'text', ph: 'last_note_id', mono: true },
      ],
      exec: { lang: 'python', file: 'scripts/data_vault.py', entry: 'run', deps: 'deps/requirements.txt' },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""业务库读写（官方示例）：ctx.vault 统一收口，游标可续跑。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    op = str(ctx.params["op"])',
      '    cursor_key = str(ctx.params.get("cursorKey", "") or "last_note_id")',
      '    if op == "upsert 笔记":',
      '        notes = (ctx.input or {}).get("notes", []) if isinstance(ctx.input, dict) else []',
      '        await ctx.vault.upsertNotes(notes)',
      '        ctx.log(f"落库 {len(notes)} 条笔记")',
      '        return {"data": {"upserted": len(notes)}}',
      '    result = await ctx.vault.exec(op, ctx.input, None)',
      '    return {"data": {"op": op, "cursorKey": cursor_key, "result": result}}',
    ]),
  },
  {
    type: 'ai.classify',
    definition: {
      type: 'ai.classify',
      kind: 'custom',
      meta: {
        name: 'AI 规则判定',
        icon: '⚖️',
        category: 'AI',
        description:
          '按「判断规则」输出 {label, reason≤10字}；温度 0.1，非法输出不臆测直接走 miss。判定结果自带路由：hit=符合规则，miss=不符合。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'hit', label: '符合' }, { id: 'miss', label: '不符合' }] },
      paramsSchema: [
        { k: 'rule', label: '判断规则', t: 'textarea', required: true, ph: '与家居装修业务相关，且互动数据有爆款潜力' },
        { k: 'model', label: '模型', t: 'select', opts: ['glm-5', 'deepseek-v4', 'kimi-k2'], default: 'glm-5' },
      ],
      exec: { lang: 'python', file: 'scripts/ai_classify.py', entry: 'run', deps: 'deps/requirements.txt' },
      // N6 failBranch→miss（MA-1 unknown 形态同构：脚本失败/非法输出不臆测，落 miss 出口）
      policy: { timeoutMs: 60_000, retries: 1, onFailure: { type: 'failBranch', exit: 'miss' } },
      // N7 per-exit 输出声明（X-5）：hit/miss 双出口各携 fields
      io: {
        outputs: {
          hit: { fields: [{ name: 'label', type: 'string' }, { name: 'reason', type: 'string', example: '"互动强相关"' }] },
          miss: { fields: [{ name: 'reason', type: 'string', example: '"规则不符"' }] },
        },
      },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""AI 规则判定（官方示例）：结构化判定自带路由；非法输出不臆测直接 miss。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    rule = str(ctx.params["rule"])',
      '    prompt = (',
      '        "按规则判定以下内容，输出 JSON {label: hit|miss, reason: ≤10字}。\\n"',
      '        f"规则：{rule}\\n内容：{ctx.input}"',
      '    )',
      '    verdict = await ctx.llm.json(prompt, 0.1)',
      '    label = str((verdict or {}).get("label", ""))',
      '    reason = str((verdict or {}).get("reason", ""))[:10]',
      '    if label == "hit":',
      '        return {"branch": "hit", "label": label, "reason": reason}',
      '    return {"branch": "miss", "reason": reason or "规则不符"}',
    ]),
  },
  {
    type: 'ai.copygen',
    definition: {
      type: 'ai.copygen',
      kind: 'custom',
      meta: {
        name: 'AI 话术生成',
        icon: '✍️',
        category: 'AI',
        description:
          '按收件人逐条生成：fixed 模式按槽位轮换模板，llm 模式结合对方资料生成并做反模板校验（最近 3 条已发话术不重复）。支持 {{nickname}} / {{noteTitle}} 插槽。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'template', label: '话术模板（{{nickname}} / {{noteTitle}}）', t: 'textarea', required: true, ph: '{{nickname}} 你好，看你分享的{{noteTitle}}…' },
        { k: 'tone', label: '语气', t: 'select', opts: ['专业顾问', '朋友口吻', '玩梗'], default: '专业顾问' },
        { k: 'antiRepeat', label: '反模板校验', t: 'select', opts: ['开', '关'], default: '开' },
      ],
      exec: { lang: 'ts', file: 'scripts/ai_copygen.ts', entry: 'run', deps: 'deps/package.json' },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '// AI 话术生成（官方示例）：ctx.llm.fill 槽位填充＋反模板校验（最近已发不重复）。',
      "import type { NodeCtx, NodeOut } from '@constella/sdk';",
      '',
      'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
      "  const template = String(ctx.params.template);",
      "  const tone = String(ctx.params.tone ?? '专业顾问');",
      '  const recipients: Array<{ uid: string; nickname: string; noteTitle?: string }> =',
      '    (ctx.input && typeof ctx.input === \'object\' && Array.isArray((ctx.input as { queue?: unknown[] }).queue)',
      '      ? (ctx.input as { queue: typeof recipients }).queue',
      '      : []) as typeof recipients;',
      '  const messages: Array<{ uid: string; text: string }> = [];',
      '  for (const r of recipients) {',
      '    const avoid = ctx.params.antiRepeat === \'开\' ? (await ctx.vault.recentSent(r.uid, 3)).join(\'｜\') : undefined;',
      '    const who = r.noteTitle !== undefined ? `${r.nickname}（分享过 ${r.noteTitle}）` : r.nickname;',
      '    const text = await ctx.llm.fill(template, who, tone, avoid);',
      `    ctx.log(\`生成 \${r.nickname}：\${text.slice(0, 24)}…\`);`,
      '    messages.push({ uid: r.uid, text });',
      '  }',
      '  return { data: { messages } };',
      '}',
    ]),
  },
  {
    type: 'net.fetch',
    definition: {
      type: 'net.fetch',
      kind: 'custom',
      meta: {
        name: '网页抓取',
        icon: '🛰️',
        category: '网络',
        description:
          '经 ctx.net main 网络代理抓取 URL（N1「网络」类目门——白名单外域名拒绝）；可选 Bearer 令牌（secret 型，仅 schema 声明、值走 SecretVault）。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'url', label: 'URL', t: 'text', required: true, ph: 'https://api.example.com/feed.json', mono: true },
        { k: 'format', label: '响应处理', t: 'select', opts: ['json', 'text'], default: 'json' },
        { k: 'token', label: 'Bearer 令牌（可选）', t: 'secret', storage: 'safeStorage' },
      ],
      exec: { lang: 'ts', file: 'scripts/net_fetch.ts', entry: 'run', deps: 'deps/package.json' },
      policy: { timeoutMs: 60_000, retries: 2, backoffMs: 1000 },
      io: {
        output: {
          fields: [
            { name: 'status', type: 'number', example: '200' },
            { name: 'body', type: 'string', example: '"{ items: [...] }"' },
          ],
        },
      },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '// 网页抓取（官方示例·ctx.net 面）：N1「网络」类目节点——经 main 网络代理 fetch，白名单外域名拒绝。',
      "import type { NodeCtx, NodeOut } from '@constella/sdk';",
      '',
      'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
      '  const headers: Record<string, string> = {};',
      '  if (typeof ctx.params.token === \'string\' && ctx.params.token !== \'\') {',
      "    headers.authorization = `Bearer ${String(ctx.params.token)}`;",
      '  }',
      '  const res = await ctx.net.fetch(String(ctx.params.url), { headers });',
      '  ctx.log(`抓取 ${String(ctx.params.url)} → ${res.status}`);',
      "  const body = ctx.params.format === 'text' ? res.body : safeJson(res.body);",
      '  return { data: { status: res.status, body } };',
      '}',
      '',
      'function safeJson(text: string): unknown {',
      '  try {',
      '    return JSON.parse(text);',
      '  } catch {',
      '    return text;',
      '  }',
      '}',
    ]),
  },
  {
    type: 'xhs.dm.send',
    definition: {
      type: 'xhs.dm.send',
      kind: 'custom',
      meta: {
        name: '私信批量发送',
        icon: '✉️',
        category: '社媒',
        description:
          '逐收件人进入会话页发送：输入框填词 → 发送 → 轮询确认。频控内置（间隔下限＋日上限）；受限当行回队列交人工，连续失败熔断。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'minInterval', label: '发送间隔下限 (s)', t: 'number', default: 60, min: 10 },
        { k: 'maxPerDay', label: '单账号日上限', t: 'number', default: 30, min: 1 },
        { k: 'confirmWait', label: '发送确认轮询 (s)', t: 'number', default: 8, min: 1 },
      ],
      exec: { lang: 'ts', file: 'scripts/xhs_dm_send.ts', entry: 'run', deps: 'deps/package.json' },
      policy: { timeoutMs: 600_000, retries: 0 },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '// 私信批量发送（官方示例）：ctx.im 收件轮询＋发送确认；频控（间隔/日上限）与熔断内置。',
      "import type { NodeCtx, NodeOut } from '@constella/sdk';",
      '',
      'export async function run(ctx: NodeCtx): Promise<NodeOut> {',
      '  const minIntervalMs = Number(ctx.params.minInterval ?? 60) * 1000;',
      '  const maxPerDay = Number(ctx.params.maxPerDay ?? 30);',
      '  const confirmWait = Number(ctx.params.confirmWait ?? 8);',
      '  const queue: Array<{ uid: string; text: string }> =',
      '    (ctx.input && typeof ctx.input === \'object\' && Array.isArray((ctx.input as { messages?: unknown[] }).messages)',
      '      ? (ctx.input as { messages: typeof queue }).messages',
      '      : []) as typeof queue;',
      '  const sent: string[] = [];',
      '  const deferred: string[] = [];',
      '  let failures = 0;',
      '  for (const m of queue.slice(0, maxPerDay)) {',
      '    if (failures >= 3) { deferred.push(m.uid); continue; } // 连续 3 失败熔断——当行回队列交人工',
      '    try {',
      '      await ctx.im.send(m.uid, m.text);',
      '      await ctx.sleep(confirmWait * 1000); // 发送确认轮询窗口',
      '      await ctx.vault.logChat({ uid: m.uid, text: m.text, at: Date.now() });',
      '      sent.push(m.uid);',
      `      ctx.log(\`已发送 \${m.uid}（\${sent.length}/\${maxPerDay}）\`);`,
      '      failures = 0;',
      '      await ctx.sleep(minIntervalMs + Math.floor(Math.random() * 120_000)); // 60–180s 随机间隔',
      '    } catch {',
      '      failures += 1;',
      '      deferred.push(m.uid);',
      '    }',
      '  }',
      '  return { data: { sent, deferred } };',
      '}',
    ]),
  },
  {
    // T6-18（PM 裁决 2026-11-11）：MA-3 智能评论种子载体——demo L928-931 定义形/L954 BUNDLE
    // （python/xhs_comment.py）同构；单出口（demo outs:['out']）；频控写档语义随 dm.send 形
    // （retries=0——频控类发送不重试）；作者错位防护语义入 meta.description（demo doc 原文）。
    type: 'xhs.comment.post',
    definition: {
      type: 'xhs.comment.post',
      kind: 'custom',
      meta: {
        name: '智能评论发布',
        icon: '💬',
        category: '社媒',
        description:
          '导航目标笔记 → 定位楼层 → 填入评论文本 → 等发送按钮异步使能后点击 → 列表轮询确认。写档频控内置（4 req/min），作者错位防护（不评论自家笔记）。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'out', label: '输出' }] },
      paramsSchema: [
        { k: 'maxLen', label: '评论长度上限', t: 'number', default: 50, min: 1 },
        { k: 'ratePerMin', label: '发布频率 (条/分钟)', t: 'number', default: 4, min: 1 },
      ],
      exec: { lang: 'python', file: 'scripts/xhs_comment.py', entry: 'run', deps: 'deps/requirements.txt' },
      policy: { timeoutMs: 600_000, retries: 0 },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""智能评论发布（官方示例）：逐笔记导航→截断至 maxLen→ctx.browser.comment 发布，频控（ratePerMin 条/分钟）内置。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    max_len = int(ctx.params.get("maxLen", 50))',
      '    rate = int(ctx.params.get("ratePerMin", 4))',
      '    items = (ctx.input or {}).get("data", []) if isinstance(ctx.input, dict) else []',
      '    posted: list[object] = []',
      '    for it in items:',
      '        note = it if isinstance(it, dict) else {}',
      '        url = str(note.get("url", ""))',
      '        text = str(note.get("text", ""))[:max_len]',
      '        if not url or not text:',
      '            continue',
      '        await ctx.browser.open(url)',
      '        await ctx.browser.comment(text, rate)',
      '        posted.append({"url": url, "len": len(text)})',
      '        ctx.log(f"已评论 {url}（{len(posted)}/{len(items)}，频控 {rate} 条/分钟）")',
      '    return {"data": {"posted": posted}}',
    ]),
    config: L(['# 智能评论发布默认配置（实例参数可覆盖——02 §14 覆盖序）', 'sendWaitMs: 800', 'confirmRounds: 3']),
  },
  {
    type: 'xhs.auto-reply',
    definition: {
      type: 'xhs.auto-reply',
      kind: 'custom',
      meta: {
        name: '即时回复一体机',
        icon: '🤖',
        category: '社媒',
        description:
          '组合节点（内部四步子流程）：会话判向（末条非我方才算新来信）→ 意图识别 → 按角色卡生成回复 → 发送并登记回声缓存；应对不了的升级 escalated 交人工。单轮 ≤5 会话、同会话冷却、日上限内置。',
        author: '@constella',
        source: 'zip',
      },
      ports: { ins: ['in'], outs: [{ id: 'replied', label: '已回复' }, { id: 'escalated', label: '已升级' }] },
      paramsSchema: [
        { k: 'persona', label: '角色卡', t: 'text', required: true, ph: '家居定制顾问小雅' },
        { k: 'cooldownMin', label: '同会话冷却 (min)', t: 'number', default: 3, min: 0 },
        { k: 'dailyLimit', label: '自动回复日上限', t: 'number', default: 50, min: 1 },
      ],
      // N5 inner（02 §8.1：组合节点内嵌子步骤——可展示、执行时引擎内联展开）
      inner: ['会话判向 · 历史复放判新来信', '意图识别 · 咨询/售后/骚扰', '生成回复 · 角色卡 persona', '发送登记 · 回声写入会话缓存'],
      exec: { lang: 'python', file: 'scripts/xhs_auto_reply.py', entry: 'run', deps: 'deps/requirements.txt' },
      policy: { timeoutMs: 120_000, retries: 0 },
      version: '1.0.0',
      packageVersion: '1.0.0',
    },
    script: L([
      '# -*- coding: utf-8 -*-',
      '"""即时回复一体机（官方示例·组合节点）：判向→意图→生成→发送登记；应对不了升级人工。"""',
      'from typing import Any',
      '',
      'from constella_sdk import NodeCtx',
      '',
      '',
      'async def run(ctx: NodeCtx) -> dict[str, Any]:',
      '    persona = str(ctx.params["persona"])',
      '    daily_limit = int(ctx.params.get("dailyLimit", 50))',
      '    sessions = await ctx.im.pollUnread({"limit": 5, "cooldownMin": int(ctx.params.get("cooldownMin", 3))})',
      '    replied: list[str] = []',
      '    escalated: list[str] = []',
      '    for s in sessions[:daily_limit]:',
      '        sid = str((s or {}).get("id", ""))',
      '        if not sid:',
      '            continue',
      '        text = await ctx.agent.reply(sid, persona)',
      '        if text is None:',
      '            escalated.append(sid)  # 应对不了——升级人工',
      '            continue',
      '        await ctx.im.send(sid, text)',
      '        await ctx.vault.logChat({"uid": sid, "text": text, "echo": True})',
      '        replied.append(sid)',
      '    ctx.log(f"自动回复 {len(replied)} 条，升级 {len(escalated)} 条")',
      '    if replied and not escalated:',
      '        return {"branch": "replied", "replied": replied}',
      '    if escalated:',
      '        return {"branch": "escalated", "replied": replied, "escalated": escalated}',
      '    return {"branch": "replied", "replied": replied}',
    ]),
  },
];

/** 示例资产数（=10——卡面/锚口径常量，断言面；T6-18 前=9） */
export const EXAMPLE_COUNT = EXAMPLE_ASSETS.length;

/** 示例类型集（=asset zip 文件名去 .zip——预装落库后 node_definitions 的 custom 增量面） */
export const EXAMPLE_TYPES: readonly string[] = EXAMPLE_ASSETS.map((a) => a.type);

/** 单包四件套文件组（确定性序：manifest→nodes→scripts→config→deps） */
export interface ExamplePackage {
  /** 入库产物文件名（<type>.zip） */
  zipName: string;
  /** 四件套条目（写入序=字节序——确定性产物前提） */
  files: ZipFileInput[];
}

function depsFileOf(lang: 'python' | 'ts'): { name: string; data: string } {
  return lang === 'python' ? { name: 'deps/requirements.txt', data: PY_DEPS } : { name: 'deps/package.json', data: TS_DEPS };
}

/**
 * 组装单包四件套（发布变体形——01 A-4.03：manifest＋nodes/*.json〔definition 随包〕＋scripts＋
 * config＋deps；nodes 条目={type,name,definition}，export-pipeline 发布变体同口径）。
 */
export function buildExamplePackages(): ExamplePackage[] {
  return EXAMPLE_ASSETS.map((asset) => {
    const def = asset.definition;
    const exec = def.exec!;
    const manifest: PackageManifest = {
      kind: 'node',
      name: def.meta.name,
      summary: def.meta.description?.slice(0, 40),
      version: def.packageVersion,
      scripts: { [def.type]: { file: exec.file, lang: exec.lang, entry: exec.entry } },
    };
    const files: ZipFileInput[] = [
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
      { name: `nodes/${def.meta.name}.json`, data: JSON.stringify({ type: def.type, name: def.meta.name, definition: def }, null, 2) },
      { name: exec.file, data: asset.script },
      ...(asset.config !== undefined && exec.config !== undefined ? [{ name: exec.config, data: asset.config }] : []),
      depsFileOf(exec.lang),
    ];
    return { zipName: `${def.type}.zip`, files };
  });
}

/**
 * 产出 9 zip 到目标目录（gen-examples.mjs 消费；date=ZIP_EPOCH——同输入同字节，content_hash
 * 跨机稳定＝二启零 delta 的幂等前提）。逐包走 ZipWriter 三重自校验（CRC32/伪目录/store 档）。
 */
export async function writeExampleZips(outDir: string): Promise<{ written: number; dir: string }> {
  const writer = createZipWriter();
  await mkdir(outDir, { recursive: true });
  for (const pkg of buildExamplePackages()) {
    await writer.write(pkg.files, path.join(outDir, pkg.zipName), { date: ZIP_EPOCH });
  }
  return { written: EXAMPLE_COUNT, dir: outDir };
}
