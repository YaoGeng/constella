#!/usr/bin/env node
// admin-smoke.mjs —— T6-01（TDD-A-01 §6.4）登录/守卫交互冒烟：playwright-core 无头 Edge 六场景。
//
// 用法：node scripts/admin-smoke.mjs [baseUrl=http://127.0.0.1:8051] [scenario=login|users|reviews|dashboard|package]（仓库根；任意 cwd 均可）
//   无参/缺省＝login 六登录场景（T6-01 兼容）；第二参 users＝用户管理页 a~g 场景（T6-02/TDD-A-02 §6.2）；
//   第二参 reviews＝审核队列页 a~e 场景（T6-03/TDD-A-03 §6.2 a~d＋e 页码回落回归——batch-2 登记③随 T6-04 收口）；
//   第二参 dashboard＝运营看板页 a~d 场景（T6-05/TDD-A-05 §6.2）；
//   第二参 package＝包详情工作台 a~g 场景（T6-04/TDD-A-04 §6.2）
//
// 拓扑（镜像部署标准 §5.3/§8 步 4 生产形态：admin 与 server 同域经反代免 CORS）：
//   无头 Edge → http://127.0.0.1:<ephemeral>/admin/（本脚本自管的静态托管，admin/dist）
//             → /api/* 反代 → <baseUrl>（server）
//
// 服务端自管：healthz 探测——未起则子进程启动 `pnpm -F ./server exec tsx src/index.ts`
//   并注入 ADMIN_EMAIL/ADMIN_PASSWORD（TDD-S-04 §1 AdminSeed env 首建，幂等）；已在跑则复用，
//   复用态若无 admin 账号 → 直插 DB 建号兜底（pg/bcryptjs 经 server 包上下文 resolve；T5-11 先例）。
// USER 测试账号来源：POST /api/auth/register（auth 域公开注册端点，role 默认 USER——TDD-S-01 §1）。
//
// 六场景（§6.4 逐条）：
//   1) 未登录访问 /users → 落地 /login；2) 错误密码 → AUTH-INVALID-CREDENTIALS 文案；
//   3) USER 账号 → 「非管理员」提示且不建会话；4) ADMIN → 落地 /dashboard；
//   5) reload → 静默 refresh 保持登录；6) logout → 回 /login 且 localStorage 键清除。
//
// users 场景（TDD-A-02 §6.2 a~g 逐条；server 默认 pageSize=20 → 补足 ≥21 用户便于翻页）：
//   a) 未登录访问 /users → /login；b) 行数=server items 数、total 正确；c) 搜索（debounce 后）收敛命中行；
//   d) 翻第 2 页 → 请求带 page=2；e) 封禁不填理由=前端必填拦截；填理由提交 → BANNED（对端=目标即时禁登录）；
//   f) 解封 → ACTIVE（对端=目标可再登录）；g) NOT-FOUND 行（DB 删除造失效行）操作 → 提示并自动刷新。
//   批量测试号直插 DB（register 端点限流 10/min——S-01 RATE_LIMIT_RULES，≥20 连续注册必触顶；
//   DB 兜底先例=ensureAdminInDb/T5-11）；交互测试号（target/hit/ghost）仍经 POST /api/auth/register。
//
// reviews 场景（T6-03/TDD-A-03 §6.2 a~d＋e 页码回落回归逐条；测试数据=DB 直插 3 个 PENDING 包——T5-11
//   publish-e2e 落库终态等价形〔Package+PackageVersion+latestVersionId，略去 zip 管线——队列面不触存储〕，
//   固定 id 幂等）：
//   a) 队列行数=server items 数、perms 列渲染 PermTags（六标签预设色）；b) 点「审核」→ URL 变 /packages/:id
//   （详情渲染断言归 A-04 §6）；c) 另一会话（浏览器外独立 admin token）先审掉某包后 goBack 返回本页
//   → 该行消失（无陈旧残留——重挂载重取，staleTime=0 设计值）；d) 清空 pending（经 review 端点 reject，
//   走 server 状态机留 ReviewRecord）→ QueueEmptyState「队列已清空」＋手动刷新渲染；
//   e) 页码回落（batch-2 登记③ MINOR 随 T6-04 收口）：直插 22 个 pending（两页）→ 他会话清短至 1 →
//   停留页面点陈旧分页第 2 页（server 返回空 items/total=1）→ 回落有效末页重取出行、误「已清空」消除。
//
// dashboard 场景（T6-05/TDD-A-05 §6.2 a~d 逐条；测试数据=DB 直插 1 个 PENDING 包〔c 场景 pendingCount
//   非零基线，固定 id 幂等〕＋DownloadStat 今日 2 下 1 装/昨日 1 下 2 装〔「2 天有量+5 天空」；id 按日确定性
//   生成——重跑同日幂等、跨日窗口自滚动，ts=UTC 日正午与 StatsService UTC 日界聚合同口径，admin.test §6.1d
//   先例；空日补零=server 职责，UI 零高直绘——空桶对账以 server 真值为准，免疫环境残留行〕）：
//   a) 登录落地 /dashboard，五卡值=overview 响应五字段；b) 趋势图 14 柱 7 桶、空日零高（逐桶对账 server daily7d）；
//   c) pendingCount 卡点击 → /reviews，列表计数与 pendingCount 对账；d) console 断言无 [antd: Statistic]
//   valueStyle 弃用告警（S-8 告警复测——页面交互全程采集）。
//
// package 场景（T6-04/TDD-A-04 §6.2 a~g 逐条；测试数据=DB 直插作者号＋四包——A/B/C PENDING 起步、D 直插
//   APPROVED〔四状态经推进全覆盖：通过/驳回/并发 409/下架〕，固定 id 幂等＋重跑重置种子状态；A 含
//   manifest.scripts 双脚本＋双版本＋非零计量＋真实 zip 落盘〔storageKey=packages/<id>/<semver>.zip——
//   g 解包校验用，jszip 经 client 包 resolve〕；清扫=ownerUserId 全量两轮删除〔market-*.test.ts afterAll 先例〕）：
//   a) 从 /reviews 行「审核」跳入 → 七分区渲染齐全（元数据/perms/manifest 摘要/脚本清单/版本/计量/动作区，
//      内容对 server 真值逐项对账）；b) PENDING「通过」→ 跳回 /reviews 且出队；c) 驳回不填理由=前端必填拦截
//   （零请求）；填理由 → REJECTED 只读（停留本页）；d) 并发 409：A 会话（API 直审）通过后 B 会话（页面）驳回
//   → 「已被其他管理员处理」＋失效重取刷成 APPROVED 态（下架动作出现/驳回入口消失）；e) APPROVED「下架」
//   填理由 → OFFLINE 只读终态；f) OFFLINE/REJECTED 页无动作区；g) 下载预检 → <semver>.zip 且本地解包可读。
//
// 退出码：所选场景全绿 exit 0；任一失败 exit 1（逐场景 [ok]/[fail]）。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminDir = path.join(repoRoot, 'admin');
const serverDir = path.join(repoRoot, 'server');
const clientDir = path.join(repoRoot, 'client');

// playwright-core 是 client devDep（T0-05 锁版 1.65.0）——经 client 包上下文 resolve
// （scripts/canvas-e2e.mjs L22-24 同款先例）
const requireFromClient = createRequire(path.join(clientDir, 'package.json'));
const { chromium } = requireFromClient('playwright-core');

