// TDD-K-01 §6.5 esbuild 可打包回归（T4-12；S-5 式最小脚本回归升级为六形态全量——
// T4-10/T4-11 评审移交项 2）。
//
// 判据（K-01 §6.5＋移交升级）：六形态 fixture 各生成 entry（`import { boot } from
// '@constella/sdk/bootstrap'; boot(m.run)`——C-M1 SandboxExecutor 生成 entry 的同构形态），
// 经 esbuild 0.28.2 bundle（SDK＋bootstrap＋fixture 全内联；S-5 锁配置 cjs/node24）后在
// **无 node_modules 的裸目录**（os tmpdir，工作区之外）以 `ELECTRON_RUN_AS_NODE=1` 执行——
// 帧序列（剥 runtime/stack）=期望 JSON＋exit 逐场景一致，守护 C-M1 链路（宿主打包产物
// 自包含、不依赖 workspace 解析）。
//
// 边界注记：electron.exe 真矩阵（S-5 三矩阵之 Run A）归 T4-16 SandboxExecutor（client 侧）
// 领地；本回归按 §6.5 字面口径＝env 置 ELECTRON_RUN_AS_NODE=1 下执行（S-5 报告已证
// RUN_AS_NODE 与普通 node 协议帧同构，差异仅 runtime 版本槽位值——非判据面）。
//
// 运行：node sdk/test/esbuild-regression.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐形态 PASS ＋ `esbuild-regression ok`，exit 0；失败：逐项差异，exit 1。
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { CHILD_TIMEOUT_MS, deepEqual, parseFrames, runChild, stripVolatile } from './frame-utils.mjs';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_DIR = path.join(SDK_ROOT, 'fixtures', 'expected');
const FIXTURES_DIR = path.join(SDK_ROOT, 'fixtures');
const WORK = path.join(SDK_ROOT, '.tmp', 'esbuild-regression');
const ENTRIES = path.join(WORK, 'entries');
const BUNDLES = path.join(WORK, 'bundles');

const failures = [];
function fail(msg) {
  console.error(`[fail] ${msg}`);
  process.exit(1);
}

function loadExpected() {
  const files = readdirSync(EXPECTED_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length !== 6) fail(`期望资产恰六份（S-5 六形态），实际 ${files.length} 份`);
  return files.map((f) => JSON.parse(readFileSync(path.join(EXPECTED_DIR, f), 'utf8')));
}

function entrySource(fixtureId) {
  const rel = path.relative(ENTRIES, path.join(FIXTURES_DIR, `${fixtureId}.ts`)).replaceAll('\\', '/');
  return [
    `import { boot } from '@constella/sdk/bootstrap';`,
    `import * as m from '${rel}';`,
    `boot(m.run);`,
    '',
  ].join('\n');
}

// §12.1 env 白名单＋ELECTRON_RUN_AS_NODE=1（C-M1 spawn 形；S-5⑧）
function envWithCtx(ctx) {
  return {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    TEMP: process.env.TEMP ?? '',
    CONSTELLA_RUN_ID: 'sdk-esbuild-regression',
    CONSTELLA_CTX: JSON.stringify(ctx),
    ELECTRON_RUN_AS_NODE: '1',
  };
}

function check(res, expected) {
  const problems = [];
  const { frames, unparseable } = parseFrames(res.stdout);
  if (unparseable.length) problems.push(`stdout 存在非 JSON 行: ${JSON.stringify(unparseable)}`);
  if (res.stderr !== '') problems.push(`stderr 不承载协议、应为空: ${res.stderr.slice(0, 200)}`);
  if (res.timedOut) problems.push(`子进程超时（>${CHILD_TIMEOUT_MS}ms）`);
  const terminalIdx = frames.map((f, i) => (f.type === 'result' || f.type === 'error' ? i : -1)).filter((i) => i >= 0);
  if (terminalIdx.length !== 1) problems.push(`终帧应恰一，实际 ${terminalIdx.length}`);
  else if (terminalIdx[0] !== frames.length - 1) problems.push('终帧应为末行');
  if (res.code !== expected.exit) problems.push(`exit ${res.code} != 期望 ${expected.exit}`);
  const stripped = frames.map(stripVolatile);
  if (!deepEqual(stripped, expected.frames)) {
    problems.push(`帧序列剥 runtime/stack 后与期望不一致:\n    期望: ${JSON.stringify(expected.frames)}\n    实际: ${JSON.stringify(stripped)}`);
  }
  return problems;
}

const expectedSix = loadExpected();

// ---------- 1. entry 生成＋esbuild bundle（S-5 锁配置；@constella/sdk 自 workspace 内联） ----------
rmSync(WORK, { recursive: true, force: true });
mkdirSync(ENTRIES, { recursive: true });
mkdirSync(BUNDLES, { recursive: true });
for (const e of expectedSix) writeFileSync(path.join(ENTRIES, `${e.id}.entry.ts`), entrySource(e.id));
try {
  await build({
    entryPoints: expectedSix.map((e) => path.join(ENTRIES, `${e.id}.entry.ts`)),
    outdir: BUNDLES,
    outExtension: { '.js': '.bundle.cjs' },
    absWorkingDir: SDK_ROOT, // '@constella/sdk' 经 sdk/node_modules 解析后内联（packages 非 external）
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: 'linked',
    minify: false,
    logLevel: 'silent',
  });
} catch (err) {
  fail(`esbuild bundle 失败: ${err.message}`);
}

// ---------- 2. 裸目录执行（ELECTRON_RUN_AS_NODE=1）＋帧对拍 ----------
const bareDir = mkdtempSync(path.join(os.tmpdir(), 'constella-esbuild-reg-'));
try {
  for (const expected of expectedSix) {
    const bundleName = `${expected.id}.entry.bundle.cjs`;
    const bundlePath = path.join(bareDir, bundleName);
    cpSync(path.join(BUNDLES, bundleName), bundlePath);
    const res = await runChild(process.execPath, [bundlePath], envWithCtx(expected.ctx), bareDir);
    const problems = check(res, expected);
    if (problems.length) {
      failures.push(expected.id);
      console.error(`FAIL ${expected.id}\n  ${problems.join('\n  ')}`);
    } else {
      console.log(`PASS ${expected.id}（bundle ${bundleName}，exit=${expected.exit}，帧=期望）`);
    }
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
  rmSync(bareDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`esbuild-regression FAIL：${failures.join(', ')}`);
  process.exit(1);
}
console.log('esbuild-regression ok');
