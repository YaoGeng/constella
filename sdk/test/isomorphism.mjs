// TDD-K-01 §6.2 ts/py 同构契约测试（T4-12；本卡验收核心）。
//
// 判据（05 T4-12／K-01 §6.2）：同一 fixture 集（sdk/fixtures/expected/*.json，S-5 六形态）
// 分别在 ts 与 py 运行——ts=spawn `node <entry>`（workspace 源码直跑，与 contract.test.ts
// 同形态）；py=spawn `python -I -X utf8 <entry>`（S-4 冻结形参；沙箱置包＋entry 前置垫片，
// 与 py/tests/run_contract.py 同形态）——帧序列剥 runtime 字段后逐帧深相等＋exit 一致。
// 对照同时双向锚定共享期望 JSON（期望集=冻结契约，剥除口径同两侧契约测试：result 剥
// runtime、error 剥 stack——stack 行号随实现变，非同构判据面）。
//
// 携带评审移交项落点（T4-10/T4-11 → T4-12）：
//   - 版本恒等最小断言：py `constella_sdk.__version__` ↔ ts sdk/package.json version（§6.4c）；
//   - NodeOut 同构复制注记：py __init__.py TypedDict 是 shared/src/dsl/node-out.ts 的复制
//     非 import（K-01 §2 裁决），此处仅以共享期望集对齐，不锁实现文本；
//   - 异常名映射边界（六形态外不锁）：泛型异常 ts `new Error` ≍ py `Exception` →帧 name
//     'Error'；其余异常类 ts 按 err.name／py 按 type(e).__name__ 保留类名——s4 落在冻结面内，
//     六形态外的类名体系不作同构承诺。
//
// 运行：node sdk/test/isomorphism.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐形态 PASS ＋ `isomorphism ok`，exit 0；失败：逐项差异，exit 1。
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePython, SDK_ROOT } from '../scripts/python.mjs';
import { CHILD_TIMEOUT_MS, RUNTIME_KEYS, deepEqual, parseFrames, runChild, stripVolatile } from './frame-utils.mjs';

const EXPECTED_DIR = path.join(SDK_ROOT, 'fixtures', 'expected');
const FIXTURES_DIR = path.join(SDK_ROOT, 'fixtures');
const PY_ROOT = path.join(SDK_ROOT, 'py');
const WORK = path.join(SDK_ROOT, '.tmp', 'isomorphism');
const TS_ENTRIES = path.join(WORK, 'entries');
const PY_SANDBOX = path.join(WORK, 'sandbox');

// ---------- 期望资产 ----------
function loadExpected() {
  const files = readdirSync(EXPECTED_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length !== 6) fail(`期望资产恰六份（S-5 六形态），实际 ${files.length} 份`);
  return files.map((f) => JSON.parse(readFileSync(path.join(EXPECTED_DIR, f), 'utf8')));
}

// §12.1 env 白名单（S-5⑧ 实测；两侧同口径）
function envWithCtx(ctx) {
  return {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    TEMP: process.env.TEMP ?? '',
    CONSTELLA_RUN_ID: 'sdk-isomorphism',
    CONSTELLA_CTX: JSON.stringify(ctx),
  };
}

// ---------- 沙箱置备（ts entry 同 contract.test.ts；py 沙箱同 run_contract.py） ----------
function tsEntrySource(fixtureId) {
  const rel = path.relative(TS_ENTRIES, path.join(FIXTURES_DIR, `${fixtureId}.ts`)).replaceAll('\\', '/');
  return [
    `import { boot } from '@constella/sdk/bootstrap';`,
    `import * as m from '${rel}';`,
    `boot(m.run);`,
    '',
  ].join('\n');
}

const PY_SHIM = 'import os, sys\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n';

function pyEntrySource(fixtureId) {
  const module = fixtureId.replaceAll('-', '_');
  return (
    PY_SHIM +
    'from constella_sdk.bootstrap import boot\n' +
    `import ${module} as entry_mod\n` +
    'boot(entry_mod.run)\n'
  );
}