// —— 冒烟测试账号（确定性凭据；ADMIN_* env 注入由本脚本负责——AdminSeed 幂等）——
const ADMIN_EMAIL = 'smoke-admin@constella.test';
const ADMIN_PASSWORD = 'smoke-admin-pass';
const USER_EMAIL = 'smoke-user@constella.test';
const USER_PASSWORD = 'smoke-user-pass';
const REFRESH_KEY = 'constella.admin.refreshToken';

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '[ok]' : '[fail]'} ${name}${detail ? ` —— ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 基础设施：server 探测/拉起/建号 ——————————————————————————————

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 体 */
  }
  return { status: res.status, body };
}

function postJson(url, payload) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function probeHealthz(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 读取 server/.env 的 DATABASE_URL（复用态直插 DB 建号兜底用） */
function serverDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(serverDir, '.env');
  if (!existsSync(envPath)) return null;
  const m = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(readFileSync(envPath, 'utf8'));
  return m ? m[1] : null;
}

/** 直插 DB 建 ADMIN 号（T5-11 先例；pg/bcryptjs 经 server 包上下文 resolve，不引入新依赖） */
async function ensureAdminInDb() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const bcryptMod = requireFromServer('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", role, "isAuthor", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ADMIN', false, 'ACTIVE', now(), now())
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), ADMIN_EMAIL, hash],
    );
  } finally {
    await client.end();
  }
}

async function adminLoginOk(baseUrl) {
  const r = await postJson(`${baseUrl}/api/auth/login`, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return r.status === 200;
}

/**
 * server 自管：healthz 未起 → 子进程拉起（注入 ADMIN_* env——AdminSeed 幂等首建；PORT 对齐 baseUrl）；
 * 已起 → 复用（若无 admin 账号 → DB 建号兜底后重试）。
 * @returns {{ stop(): void, spawned: boolean }}
 */
async function ensureServer(baseUrl) {
  const port = String(new URL(baseUrl).port || '80');
  if (await probeHealthz(baseUrl)) {
    console.log(`[setup] server: 复用已运行 ${baseUrl}`);
    if (await adminLoginOk(baseUrl)) {
      console.log('[setup] admin seed: 已可登录（复用实例）');
      return { stop() {}, spawned: false };
    }
    console.log('[setup] 复用实例无 admin 账号 → 直插 DB 建号（pg 兜底）');
    await ensureAdminInDb();
    if (await adminLoginOk(baseUrl)) {
      console.log('[setup] admin seed: DB 建号后可登录');
      return { stop() {}, spawned: false };
    }
    throw new Error('复用的 server 无法以冒烟凭据登录 admin（DB 兜底后仍失败——检查 DATABASE_URL 指向）');
  }

  console.log(`[setup] server: 子进程拉起（PORT=${port}，ADMIN_* env 注入——AdminSeed 幂等）`);
  const child = spawn('pnpm', ['-F', './server', 'exec', 'tsx', 'src/index.ts'], {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ADMIN_EMAIL, ADMIN_PASSWORD, PORT: port },
  });
  const logTail = [];
  const drain = (buf) => {
    logTail.push(buf.toString());
    if (logTail.length > 40) logTail.shift();
  };
  child.stdout.on('data', drain);
  child.stderr.on('data', drain);

  const stop = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  };

  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      console.error(logTail.join(''));
      throw new Error(`server 子进程提前退出（code=${child.exitCode}）——输出见上`);
    }
    if (await probeHealthz(baseUrl)) break;
    await sleep(1000);
    if (i === 59) {
      stop();
      console.error(logTail.join(''));
      throw new Error('server 60s 内未就绪（healthz 不通）——输出见上');
    }
  }
  // seed 在 listen 前完成；login 重试兜底（隧道 DB 冷启动抖动）
  for (let i = 0; i < 10 && !(await adminLoginOk(baseUrl)); i++) {
    await sleep(1000);
  }
  if (!(await adminLoginOk(baseUrl))) {
    stop();
    throw new Error('ADMIN 种子账号登录失败（AdminSeed env 注入未生效）');
  }
  console.log('[setup] admin seed: login OK（env 注入 AdminSeed）');
  return { stop, spawned: true };
}

/** USER 测试账号：公开注册端点（TDD-S-01 §1 register，role 默认 USER）；409=已存在（幂等重跑） */
async function ensureUserAccount(baseUrl) {
  const r = await postJson(`${baseUrl}/api/auth/register`, { email: USER_EMAIL, password: USER_PASSWORD });
  if (r.status === 201) {
    console.log('[setup] user 账号: 经 /api/auth/register 注册（来源=公开注册端点）');
  } else if (r.status === 409) {
    console.log('[setup] user 账号: 已存在（上次运行注册，409 幂等）');
  } else {
    throw new Error(`user 注册失败：HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
}

// —— 基础设施：静态托管 + /api 反代（同域免 CORS，镜像生产反代形态） ——————————

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function proxyToServer(req, res, target, url) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    if (body.length > 0) headers['content-length'] = String(body.length);
    const preq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: url.pathname + url.search,
        headers,
      },
      (pres) => {
        const rchunks = [];
        pres.on('data', (c) => rchunks.push(c));
        pres.on('end', () => {
          const rbody = Buffer.concat(rchunks);
          const rheaders = { ...pres.headers };
          delete rheaders['transfer-encoding'];
          delete rheaders.connection;
          rheaders['content-length'] = String(rbody.length);
          res.writeHead(pres.statusCode ?? 502, rheaders);
          res.end(rbody);
        });
      },
    );
    preq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL', message: `proxy: ${err.message}` } }));
    });
    preq.end(body);
  });
}

function startStaticHost(distDir, serverBaseUrl) {
  const target = new URL(serverBaseUrl);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    if (p === '/api' || p.startsWith('/api/')) {
      proxyToServer(req, res, target, url);
      return;
    }
    if (p === '/' || p === '/admin') {
      res.writeHead(301, { Location: '/admin/' });
      res.end();
      return;
    }
    if (p === '/admin/' || p.startsWith('/admin/')) {
      const rel = decodeURIComponent(p.slice('/admin/'.length));
      let filePath = path.normalize(path.join(distDir, rel === '' ? 'index.html' : rel));
      if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html'); // SPA fallback（S-8 实测套路）
      }
      const body = readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

// —— 六场景（§6.4 逐条） ——————————————————————————————————————

async function fillLoginAndSubmit(page, email, password) {
  await page.getByPlaceholder('admin@example.com').fill(email);
  await page.getByPlaceholder('至少 8 位').fill(password);
  await page.getByTestId('login-submit').click();
}

async function scenario1GuardRedirect(page, origin) {
  await page.goto(`${origin}/admin/users`);
  await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
  await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
  report('S1 未登录访问 /users → 落地 /login', true, `url=${page.url()}`);
}

async function scenario2WrongPassword(page, origin) {
  await fillLoginAndSubmit(page, ADMIN_EMAIL, 'wrong-password');
  await page.getByText('AUTH-INVALID-CREDENTIALS').waitFor({ timeout: 15000 });
  report('S2 错误密码 → AUTH-INVALID-CREDENTIALS 文案', true, '错误 Alert 展示 code 原文');
}

async function scenario3UserRejected(page) {
  await fillLoginAndSubmit(page, USER_EMAIL, USER_PASSWORD);
  await page.getByText('非管理员').waitFor({ timeout: 15000 });
  const storage = await page.evaluate((k) => window.localStorage.getItem(k), REFRESH_KEY);
  const onLogin = /\/admin\/login$/.test(page.url());
  const ok = storage === null && onLogin;
  report('S3 USER 账号 → 「非管理员」提示且不建会话', ok, `storage=${storage} url=${page.url()}`);
}

async function scenario4AdminLogin(page) {
  await fillLoginAndSubmit(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15000 });
  await page.getByText('运营看板').waitFor({ timeout: 15000 });
  report('S4 ADMIN → 落地 /dashboard', true, `url=${page.url()}`);
}

async function scenario5ReloadSilentRefresh(page) {
  await page.reload();
  await page.getByText('运营看板').waitFor({ timeout: 15000 });
  const storage = await page.evaluate((k) => window.localStorage.getItem(k), REFRESH_KEY);
  const onDashboard = /\/admin\/dashboard$/.test(page.url());
  const ok = onDashboard && typeof storage === 'string' && storage.length > 0;
  report('S5 reload → 静默 refresh 保持登录', ok, `url=${page.url()} refreshKey=${storage ? '已覆写留存' : '丢失'}`);
}

async function scenario6Logout(page) {
  await page.getByTestId('logout').click();
  await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
  const storage = await page.evaluate((k) => window.localStorage.getItem(k), REFRESH_KEY);
  const ok = storage === null;
  report('S6 logout → 回 /login 且 localStorage 键清除', ok, `url=${page.url()} storage=${storage}`);
}

// —— users 场景（T6-02/TDD-A-02 §6.2 a~g）—————————————————————

// 批量测试号（22 个：admin+smoke-user+22+3 交互号 ≥ 21 → server 默认 pageSize=20 下第 2 页有行）
const USERS_BULK_COUNT = 22;
const USERS_BULK_EMAILS = Array.from(
  { length: USERS_BULK_COUNT },
  (_, i) => `t602-bulk-${String(i + 1).padStart(2, '0')}@constella.test`,
);
const USERS_TARGET_EMAIL = 't602-target@constella.test'; // e/f 封禁/解封目标（USER 测试号，勿封 ADMIN）
const USERS_HIT_EMAIL = 't602-hit@constella.test'; // c 搜索命中号（邮箱前缀唯一）
const USERS_GHOST_EMAIL = 't602-ghost@constella.test'; // g 失效行号（注册后经 DB 删除造 NOT-FOUND）
const USERS_PASSWORD = 't602-password'; // register 端点 min 8（TDD-S-01 registerSchema）

