#!/usr/bin/env node
// admin-smoke.mjs —— T6-01（TDD-A-01 §6.4）登录/守卫交互冒烟：playwright-core 无头 Edge 六场景。
//
// 用法：node scripts/admin-smoke.mjs [baseUrl=http://127.0.0.1:8051]（仓库根；任意 cwd 均可）
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
// 退出码：六场景全绿 exit 0；任一失败 exit 1（逐场景 [ok]/[fail]）。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

// —— 主流程 ——————————————————————————————————————————————

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8051';

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

      await scenario1GuardRedirect(page, origin);
      await scenario2WrongPassword(page, origin);
      await scenario3UserRejected(page);
      await scenario4AdminLogin(page);
      await scenario5ReloadSilentRefresh(page);
      await scenario6Logout(page);
    } finally {
      await browser.close().catch(() => {});
      staticServer.close();
    }
  } finally {
    server.stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? '\nadmin-smoke 六场景全绿' : `\nadmin-smoke 失败 ${failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[setup][fail] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