function prepareWork(expected) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(TS_ENTRIES, { recursive: true });
  // py 沙箱：包目录＋fixtures 与 entry 同置（-I⇒-P，经 SHIM 前置垫片可达）
  cpSync(path.join(PY_ROOT, 'constella_sdk'), path.join(PY_SANDBOX, 'constella_sdk'), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__'),
  });
  for (const entry of readdirSync(path.join(PY_ROOT, 'fixtures'), { withFileTypes: true })) {
    const src = path.join(PY_ROOT, 'fixtures', entry.name);
    const dst = path.join(PY_SANDBOX, entry.name);
    if (entry.isDirectory()) cpSync(src, dst, { recursive: true });
    else if (entry.isFile() && entry.name.endsWith('.py')) cpSync(src, dst);
  }
  for (const e of expected) {
    writeFileSync(path.join(TS_ENTRIES, `${e.id}.entry.ts`), tsEntrySource(e.id));
    writeFileSync(path.join(PY_SANDBOX, `${e.id}.entry.py`), pyEntrySource(e.id));
  }
}

// ---------- 单侧断言：帧序列=期望（剥除口径同契约测试）；返回 problems＋剥除后帧 ----------
function sideProblems(res, expected) {
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
  const term = frames[frames.length - 1];
  if (term?.type === 'result') {
    const keys = Object.keys(term.runtime ?? {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(RUNTIME_KEYS)) {
      problems.push(`runtime 字段集 ${JSON.stringify(keys)} != ${JSON.stringify(RUNTIME_KEYS)}`);
    }
  }
  return { problems, stripped };
}

// ---------- 套件 ----------
const failures = [];
function fail(msg) {
  console.error(`[fail] ${msg}`);
  process.exit(1);
}

const expectedSix = loadExpected();
const py = resolvePython();
console.log(`解释器: ts=${process.execPath} (node ${process.versions.node}) / py=${py.exe} (${py.version})`);

// 版本恒等最小断言（§6.4c；ts package.json ↔ py __version__）
const tsVersion = JSON.parse(readFileSync(path.join(SDK_ROOT, 'package.json'), 'utf8')).version;
const pyVersion = /__version__\s*=\s*"([^"]+)"/.exec(
  readFileSync(path.join(PY_ROOT, 'constella_sdk', '__init__.py'), 'utf8'),
)?.[1];
if (tsVersion !== pyVersion) fail(`两包 version 不恒等: ts=${tsVersion} py=${pyVersion}`);
console.log(`[ok] version 恒等 ts=py=${tsVersion}`);

prepareWork(expectedSix);
try {
  for (const expected of expectedSix) {
    const env = envWithCtx(expected.ctx);
    const ts = await runChild(process.execPath, [path.join(TS_ENTRIES, `${expected.id}.entry.ts`)], env, SDK_ROOT);
    const pySide = await runChild(py.exe, ['-I', '-X', 'utf8', path.join(PY_SANDBOX, `${expected.id}.entry.py`)], env, SDK_ROOT);
    const tsCheck = sideProblems(ts, expected);
    const pyCheck = sideProblems(pySide, expected);
    const problems = [
      ...tsCheck.problems.map((p) => `[ts] ${p}`),
      ...pyCheck.problems.map((p) => `[py] ${p}`),
    ];
    // §6.2 核心：ts 与 py 帧序列（剥 runtime/stack）逐帧深相等
    if (!deepEqual(tsCheck.stripped, pyCheck.stripped)) {
      problems.push(
        `[iso] ts/py 帧序列不一致:\n    ts: ${JSON.stringify(tsCheck.stripped)}\n    py: ${JSON.stringify(pyCheck.stripped)}`,
      );
    }
    if (ts.code !== pySide.code) problems.push(`[iso] exit 不一致: ts=${ts.code} py=${pySide.code}`);
    if (problems.length) {
      failures.push(expected.id);
      console.error(`FAIL ${expected.id}\n  ${problems.join('\n  ')}`);
    } else {
      console.log(`PASS ${expected.id}（exit=${expected.exit}，帧数=${tsCheck.stripped.length}，ts≡py≡期望）`);
    }
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`isomorphism FAIL：${failures.join(', ')}`);
  process.exit(1);
}
console.log('isomorphism ok');