/** 交互测试号经公开注册端点（201/409 幂等——与 ensureUserAccount 同款口径） */
async function ensureRegistered(baseUrl, email) {
  const r = await postJson(`${baseUrl}/api/auth/register`, { email, password: USERS_PASSWORD });
  if (r.status !== 201 && r.status !== 409) {
    throw new Error(`注册失败 ${email}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
}

/** 批量 USER 测试号直插 DB（register 限流 10/min 触顶 → DB 兜底，先例=ensureAdminInDb/T5-11；幂等） */
async function ensureBulkUsersInDb() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const bcryptMod = requireFromServer('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash(USERS_PASSWORD, 10);
    for (const email of USERS_BULK_EMAILS) {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", role, "isAuthor", status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'USER', false, 'ACTIVE', now(), now())
         ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), email, hash],
      );
    }
  } finally {
    await client.end();
  }
}

/** g 场景造失效行：DB 删除用户（ghost 号无包/无会话——FK 无挂碍） */
async function deleteUserByEmail(email) {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DELETE FROM "User" WHERE email = $1', [email]);
  } finally {
    await client.end();
  }
}

/** ReasonModal 提交（OK）按钮：antd v6 对两字中文按钮自动插入空格（可访问名=「提 交」），
 *  name 匹配不可靠 → 固定走弹窗主按钮类选择器（Popconfirm 非 .ant-modal，无歧义） */
async function clickModalOk(page) {
  const ok = page.locator('.ant-modal .ant-btn-primary');
  await ok.waitFor({ timeout: 10000 });
  await ok.click();
}

/** b 场景 server 真值对账用：ADMIN 登录换 access token（计入 login 限流 10/min，本块合计 ≤5 发） */
async function adminAccessToken(baseUrl) {
  const r = await postJson(`${baseUrl}/api/auth/login`, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login 失败：HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

function adminApiGet(baseUrl, token, pathname) {
  return fetchJson(`${baseUrl}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** users 场景 a~g 主流程（顺序依赖：a 登录态 → b 基线 → c~d 列表行为 → e~f 目标号状态翻转 → g 失效行） */
async function runUsersScenarios(page, origin, baseUrl) {
  // —— 数据自备：批量号（DB）＋交互号（register 端点）——
  await ensureBulkUsersInDb();
  console.log(`[setup] users 批量号: 直插 DB ${USERS_BULK_COUNT} 个（register 限流 10/min，DB 兜底先例）`);
  for (const email of [USERS_TARGET_EMAIL, USERS_HIT_EMAIL, USERS_GHOST_EMAIL]) {
    await ensureRegistered(baseUrl, email);
  }
  console.log('[setup] users 交互号: target/hit/ghost 经 /api/auth/register（201/409 幂等）');
  const token = await adminAccessToken(baseUrl);

  // a) 未登录访问 /users → 重定向 /login
  await page.goto(`${origin}/admin/users`);
  await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
  await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
  report('a) 未登录访问 /users → 重定向 /login', true, `url=${page.url()}`);

  // 登录 ADMIN 并整页打开 /users（bootstrap 静默续期路径）
  await fillLoginAndSubmit(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15000 });
  await page.goto(`${origin}/admin/users`);
  await page.getByTestId('users-total').waitFor({ timeout: 15000 });

  // b) 行数=server items 数、total 正确（对端真值对账）
  const truth = await adminApiGet(baseUrl, token, '/api/admin/users?page=1');
  const rowCount = await page.locator('tr.ant-table-row').count();
  const totalText = ((await page.getByTestId('users-total').textContent()) ?? '').trim();
  const bOk =
    truth.status === 200 && rowCount === truth.body.items.length && totalText === `共 ${truth.body.total} 个用户`;
  report(
    'b) 行数=server items 数、total 正确',
    bOk,
    `rows=${rowCount}/items=${truth.body?.items?.length} UI「${totalText}」/ server=${truth.body?.total}`,
  );

  // c) 搜索 seed 邮箱前缀（debounce 300ms 后）→ 收敛命中行
  await page.getByTestId('users-search').fill('t602-hit');
  await page.waitForFunction(() => document.querySelectorAll('tr.ant-table-row').length === 1, null, {
    timeout: 10000,
  });
  const hitRowText = (await page.locator('tr.ant-table-row').first().textContent()) ?? '';
  report('c) 搜索（debounce 后）收敛命中行', /t602-hit@constella\.test/.test(hitRowText), hitRowText.slice(0, 50));

  // d) 翻第 2 页 → 请求带 page=2
  await page.getByTestId('users-search').fill('');
  await page.waitForFunction(() => document.querySelectorAll('tr.ant-table-row').length > 1, null, {
    timeout: 10000,
  });
  const sawPage2 = page.waitForRequest((req) => /\/api\/admin\/users\?page=2$/.test(req.url()), { timeout: 10000 });
  await page.locator('.ant-pagination-item-2').click();
  const page2Req = await sawPage2;
  report('d) 翻第 2 页 → 请求带 page=2', true, page2Req.url());

  // e) 封禁：不填理由=前端必填拦截（零请求）；填理由提交 → BANNED＋对端即时禁登录
  await page.getByTestId('users-search').fill('t602-target');
  await page.waitForFunction(() => document.querySelectorAll('tr.ant-table-row').length === 1, null, {
    timeout: 10000,
  });
  const targetRow = page.locator('tr.ant-table-row').first();
  const targetId = await targetRow.getAttribute('data-row-key');
  let banPosts = 0;
  const countBanPost = (req) => {
    if (req.method() === 'POST' && /\/api\/admin\/users\/[^/]+\/ban$/.test(req.url())) banPosts += 1;
  };
  page.on('request', countBanPost);
  await targetRow.getByRole('button', { name: '封禁' }).click();
  await page.locator('.ant-modal .ant-btn-primary').waitFor({ timeout: 10000 });
  await clickModalOk(page); // 空理由提交
  await page.getByText('理由不能为空').waitFor({ timeout: 10000 });
  await sleep(700); // 越过 debounce/渲染窗口，确证必填拦截零请求
  page.off('request', countBanPost);
  const intercepted = banPosts === 0;
  await page.getByPlaceholder('请输入理由（必填，将随操作留痕）').fill('smoke-ban-reason');
  await clickModalOk(page);
  await page.locator(`tr[data-row-key="${targetId}"]`).getByText('已封禁').waitFor({ timeout: 10000 });
  const bannedLogin = await postJson(`${baseUrl}/api/auth/login`, {
    email: USERS_TARGET_EMAIL,
    password: USERS_PASSWORD,
  });
  const eOk =
    intercepted &&
    bannedLogin.status === 401 &&
    bannedLogin.body?.error?.code === 'ADMIN-USER-BANNED';
  report(
    'e) 封禁必填拦截＋状态转 BANNED＋目标即时禁登录',
    eOk,
    `前端拦截=${intercepted}（空理由 ban POST=${banPosts}）；目标 login=${bannedLogin.status}/${bannedLogin.body?.error?.code}`,
  );

  // f) 解封（Popconfirm）→ status 回 ACTIVE＋对端可再登录
  await page.locator(`tr[data-row-key="${targetId}"]`).getByRole('button', { name: '解封', exact: true }).click();
  await page.getByText('确认解封该用户？').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '确认解封', exact: true }).click();
  await page.locator(`tr[data-row-key="${targetId}"]`).getByText('正常').waitFor({ timeout: 10000 });
  const unbanLogin = await postJson(`${baseUrl}/api/auth/login`, {
    email: USERS_TARGET_EMAIL,
    password: USERS_PASSWORD,
  });
  report(
    'f) 解封 → status 回 ACTIVE＋目标可再登录',
    unbanLogin.status === 200,
    `目标 login=${unbanLogin.status}`,
  );

  // g) NOT-FOUND 行（DB 删除造失效行）操作 → 提示并自动刷新（失效行消失）
  await page.getByTestId('users-search').fill('t602-ghost');
  await page.waitForFunction(() => document.querySelectorAll('tr.ant-table-row').length === 1, null, {
    timeout: 10000,
  });
  await deleteUserByEmail(USERS_GHOST_EMAIL);
  await page.locator('tr.ant-table-row').first().getByRole('button', { name: '封禁' }).click();
  await page.locator('.ant-modal .ant-btn-primary').waitFor({ timeout: 10000 });
  await page.getByPlaceholder('请输入理由（必填，将随操作留痕）').fill('ghost-row-reason');
  await clickModalOk(page);
  await page.getByText('NOT-FOUND', { exact: false }).first().waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('tr.ant-table-row').length === 0, null, {
    timeout: 10000,
  });
  report('g) NOT-FOUND 行操作 → 提示并自动刷新', true, 'message=NOT-FOUND 展示，列表重取后失效行消失');
}

// —— reviews 场景（T6-03/TDD-A-03 §6.2 a~d）—————————————————————

// 测试数据：固定 UUID 幂等（Package.name 无唯一约束——ON CONFLICT (id) 定位；重跑前重置回 PENDING）
const REVIEWS_AUTHOR_ID = '11111111-6030-4000-8000-0000000000a1';
const REVIEWS_AUTHOR_EMAIL = 't603-author@constella.test'; // owner（队列 owner 聚合依赖；DB 直插，不占注册限流）
/** 3 个 pending 包：A=六标签全量（a 场景六预设色断言）/ B=他会话审掉（c）/ C=空 perms（PermTags 空态分支） */
const REVIEW_PKGS = [
  {
    id: '11111111-6030-4000-8000-0000000000b1',
    versionId: '11111111-6030-4000-8000-0000000000b2',
    kind: 'NODE',
    name: 'T603 队列包A（六权限）',
    summary: 'smoke 六标签预设色断言用',
    perms: ['CDP', '网络', '文件', 'AI', '交互', '社媒'],
    sizeBytes: 2048,
    semver: '1.0.0',
  },
  {
    id: '11111111-6030-4000-8000-0000000000c1',
    versionId: '11111111-6030-4000-8000-0000000000c2',
    kind: 'PACK',
    name: 'T603 队列包B（他会话审掉）',
    summary: 'smoke 无陈旧残留断言用',
    perms: ['文件'],
    sizeBytes: 1048576,
    semver: '0.2.0',
  },
  {
    id: '11111111-6030-4000-8000-0000000000d1',
    versionId: '11111111-6030-4000-8000-0000000000d2',
    kind: 'FLOW',
    name: 'T603 队列包C（空权限）',
    summary: null,
    perms: [],
    sizeBytes: 10,
    semver: '2.1.3',
  },
];

/** DB 直插 pending 包（T5-11 publish-e2e 落库终态等价形；幂等=固定 id＋重置 PENDING——上一轮
 *  approve/reject 后可重跑；「直改库」先例=publish-e2e ⑤，队列面不触存储故略去 zip 对象） */
async function seedReviewQueue() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const bcryptMod = requireFromServer('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash('t603-author-pass', 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", role, "isAuthor", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'USER', true, 'ACTIVE', now(), now())
       ON CONFLICT (email) DO NOTHING`,
      [REVIEWS_AUTHOR_ID, REVIEWS_AUTHOR_EMAIL, hash],
    );
    for (const p of REVIEW_PKGS) {
      await client.query(
        `INSERT INTO "Package" (id, kind, name, summary, "ownerUserId", status, perms,
           "downloadCount", "installCount", "starCount", "createdAt", "updatedAt")
         VALUES ($1, $2::"PackageKind", $3, $4, $5, 'PENDING', $6::text[], 0, 0, 0, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.kind, p.name, p.summary, REVIEWS_AUTHOR_ID, p.perms],
      );
      await client.query(
        `INSERT INTO "PackageVersion" (id, "packageId", semver, "storageKey", checksum, "sizeBytes", manifest, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [
          p.versionId,
          p.id,
          p.semver,
          `smoke/${p.id}/${p.semver}.zip`,
          `sha256:${'0'.repeat(64)}`,
          p.sizeBytes,
          JSON.stringify({ name: p.name }),
        ],
      );
      // 重置回 PENDING＋回填 latestVersion 指针（queue 过滤 latestVersionId 非空——S-03 ReviewQueueService）
      await client.query(
        `UPDATE "Package" SET status = 'PENDING', "latestVersionId" = $2, "updatedAt" = now() WHERE id = $1`,
        [p.id, p.versionId],
      );
    }
  } finally {
    await client.end();
  }
}

// e 场景批量包（22 个＝两页；id 末段 100000000000+i＝12 位数字 hex 合式、按序确定——重跑幂等）
const REVIEWS_FALLBACK_COUNT = 22;
const reviewsFallbackPkgId = (i) => `33333330-6030-4000-8000-${String(100000000000 + i)}`;
const reviewsFallbackVersionId = (i) => `33333331-6030-4000-8000-${String(100000000000 + i)}`;

/** e 场景数据：22 个 pending 包直插（d 清空后第二批；seedReviewQueue 同款形——重置 PENDING＋回填指针） */
async function seedReviewsFallbackBulk() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (let i = 0; i < REVIEWS_FALLBACK_COUNT; i++) {
      const id = reviewsFallbackPkgId(i);
      await client.query(
        `INSERT INTO "Package" (id, kind, name, summary, "ownerUserId", status, perms,
           "downloadCount", "installCount", "starCount", "createdAt", "updatedAt")
         VALUES ($1, 'PACK', $2, 'smoke 页码回落用', $3, 'PENDING', '{}'::text[], 0, 0, 0, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [id, `T603 回落包${String(i + 1).padStart(2, '0')}`, REVIEWS_AUTHOR_ID],
      );
      await client.query(
        `INSERT INTO "PackageVersion" (id, "packageId", semver, "storageKey", checksum, "sizeBytes", manifest, "createdAt")
         VALUES ($1, $2, '1.0.0', $3, $4, 10, '{}'::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [reviewsFallbackVersionId(i), id, `smoke/${id}/1.0.0.zip`, `sha256:${'0'.repeat(64)}`],
      );
      await client.query(
        `UPDATE "Package" SET status = 'PENDING', "latestVersionId" = $2, "updatedAt" = now() WHERE id = $1`,
        [id, reviewsFallbackVersionId(i)],
      );
    }
  } finally {
    await client.end();
  }
}

/** 「另一会话」直审 POST（独立 admin token——浏览器会话之外的第二管理员会话，c/d 场景用） */
function adminApiPost(baseUrl, token, pathname, payload) {
  return fetchJson(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

/** reviews 场景 a~d 主流程（顺序依赖：a 基线 → b 进详情 → c 他会话审掉+goBack 返回 → d 清空队列空态） */
async function runReviewsScenarios(page, origin, baseUrl) {
  // —— 数据自备：3 个 pending 包（DB 直插，固定 id 幂等，重跑重置 PENDING）——
  await seedReviewQueue();
  console.log('[setup] reviews 测试包: DB 直插 3 个 PENDING（六标签/单标签/空 perms；kind=node/pack/flow 各一）');
  const token = await adminAccessToken(baseUrl); // 「另一会话」凭据（c/d 场景 API 直审）

  // 前置：登录 ADMIN 并整页打开 /reviews（未登录守卫已由 login/users 场景覆盖，不重复立场景）
  await page.goto(`${origin}/admin/reviews`);
  await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
  await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
  await fillLoginAndSubmit(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15000 });
  await page.goto(`${origin}/admin/reviews`);
  await page.getByTestId('reviews-total').waitFor({ timeout: 15000 });

  // a) 队列行数=server items 数、perms 列渲染 PermTags（六标签预设色——对端真值对账）
  const truth = await adminApiGet(baseUrl, token, '/api/admin/reviews?status=pending&page=1');
  const rowCount = await page.locator('tr.ant-table-row').count();
  const totalText = ((await page.getByTestId('reviews-total').textContent()) ?? '').trim();
  const pkgARow = page.locator(`tr[data-row-key="${REVIEW_PKGS[0].id}"]`);
  const permClasses = await pkgARow.evaluate((el) =>
    Array.from(el.querySelectorAll('.ant-tag')).map((t) => t.className),
  );
  const SIX_PERM_COLORS = ['purple', 'geekblue', 'gold', 'magenta', 'cyan', 'green']; // PermTags 六预设色
  const permOk = SIX_PERM_COLORS.every((c) => permClasses.some((cn) => cn.includes(`ant-tag-${c}`)));
  const aOk =
    truth.status === 200 &&
    rowCount === truth.body.items.length &&
    totalText === `待审 ${truth.body.total} 个包` &&
    permOk;
  report(
    'a) 队列行数=server items 数、perms 列 PermTags 六标签预设色',
    aOk,
    `rows=${rowCount}/items=${truth.body?.items?.length} UI「${totalText}」/ server=${truth.body?.total} 六色=${permOk}`,
  );

  // b) 点「审核」→ URL 变 /packages/:id（详情渲染断言归 A-04 §6——本卡只证路由跳转）
  await pkgARow.getByRole('button', { name: '审核' }).click();
  await page.waitForURL(new RegExp(`/admin/packages/${REVIEW_PKGS[0].id}$`), { timeout: 15000 });
  report('b) 点「审核」→ URL 变 /packages/:id', true, `url=${page.url()}`);

  // c) 另一会话先审掉某包（API 直审 approve=200）后返回本页 → 该行消失（无陈旧残留）。
  //    返回=goBack 客户端路由回退 → ReviewsPage 重挂载触发重取（A-03 §1 staleTime=0 设计值验证点）
  const totalBefore = truth.body.total;
  const decided = await adminApiPost(baseUrl, token, `/api/admin/packages/${REVIEW_PKGS[1].id}/review`, {
    action: 'approve',
  });
  await page.goBack();
  await page.waitForURL(/\/admin\/reviews$/, { timeout: 15000 });
  await page.locator(`tr[data-row-key="${REVIEW_PKGS[1].id}"]`).waitFor({ state: 'detached', timeout: 10000 });
  const bRowGone = (await page.locator(`tr[data-row-key="${REVIEW_PKGS[1].id}"]`).count()) === 0;
  const aRowStill = (await page.locator(`tr[data-row-key="${REVIEW_PKGS[0].id}"]`).count()) === 1;
  const totalTextAfter = ((await page.getByTestId('reviews-total').textContent()) ?? '').trim();
  const cOk =
    decided.status === 200 && bRowGone && aRowStill && totalTextAfter === `待审 ${totalBefore - 1} 个包`;
  report(
    'c) 另一会话审掉后返回 → 该行消失（无陈旧残留）',
    cOk,
    `另一会话 approve=${decided.status}；B 行${bRowGone ? '已消失' : '残留'}；A 行仍在=${aRowStill}；UI「${totalTextAfter}」`,
  );

  // d) 空队列 → QueueEmptyState 渲染。
  //    清空=剩余 pending（含历史遗留）全经「另一会话」review 端点 reject——走 server 状态机留 ReviewRecord，
  //    非直改库；逐页循环至队列空（每轮至少消化 page1 全部）
  for (let round = 0; round < 50; round++) {
    const rest = await adminApiGet(baseUrl, token, '/api/admin/reviews?status=pending&page=1');
    const items = rest.body?.items ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      await adminApiPost(baseUrl, token, `/api/admin/packages/${it.packageId}/review`, {
        action: 'reject',
        reason: 'smoke 清空队列（T6-03 d 场景）',
      });
    }
  }
  await page.goto(`${origin}/admin/reviews`); // 整页重开 → 空态
  await page.getByTestId('reviews-empty').waitFor({ timeout: 15000 });
  await page.getByText('队列已清空').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '手动刷新' }).click(); // 手动刷新可点且重取后仍空态
  await page.getByTestId('reviews-empty').waitFor({ timeout: 15000 });
  report('d) 空队列 → QueueEmptyState 渲染（含手动刷新）', true, '「队列已清空」＋手动刷新重取仍空态');

  // e) 页码回落（batch-2 登记③ MINOR 随 T6-04 收口）：直插 22 个 pending（两页）→ 他会话清短至 1 →
  //    停留页面点陈旧分页第 2 页（server 返回空 items/total=1）→ 回落有效末页重取出行；「已清空」空态
  //    仅在真无数据（total=0）时显示——d 已覆盖 total=0 分支，本条覆盖「超末页非空」分支
  await seedReviewsFallbackBulk();
  await page.goto(`${origin}/admin/reviews`);
  await page.getByTestId('reviews-total').waitFor({ timeout: 15000 });
  await page.locator('.ant-pagination-item-2').waitFor({ timeout: 15000 }); // 22 行 → 两页分页可见
  const fallbackIds = Array.from({ length: REVIEWS_FALLBACK_COUNT }, (_, i) => reviewsFallbackPkgId(i));
  for (const id of fallbackIds.slice(1)) {
    // 22 个只留 1（确定性按本批固定 id reject——走 server 状态机留痕）
    await adminApiPost(baseUrl, token, `/api/admin/packages/${id}/review`, {
      action: 'reject',
      reason: 'smoke 页码回落清短（T6-03 e 场景）',
    });
  }
  // 页面仍持陈旧 total（分页第 2 页可点）→ 请求超末页：items=[]/total=1 → 回落第 1 页重取出 1 行
  await page.locator('.ant-pagination-item-2').click();
  await page.waitForFunction(
    () => {
      const active = document.querySelector('.ant-pagination-item-active');
      return active?.textContent?.trim() === '1' && document.querySelectorAll('tr.ant-table-row').length > 0;
    },
    null,
    { timeout: 15000 },
  );
  const falseEmptyGone = (await page.getByTestId('reviews-empty').count()) === 0;
  report(
    'e) 页码回落：停超末页回落有效末页、误「已清空」消除',
    falseEmptyGone,
    '清短 22→1 后点第 2 页=空 items/total=1 → 回落第 1 页行渲染（空态未误显）',
  );
}

// —— dashboard 场景（T6-05/TDD-A-05 §6.2 a~d）—————————————————————

// 测试数据（固定 id/按日确定性 id 幂等）：作者号＋PENDING 包 1 个＋DownloadStat 6 行（今日/昨日各有量）
const DASH_AUTHOR_ID = '11111111-6050-4000-8000-0000000000a1';
const DASH_AUTHOR_EMAIL = 't605-author@constella.test'; // DB 直插，不占注册限流（reviews 场景同款口径）
const DASH_PKG_ID = '11111111-6050-4000-8000-0000000000e1'; // PENDING 包（c 场景 pendingCount 非零基线）
const DASH_PKG_VERSION_ID = '11111111-6050-4000-8000-0000000000e2';

/** UTC 日键 'YYYY-MM-DD'（与 StatsService.utcDayKey 同口径——ISO 前 10 位） */
function utcDayKey(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** DownloadStat 行：今日 2 下 1 装、昨日 1 下 2 装（§6.2「2 天有量+5 天空」） */
const DASH_STAT_ROWS = [
  { day: 0, seq: '01', type: 'DOWNLOAD' },
  { day: 0, seq: '02', type: 'DOWNLOAD' },
  { day: 0, seq: '03', type: 'INSTALL' },
  { day: -1, seq: '04', type: 'DOWNLOAD' },
  { day: -1, seq: '05', type: 'INSTALL' },
  { day: -1, seq: '06', type: 'INSTALL' },
];

/**
 * DB 直插看板测试数据（幂等）：
 * - PENDING 包＝T5-11 publish-e2e 落库终态等价形（reviews 场景 seedReviewQueue 同款——略去 zip 管线），
 *   downloadCount/installCount 给非零基线 7/5（计数器真值在 Package，02 §7.2——五卡对账仍以 server 真值为准）；
 * - DownloadStat：id 末 12 位=00+YYYYMMDD+序号（十进制日期数字=合法 hex；按日确定性——重跑同日幂等，
 *   跨日窗口自滚动不残留膨胀）；ts=UTC 日正午字符串（date_trunc 日界确定，免疫会话时区渲染）。
 */
async function seedDashboardData() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const bcryptMod = requireFromServer('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash('t605-author-pass', 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", role, "isAuthor", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'USER', true, 'ACTIVE', now(), now())
       ON CONFLICT (email) DO NOTHING`,
      [DASH_AUTHOR_ID, DASH_AUTHOR_EMAIL, hash],
    );
    await client.query(
      `INSERT INTO "Package" (id, kind, name, summary, "ownerUserId", status, perms,
         "downloadCount", "installCount", "starCount", "createdAt", "updatedAt")
       VALUES ($1, 'PACK', 'T605 看板待审包', 'smoke pendingCount 对账用', $2, 'PENDING', '{}'::text[], 7, 5, 0, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [DASH_PKG_ID, DASH_AUTHOR_ID],
    );
    await client.query(
      `INSERT INTO "PackageVersion" (id, "packageId", semver, "storageKey", checksum, "sizeBytes", manifest, "createdAt")
       VALUES ($1, $2, '1.0.0', $3, $4, 2048, '{}'::jsonb, now())
       ON CONFLICT (id) DO NOTHING`,
      [DASH_PKG_VERSION_ID, DASH_PKG_ID, `smoke/${DASH_PKG_ID}/1.0.0.zip`, `sha256:${'0'.repeat(64)}`],
    );
    // 重置回 PENDING＋回填 latestVersion 指针（上一轮被 reviews 场景清空队列 reject 后可重跑）
    await client.query(
      `UPDATE "Package" SET status = 'PENDING', "latestVersionId" = $2, "updatedAt" = now() WHERE id = $1`,
      [DASH_PKG_ID, DASH_PKG_VERSION_ID],
    );
    for (const row of DASH_STAT_ROWS) {
      const dayKeyDigits = utcDayKey(row.day).replace(/-/g, ''); // YYYYMMDD（8 位十进制数字）
      await client.query(
        `INSERT INTO "DownloadStat" (id, "packageId", "type", "ts")
         VALUES ($1, $2, $3::"StatType", $4::timestamp)
         ON CONFLICT (id) DO NOTHING`,
        [`60500001-6050-4000-8000-00${dayKeyDigits}${row.seq}`, DASH_PKG_ID, row.type, `${utcDayKey(row.day)} 12:00:00`],
      );
    }
  } finally {
    await client.end();
  }
}

/** dashboard 场景 a~d 主流程（顺序依赖：a 登录+五卡对账 → b 趋势图 7 桶/空日零高 → c 待审卡跳转对账 → d console 断言） */
async function runDashboardScenarios(page, origin, baseUrl) {
  // —— 数据自备：PENDING 包 1 个＋DownloadStat 6 行（今日/昨日各有量，其余 5 日空）——
  await seedDashboardData();
  console.log('[setup] dashboard 测试数据: DB 直插 PENDING 包 1 个＋DownloadStat 6 行（今日 2下1装/昨日 1下2装，UTC 正午桶）');

  // d) 断言采集起点：console 监听须先于一切页面交互（a~c 全程导航/点击/刷新均计入）
  const consoleTexts = [];
  page.on('console', (msg) => consoleTexts.push(msg.text()));

  const token = await adminAccessToken(baseUrl); // server 真值对账凭据（a/b/c 场景）

  // a) 登录落地 /dashboard，五卡值=overview 响应五字段（对端真值逐项对账）
  await page.goto(`${origin}/admin/dashboard`);
  await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
  await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
  await fillLoginAndSubmit(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15000 });
  await page.getByTestId('trend-chart').waitFor({ timeout: 15000 }); // 五卡+趋势图渲染完成锚
  const truth = await adminApiGet(baseUrl, token, '/api/admin/stats/overview');
  const FIVE_FIELDS = [
    ['stat-package', 'packageCount'],
    ['stat-pending', 'pendingCount'],
    ['stat-download', 'downloadTotal'],
    ['stat-install', 'installTotal'],
    ['stat-user', 'userCount'],
  ];
  const uiValues = {};
  const mismatches = [];
  for (const [testId, field] of FIVE_FIELDS) {
    const text = ((await page.getByTestId(testId).textContent()) ?? '').trim();
    const value = Number(text.replace(/[^0-9]/g, '')); // 卡标题无数字——剥非数字位即 Statistic 千分位值
    uiValues[field] = value;
    if (truth.body?.[field] !== value) {
      mismatches.push(`${field}: UI=${value}/server=${truth.body?.[field]}`);
    }
  }
  const aOk = truth.status === 200 && mismatches.length === 0;
  report(
    'a) 登录落地 /dashboard，五卡值=overview 响应五字段',
    aOk,
    aOk
      ? `五卡对齐 server：包=${uiValues.packageCount} 待审=${uiValues.pendingCount} 下=${uiValues.downloadTotal} 装=${uiValues.installTotal} 用户=${uiValues.userCount}`
      : mismatches.join('；'),
  );

  // b) 趋势图 14 柱 7 桶、空日零高（桶序/每柱高度逐项对账 server daily7d——空桶=零高柱直绘，有量日=正高柱）
  const daily = truth.body?.daily7d ?? [];
  const barCount = await page.locator('[data-testid^="trend-bar-"]').count();
  const dateCount = await page.locator('[data-testid^="trend-date-"]').count();
  let bOk = truth.status === 200 && daily.length === 7 && barCount === 14 && dateCount === 7;
  const bDetails = [`柱=${barCount}/14 日期=${dateCount}/7`];
  let zeroBars = 0;
  for (let i = 0; i < daily.length && bOk; i++) {
    const labelText = ((await page.getByTestId(`trend-date-${i}`).textContent()) ?? '').trim();
    if (labelText !== daily[i].date.slice(5)) {
      bOk = false;
      bDetails.push(`日期序[${i}]=${labelText}/server=${daily[i].date.slice(5)}`);
      break;
    }
    for (const metric of ['downloads', 'installs']) {
      const height = Number(await page.getByTestId(`trend-bar-${metric}-${i}`).getAttribute('height'));
      const expected = daily[i][metric];
      if (expected === 0 && height === 0) {
        zeroBars += 1; // 空日零高直绘（补零=server 职责——UI 不聚合不隐藏）
      } else if (expected > 0 && height > 0) {
        // 有量日正高柱
      } else {
        bOk = false;
        bDetails.push(`${metric}[${i}]: h=${height}/server=${expected}`);
      }
    }
  }
  const activeDays = daily.filter((d) => d.downloads > 0 || d.installs > 0).length;
  report(
    'b) 趋势图渲染 7 桶、空日零高',
    bOk,
    bOk
      ? `14 柱×7 日序对齐 server；零高柱 ${zeroBars} 根；有量日 ${activeDays} 天（造数 2 天有量+5 天空）`
      : bDetails.join('；'),
  );

  // c) pendingCount 卡点击 → /reviews（列表计数与 pendingCount 对账：queue total=overview pendingCount＋行数=server items）
  await page.getByTestId('stat-pending').click();
  await page.waitForURL(/\/admin\/reviews$/, { timeout: 15000 });
  await page.getByTestId('reviews-total').waitFor({ timeout: 15000 });
  const queue = await adminApiGet(baseUrl, token, '/api/admin/reviews?status=pending&page=1');
  const rows = await page.locator('tr.ant-table-row').count();
  const totalText = ((await page.getByTestId('reviews-total').textContent()) ?? '').trim();
  const cOk =
    queue.status === 200 &&
    queue.body.total === truth.body.pendingCount &&
    totalText === `待审 ${truth.body.pendingCount} 个包` &&
    rows === queue.body.items.length;
  report(
    'c) pendingCount 卡点击 → /reviews（列表行数与 pendingCount 对账）',
    cOk,
    `URL=${page.url()}；UI「${totalText}」=pendingCount ${truth.body?.pendingCount}；行数=${rows}/server items=${queue.body?.items?.length}`,
  );

  // d) console 断言：a~c 交互全程无 [antd: Statistic] valueStyle 弃用告警（S-8 告警复测，脚本检查）
  const deprecation = consoleTexts.filter((t) => t.includes('valueStyle'));
  report(
    'd) console 断言无 [antd: Statistic] valueStyle 告警',
    deprecation.length === 0,
    deprecation.length === 0
      ? `console 消息 ${consoleTexts.length} 条，零命中`
      : deprecation[0].slice(0, 160),
  );
}

// —— package 场景（T6-04/TDD-A-04 §6.2 a~g）—————————————————————

// 测试数据（固定 id 幂等＋重跑重置种子状态）：作者号＋四包——A/B/C PENDING 起步、D 直插 APPROVED
// （四状态经场景推进全覆盖：b 通过→APPROVED / c 驳回→REJECTED / d 并发 409→APPROVED 态重渲染 / e 下架→OFFLINE）；
// A 带 manifest.scripts 双脚本＋双版本（脚本清单/版本表渲染面；版本 createdAt 显式隔日——asc 排序末位=最新确定）
// ＋非零计量（MeterCards 对账）＋真实 zip 落盘（g 下载预检解包可读）。
const PKG_AUTHOR_ID = '11111111-6040-4000-8000-0000000000a1';
const PKG_AUTHOR_EMAIL = 't604-author@constella.test'; // DB 直插，不占注册限流（reviews/dashboard 场景同款口径）
const PKG_PRECHECK_SEMVER = '1.1.0'; // A 最新版本（下载预检文件名 <semver>.zip 对齐）
const PKG_WORKBENCH = [
  {
    id: '11111111-6040-4000-8000-0000000000b1',
    kind: 'NODE',
    name: 'T604 工作台包A（通过）',
    summary: 'smoke 七分区渲染＋通过＋下载预检用',
    perms: ['CDP', '网络', '文件'],
    seedStatus: 'PENDING',
    downloadCount: 5,
    installCount: 3,
    manifest: {
      kind: 'node',
      name: 'T604 工作台包A（通过）',
      summary: 'manifest 摘要区对账用',
      version: '1.1.0',
      scripts: {
        xhs_search: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' },
        page_fetch: { file: 'scripts/page_fetch.ts', lang: 'ts', entry: 'main' },
      },
    },
    versions: [
      { id: '11111111-6040-4000-8000-0000000000b2', semver: '1.0.0', daysAgo: 2 },
      { id: '11111111-6040-4000-8000-0000000000b3', semver: '1.1.0', daysAgo: 0, zip: true },
    ],
  },
  {
    id: '11111111-6040-4000-8000-0000000000c1',
    kind: 'PACK',
    name: 'T604 工作台包B（驳回）',
    summary: 'smoke 驳回必填拦截＋REJECTED 只读用',
    perms: ['AI'],
    seedStatus: 'PENDING',
    downloadCount: 0,
    installCount: 0,
    manifest: { kind: 'pack', name: 'T604 工作台包B（驳回）', version: '0.9.0' },
    versions: [{ id: '11111111-6040-4000-8000-0000000000c2', semver: '0.9.0', daysAgo: 0 }],
  },
  {
    id: '11111111-6040-4000-8000-0000000000d1',
    kind: 'FLOW',
    name: 'T604 工作台包C（并发409）',
    summary: 'smoke 两会话并发决策 409 承接用',
    perms: [],
    seedStatus: 'PENDING',
    downloadCount: 1,
    installCount: 2,
    manifest: { kind: 'flow', name: 'T604 工作台包C（并发409）', version: '1.0.0' },
    versions: [{ id: '11111111-6040-4000-8000-0000000000d2', semver: '1.0.0', daysAgo: 0 }],
  },
  {
    id: '11111111-6040-4000-8000-0000000000e1',
    kind: 'PACK',
    name: 'T604 工作台包D（下架）',
    summary: 'smoke APPROVED 下架→OFFLINE 终态用',
    perms: ['文件'],
    seedStatus: 'APPROVED',
    downloadCount: 7,
    installCount: 4,
    manifest: { kind: 'pack', name: 'T604 工作台包D（下架）', version: '2.0.0' },
    versions: [{ id: '11111111-6040-4000-8000-0000000000e2', semver: '2.0.0', daysAgo: 1 }],
  },
];

/** 构造预检 zip（manifest.json＋scripts/＋config/——X-01 四件套缩样；jszip 经 client 包 resolve。
 *  固定条目日期 → 字节确定 → checksum 重跑稳定（DB 行 ON CONFLICT 不改写，存储同键覆写） */
async function buildPrecheckZip() {
  const JSZip = requireFromClient('jszip');
  const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(PKG_WORKBENCH[0].manifest, null, 2), { date: FIXED_DATE });
  zip.file('scripts/xhs_search.py', '# t604 precheck placeholder\n', { date: FIXED_DATE });
  zip.file('scripts/page_fetch.ts', '// t604 precheck placeholder\n', { date: FIXED_DATE });
  zip.file('config/default.yaml', '# t604 precheck placeholder\n', { date: FIXED_DATE });
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer, checksum: `sha256:${createHash('sha256').update(buffer).digest('hex')}` };
}

/**
 * DB 直插工作台测试数据（幂等＝固定 id＋重置回种子状态——上一轮决策后可重跑）＋预检 zip 落盘。
 * zip 落盘：disk 驱动 STORAGE_DIR="storage" 相对 server 进程 cwd（pnpm -F ./server exec 同款约定＝
 * server/storage）；getStream 只读对象文件不读 .meta.json（DiskStorage 实现），故仅写 zip 本体。
 * 复用态 server 若自仓库根启动（storage 根不同）——repoRoot/storage 已存在时补写同键对象双根幂等。
 * Package.createdAt=now()（队列新→旧恒置顶——翻页免疫环境残留行）；版本 createdAt 显式隔日。
 */
async function seedPackageWorkbench() {
  const { buffer: zipBuffer, checksum: zipChecksum } = await buildPrecheckZip();
  const zipKey = `packages/${PKG_WORKBENCH[0].id}/${PKG_PRECHECK_SEMVER}.zip`;
  const writeZipTo = async (rootDir) => {
    const zipPath = path.join(rootDir, ...zipKey.split('/'));
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    await fs.writeFile(zipPath, zipBuffer);
  };
  await writeZipTo(path.join(serverDir, 'storage'));
  const rootStorage = path.join(repoRoot, 'storage');
  if (existsSync(rootStorage)) {
    await writeZipTo(rootStorage);
  }

  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const bcryptMod = requireFromServer('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash('t604-author-pass', 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", role, "isAuthor", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'USER', true, 'ACTIVE', now(), now())
       ON CONFLICT (email) DO NOTHING`,
      [PKG_AUTHOR_ID, PKG_AUTHOR_EMAIL, hash],
    );
    for (const p of PKG_WORKBENCH) {
      await client.query(
        `INSERT INTO "Package" (id, kind, name, summary, "ownerUserId", status, perms,
           "downloadCount", "installCount", "starCount", "createdAt", "updatedAt")
         VALUES ($1, $2::"PackageKind", $3, $4, $5, $6::"PackageStatus", $7::text[], $8, $9, 0, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.kind, p.name, p.summary, PKG_AUTHOR_ID, p.seedStatus, p.perms, p.downloadCount, p.installCount],
      );
      let latestVersionId = null;
      for (const v of p.versions) {
        // zip 版本以真实字节对齐 sizeBytes/checksum；其余版本缩样占位（队列/详情面不触存储）
        const sizeBytes = v.zip ? zipBuffer.length : 2048;
        const checksum = v.zip ? zipChecksum : `sha256:${'0'.repeat(64)}`;
        await client.query(
          `INSERT INTO "PackageVersion" (id, "packageId", semver, "storageKey", checksum, "sizeBytes", manifest, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now() - ($8 || ' days')::interval)
           ON CONFLICT (id) DO NOTHING`,
          [
            v.id,
            p.id,
            v.semver,
            `packages/${p.id}/${v.semver}.zip`,
            checksum,
            sizeBytes,
            JSON.stringify(p.manifest),
            String(v.daysAgo),
          ],
        );
        latestVersionId = v.id;
      }
      // 重置回种子状态＋回填 latestVersion 指针（上一轮通过/驳回/下架后可重跑）
      await client.query(
        `UPDATE "Package" SET status = $2::"PackageStatus", "latestVersionId" = $3, "updatedAt" = now() WHERE id = $1`,
        [p.id, p.seedStatus, latestVersionId],
      );
    }
  } finally {
    await client.end();
  }
}

/** 场景清扫（market-*.test.ts afterAll 先例）：按 ownerUserId 全量两轮删除——用户→名下包→
 *  指针清空→审核留痕/计量/版本级联→用户；两轮防 in-flight 写入漏删。storage zip 对象残留＝
 *  同键幂等覆写，无膨胀（清扫只治 DB 行——zip 无引用即死对象）。 */
async function cleanupPackageWorkbench() {
  const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
  const { Client } = requireFromServer('pg');
  const connectionString = serverDatabaseUrl();
  if (!connectionString) throw new Error('无法定位 DATABASE_URL（server/.env / process.env）');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (let round = 0; round < 2; round++) {
      const users = await client.query('SELECT id FROM "User" WHERE email = $1', [PKG_AUTHOR_EMAIL]);
      if (users.rows.length === 0) break;
      const userIds = users.rows.map((r) => r.id);
      const pkgs = await client.query('SELECT id FROM "Package" WHERE "ownerUserId" = ANY($1)', [userIds]);
      const pkgIds = pkgs.rows.map((r) => r.id);
      if (pkgIds.length > 0) {
        await client.query('UPDATE "Package" SET "latestVersionId" = NULL WHERE id = ANY($1)', [pkgIds]);
        await client.query('DELETE FROM "ReviewRecord" WHERE "packageId" = ANY($1)', [pkgIds]);
        await client.query('DELETE FROM "DownloadStat" WHERE "packageId" = ANY($1)', [pkgIds]);
        await client.query('DELETE FROM "PackageVersion" WHERE "packageId" = ANY($1)', [pkgIds]);
        await client.query('DELETE FROM "Package" WHERE id = ANY($1)', [pkgIds]);
      }
      await client.query('DELETE FROM "User" WHERE id = ANY($1)', [userIds]);
    }
  } finally {
    await client.end();
  }
}

/** package 场景 a~g 主流程（顺序依赖：a 七分区基线 → b 通过 → c 驳回 → d 并发 409 → e 下架 → f 只读 → g 预检） */
async function runPackageScenarios(page, origin, baseUrl) {
  try {
    await seedPackageWorkbench();
    console.log('[setup] package 测试数据: DB 直插作者＋四包（A/B/C PENDING＋D APPROVED；A 含 scripts/双版本/计量/真实 zip）');
    const token = await adminAccessToken(baseUrl); // 「另一会话」凭据（d 场景 A 会话 API 直审＋真值对账）

    // 前置：登录 ADMIN 并整页打开 /reviews（未登录守卫已由 login/users 场景覆盖，不重复立场景）
    await page.goto(`${origin}/admin/reviews`);
    await page.waitForURL(/\/admin\/login$/, { timeout: 15000 });
    await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
    await fillLoginAndSubmit(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15000 });
    await page.goto(`${origin}/admin/reviews`);
    await page.getByTestId('reviews-total').waitFor({ timeout: 15000 });

    const [pkgA, pkgB, pkgC, pkgD] = PKG_WORKBENCH;

    // a) 从 /reviews 行「审核」跳入 → 七分区渲染齐全（对 server 真值逐项对账）
    const truthA = await adminApiGet(baseUrl, token, `/api/admin/packages/${pkgA.id}`);
    await page.locator(`tr[data-row-key="${pkgA.id}"]`).getByRole('button', { name: '审核' }).click();
    await page.waitForURL(new RegExp(`/admin/packages/${pkgA.id}$`), { timeout: 15000 });
    await page.getByTestId('pkg-meta').waitFor({ timeout: 15000 }); // 详情数据到位锚（count 不自动等待）
    const SECTIONS = ['pkg-meta', 'pkg-perms', 'pkg-manifest', 'pkg-scripts', 'pkg-versions', 'pkg-meters', 'pkg-actions'];
    const missingSections = [];
    for (const tid of SECTIONS) {
      if ((await page.getByTestId(tid).count()) === 0) missingSections.push(tid);
    }
    const latestA = truthA.body?.versions?.[truthA.body.versions.length - 1];
    const metaText = (await page.getByTestId('pkg-meta').textContent()) ?? '';
    const manifestText = (await page.getByTestId('pkg-manifest').textContent()) ?? '';
    const scriptRows = await page.getByTestId('pkg-scripts').locator('tr.ant-table-row').count();
    const versionRows = await page.getByTestId('pkg-versions').locator('tr.ant-table-row').count();
    const permTagCount = await page.getByTestId('pkg-perms').locator('.ant-tag').count();
    const meterNum = async (tid) =>
      Number((((await page.getByTestId(tid).textContent()) ?? '').replace(/[^0-9]/g, '')));
    const aOk =
      truthA.status === 200 &&
      missingSections.length === 0 &&
      metaText.includes(pkgA.name) &&
      latestA !== undefined &&
      metaText.includes(latestA.checksum) &&
      metaText.includes(latestA.semver) &&
      manifestText.includes(truthA.body.manifest.version) &&
      manifestText.includes(truthA.body.manifest.name) &&
      scriptRows === Object.keys(truthA.body.manifest.scripts ?? {}).length &&
      versionRows === truthA.body.versions.length &&
      permTagCount === truthA.body.perms.length &&
      (await meterNum('pkg-meter-download')) === truthA.body.downloadCount &&
      (await meterNum('pkg-meter-install')) === truthA.body.installCount;
    report(
      'a) 从 /reviews「审核」跳入 → 七分区渲染齐全',
      aOk,
      aOk
        ? `分区 7/7；脚本 ${scriptRows} 行/版本 ${versionRows} 行/perm ${permTagCount} 标签；下载 ${truthA.body.downloadCount}/装 ${truthA.body.installCount} 对齐 server`
        : `缺分区=[${missingSections.join(',')}]（truth=${truthA.status}）`,
    );

    // b) PENDING「通过」→ 跳回 /reviews 且出队（URL 变化＋行消失＋对端终态）
    await page.getByTestId('pkg-action-approve').click();
    await page.getByText('确认通过该包？').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '确认通过' }).click();
    await page.waitForURL(/\/admin\/reviews$/, { timeout: 15000 });
    await page.locator(`tr[data-row-key="${pkgB.id}"]`).waitFor({ timeout: 15000 }); // 表格已渲染锚（B 行仍在队）
    // 重挂载先渲染缓存页（含 A 陈旧行）再重取——等 A 行 detached 才判定出队（count 会抢在重取前误报残留）
    await page.locator(`tr[data-row-key="${pkgA.id}"]`).waitFor({ state: 'detached', timeout: 15000 });
    const rowGone = (await page.locator(`tr[data-row-key="${pkgA.id}"]`).count()) === 0;
    const queueTruth = await adminApiGet(baseUrl, token, '/api/admin/reviews?status=pending&page=1');
    const stillQueued = (queueTruth.body?.items ?? []).some((it) => it.packageId === pkgA.id);
    const detailA = await adminApiGet(baseUrl, token, `/api/admin/packages/${pkgA.id}`);
    const bOk = rowGone && !stillQueued && detailA.body?.status === 'approved';
    report(
      'b) PENDING 通过 → 跳回 /reviews 且出队',
      bOk,
      `URL=${page.url()}；A 行${rowGone ? '已出队' : '残留'}；server status=${detailA.body?.status}`,
    );

    // c) 驳回：不填理由=前端必填拦截（零 review POST）；填理由 → REJECTED 只读（停留本页）
    await page.locator(`tr[data-row-key="${pkgB.id}"]`).getByRole('button', { name: '审核' }).click();
    await page.waitForURL(new RegExp(`/admin/packages/${pkgB.id}$`), { timeout: 15000 });
    let rejectPosts = 0;
    const countRejectPost = (req) => {
      if (req.method() === 'POST' && /\/api\/admin\/packages\/[^/]+\/review$/.test(req.url())) rejectPosts += 1;
    };
    page.on('request', countRejectPost);
    await page.getByTestId('pkg-action-reject').click();
    await page.locator('.ant-modal .ant-btn-primary').waitFor({ timeout: 10000 });
    await clickModalOk(page); // 空理由提交
    await page.getByText('理由不能为空').waitFor({ timeout: 10000 });
    await sleep(700); // 越过渲染窗口，确证必填拦截零请求（users e 场景同款）
    page.off('request', countRejectPost);
    const intercepted = rejectPosts === 0;
    await page.getByPlaceholder('请输入理由（必填，将随操作留痕）').fill('t604 驳回理由（c 场景）');
    await clickModalOk(page);
    await page.waitForFunction(
      (label) => document.querySelector('[data-testid="pkg-status"]')?.textContent?.includes(label),
      '已驳回',
      { timeout: 10000 },
    );
    const cActionsGone = (await page.getByTestId('pkg-actions').count()) === 0;
    const cUrlStays = new RegExp(`/admin/packages/${pkgB.id}$`).test(page.url());
    const truthB = await adminApiGet(baseUrl, token, `/api/admin/packages/${pkgB.id}`);
    const cOk = intercepted && cActionsGone && cUrlStays && truthB.body?.status === 'rejected';
    report(
      'c) 驳回不填理由必填拦截；填理由 → REJECTED 只读（停留本页）',
      cOk,
      `前端拦截=${intercepted}（空理由 review POST=${rejectPosts}）；动作区${cActionsGone ? '已隐' : '残留'}；URL=${page.url()}；server status=${truthB.body?.status}`,
    );

    // d) 并发 409：两会话同开一 PENDING 包——A 会话（API）先通过，B 会话（页面）再驳回 →
    //    「已被其他管理员处理」＋失效重取刷成 APPROVED 态（下架动作出现/驳回入口消失/URL 不变）
    await page.goto(`${origin}/admin/reviews`);
    await page.getByTestId('reviews-total').waitFor({ timeout: 15000 });
    await page.locator(`tr[data-row-key="${pkgC.id}"]`).getByRole('button', { name: '审核' }).click();
    await page.waitForURL(new RegExp(`/admin/packages/${pkgC.id}$`), { timeout: 15000 });
    await page.getByTestId('pkg-action-reject').waitFor({ timeout: 15000 }); // B 视角 PENDING 动作集已渲染
    const approveByA = await adminApiPost(baseUrl, token, `/api/admin/packages/${pkgC.id}/review`, {
      action: 'approve',
    });
    await page.getByTestId('pkg-action-reject').click();
    await page.getByPlaceholder('请输入理由（必填，将随操作留痕）').fill('t604 并发驳回（应 409）');
    await clickModalOk(page);
    await page.getByText('已被其他管理员处理').waitFor({ timeout: 10000 });
    await page.waitForFunction(
      (label) => document.querySelector('[data-testid="pkg-status"]')?.textContent?.includes(label),
      '已通过',
      { timeout: 10000 },
    );
    const dOfflineVisible = (await page.getByTestId('pkg-action-offline').count()) === 1;
    const dRejectGone = (await page.getByTestId('pkg-action-reject').count()) === 0;
    const dUrlStays = new RegExp(`/admin/packages/${pkgC.id}$`).test(page.url());
    const dOk = approveByA.status === 200 && dOfflineVisible && dRejectGone && dUrlStays;
    report(
      'd) 并发 409：A 通过后 B 驳回 → 「已被其他管理员处理」＋页面刷成 APPROVED 态',
      dOk,
      `A approve=${approveByA.status}；409 提示已收；APPROVED 动作集（下架=${dOfflineVisible}/驳回已隐=${dRejectGone}）；URL=${page.url()}`,
    );

    // e) APPROVED「下架」填理由 → OFFLINE 只读终态（PKG_D 直插 APPROVED——不依赖 d 推进）
    await page.goto(`${origin}/admin/packages/${pkgD.id}`);
    await page.getByTestId('pkg-action-offline').waitFor({ timeout: 15000 });
    await page.getByTestId('pkg-action-offline').click();
    await page.getByPlaceholder('请输入理由（必填，将随操作留痕）').fill('t604 下架理由（e 场景）');
    await clickModalOk(page);
    await page.waitForFunction(
      (label) => document.querySelector('[data-testid="pkg-status"]')?.textContent?.includes(label),
      '已下架',
      { timeout: 10000 },
    );
    const eActionsGone = (await page.getByTestId('pkg-actions').count()) === 0;
    const truthD = await adminApiGet(baseUrl, token, `/api/admin/packages/${pkgD.id}`);
    const eOk = eActionsGone && truthD.body?.status === 'offline';
    report(
      'e) APPROVED 下架填理由 → OFFLINE 只读终态',
      eOk,
      `动作区${eActionsGone ? '已隐' : '残留'}；server status=${truthD.body?.status}`,
    );

    // f) OFFLINE/REJECTED 页无动作区（pkg-actions 不在＋状态徽标对——只读双终态）
    await page.goto(`${origin}/admin/packages/${pkgD.id}`);
    await page.getByTestId('pkg-meta').waitFor({ timeout: 15000 });
    const offlineNoActions = (await page.getByTestId('pkg-actions').count()) === 0;
    const offlineLabelOk = ((await page.getByTestId('pkg-status').textContent()) ?? '').includes('已下架');
    await page.goto(`${origin}/admin/packages/${pkgB.id}`);
    await page.getByTestId('pkg-meta').waitFor({ timeout: 15000 });
    const rejectedNoActions = (await page.getByTestId('pkg-actions').count()) === 0;
    const rejectedLabelOk = ((await page.getByTestId('pkg-status').textContent()) ?? '').includes('已驳回');
    const fOk = offlineNoActions && offlineLabelOk && rejectedNoActions && rejectedLabelOk;
    report(
      'f) OFFLINE/REJECTED 页无动作区',
      fOk,
      `OFFLINE 动作区=${offlineNoActions ? '无' : '有'}；REJECTED 动作区=${rejectedNoActions ? '无' : '有'}`,
    );

    // g) 下载预检 → <semver>.zip 且本地解包可读（预检端点先行真值探测——失败即此报，免浏览器步骤盲等）
    await page.goto(`${origin}/admin/packages/${pkgA.id}`);
    await page.getByTestId('pkg-download').waitFor({ timeout: 15000 });
    const precheck = await fetch(`${baseUrl}/api/admin/packages/${pkgA.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByTestId('pkg-download').click();
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    const savePath = path.join(os.tmpdir(), `t604-precheck-${Date.now()}.zip`);
    await download.saveAs(savePath);
    const savedBuffer = await fs.readFile(savePath);
    const JSZip = requireFromClient('jszip');
    let unzipped = null;
    try {
      const reloaded = await JSZip.loadAsync(savedBuffer);
      const manifestEntry = reloaded.file('manifest.json');
      unzipped = manifestEntry ? JSON.parse(await manifestEntry.async('string')) : null;
    } catch {
      unzipped = null; // 解包失败（损坏/非 zip）——按 g 断言失败处理
    }
    await fs.rm(savePath, { force: true });
    const gOk =
      precheck.status === 200 &&
      suggested === `${PKG_PRECHECK_SEMVER}.zip` &&
      unzipped !== null &&
      unzipped.name === pkgA.manifest.name &&
      unzipped.version === PKG_PRECHECK_SEMVER;
    report(
      'g) 下载预检 → <semver>.zip 且本地解包可读',
      gOk,
      `端点=${precheck.status}；文件名=${suggested}；manifest.json ${unzipped ? `可读（${unzipped.name}@${unzipped.version}）` : '不可读'}`,
    );
  } finally {
    // 清扫（finally——场景半途失败亦不留残留；ownerUserId 全量两轮删除先例）
    await cleanupPackageWorkbench();
    console.log('[setup] package 清扫: t604 作者＋名下包全量删除（两轮）');
  }
}

// —— 主流程 ——————————————————————————————————————————————

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8051';
  const scenario = process.argv[3] ?? 'login';
  if (
    scenario !== 'login' &&
    scenario !== 'users' &&
    scenario !== 'reviews' &&
    scenario !== 'dashboard' &&
    scenario !== 'package'
  ) {
    throw new Error(
      `未知场景参数：${scenario}（可用：login（默认，六登录场景）/ users（TDD-A-02 §6.2 a~g）/ reviews（TDD-A-03 §6.2 a~e）/ dashboard（TDD-A-05 §6.2 a~d）/ package（TDD-A-04 §6.2 a~g））`,
    );
  }

  // 1) admin/dist 就绪（缺失才构建——验收序列已先跑 build，常态为复用）
  const distDir = path.join(adminDir, 'dist');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.log('[setup] admin/dist 缺失 → pnpm -F ./admin build');
    const build = spawnSync('pnpm', ['-F', './admin', 'build'], { cwd: repoRoot, shell: true, stdio: 'pipe' });
    if (build.status !== 0) {
      console.error(build.stdout?.toString());
      console.error(build.stderr?.toString());
      throw new Error('admin build 失败');
    }
  } else {
    console.log('[setup] admin/dist: 复用既有构建产物');
  }

  // 2) server（自管：spawn env 注入 / 复用+DB 兜底）＋ USER 账号
  const server = await ensureServer(baseUrl);
  try {
    await ensureUserAccount(baseUrl);

    // 3) 静态托管 + /api 反代（同域免 CORS）
    const { server: staticServer, origin } = await startStaticHost(distDir, baseUrl);
    console.log(`[setup] 静态托管: ${origin}/admin/ → admin/dist；/api → ${baseUrl}`);

    // 4) 无头 Edge（channel=msedge；playwright-core 经 client 包 resolve）
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    console.log(`[setup] Edge: ${browser.version()}（channel=msedge, headless）`);
    try {
      const page = await (await browser.newContext()).newPage();
      page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 500)}`));
      page.on('requestfailed', (req) => {
        console.log(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`);
      });
      page.on('response', (res) => {
        // >=400 打 URL：favicon 404=S-8 已记录非问题；业务 401/4xx 为场景证据
        if (res.status() >= 400) console.log(`[http${res.status()}] ${res.url()}`);
      });

      if (scenario === 'users') {
        await runUsersScenarios(page, origin, baseUrl);
      } else if (scenario === 'reviews') {
        await runReviewsScenarios(page, origin, baseUrl);
      } else if (scenario === 'dashboard') {
        await runDashboardScenarios(page, origin, baseUrl);
      } else if (scenario === 'package') {
        await runPackageScenarios(page, origin, baseUrl);
      } else {
        await scenario1GuardRedirect(page, origin);
        await scenario2WrongPassword(page, origin);
        await scenario3UserRejected(page);
        await scenario4AdminLogin(page);
        await scenario5ReloadSilentRefresh(page);
        await scenario6Logout(page);
      }
    } finally {
      await browser.close().catch(() => {});
      staticServer.close();
    }
  } finally {
    server.stop();
  }

  const failed = results.filter((r) => !r.ok);
  const label =
    scenario === 'users'
      ? 'users 场景 a~g'
      : scenario === 'reviews'
        ? 'reviews 场景 a~e'
        : scenario === 'dashboard'
          ? 'dashboard 场景 a~d'
          : scenario === 'package'
            ? 'package 场景 a~g'
            : '六场景';
  console.log(failed.length === 0 ? `\nadmin-smoke ${label}全绿` : `\nadmin-smoke ${label}失败 ${failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[setup][fail] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
