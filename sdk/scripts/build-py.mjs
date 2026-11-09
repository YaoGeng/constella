// constella-sdk wheel 构建冒烟（T4-12 打包分发；K-01 §6.4b/§6.4c）。
//
// 判据：`python -m build sdk/py`（§6.4 字面口径；build 前端＋setuptools 后端）产出
// sdist+wheel，wheel 含 constella_sdk/py.typed（PEP 561）与 THIRD-PARTY-NOTICES.md
// （S-9 声明位），dist-info METADATA Version == 两包恒等版本。公开发布=V2（K-01 §8③），
// 本脚本仅 workspace 内打包冒烟。
//
// 自举口径：本机 3.12.10 无 `build` 前端——在 sdk/py/.tmp/buildenv 自举 venv 并安装
// build（一次性，幂等；网络取 PyPI）。产物落 sdk/py/.tmp/dist，不入库（.gitignore .tmp/）。
//
// 运行：node sdk/scripts/build-py.mjs（或 `pnpm -F ./sdk run build:py`；任意 cwd 均可）
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePython, SDK_ROOT } from './python.mjs';

const PY_ROOT = path.join(SDK_ROOT, 'py');
const VENV = path.join(PY_ROOT, '.tmp', 'buildenv');
const VENV_PY = path.join(VENV, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
const OUTDIR = path.join(PY_ROOT, '.tmp', 'dist');

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: opts.inherit ? 'inherit' : 'pipe', encoding: 'utf8', windowsHide: true });

const base = resolvePython();
console.log(`解释器: ${base.exe} (${base.version})`);

// ---------- 1. venv 自举＋build 前端 ----------
if (!existsSync(VENV_PY)) {
  console.log('[venv] 自举 sdk/py/.tmp/buildenv（一次性）');
  if (run(base.exe, ['-m', 'venv', VENV], { inherit: true }).status !== 0) {
    console.error('[fail] venv 创建失败');
    process.exit(1);
  }
}
if (run(VENV_PY, ['-c', 'import build']).status !== 0) {
  console.log('[venv] 安装 build 前端（一次性，PyPI 网络）');
  if (run(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'build'], { inherit: true }).status !== 0) {
    console.error('[fail] pip install build 失败');
    process.exit(1);
  }
}

// ---------- 2. sdist+wheel 构建 ----------
rmSync(OUTDIR, { recursive: true, force: true });
if (run(VENV_PY, ['-m', 'build', '--outdir', OUTDIR, PY_ROOT], { inherit: true }).status !== 0) {
  console.error('[fail] python -m build 失败');
  process.exit(1);
}

// ---------- 3. 产物断言（wheel 清单经 py zipfile 读取——stdlib；node 侧不引 zip 依赖） ----------
const LISTING_PY = [
  'import glob, json, sys, zipfile',
  'outdir = sys.argv[1]',
  'wheels = sorted(glob.glob(outdir + "/*.whl"))',
  'sdists = sorted(glob.glob(outdir + "/*.tar.gz"))',
  'assert len(wheels) == 1 and len(sdists) == 1, (wheels, sdists)',
  'z = zipfile.ZipFile(wheels[0])',
  'meta = [n for n in z.namelist() if n.endswith(".dist-info/METADATA")][0]',
  'print(json.dumps({"names": z.namelist(), "metadata": z.read(meta).decode("utf-8")}))',
].join('\n');
const listing = run(VENV_PY, ['-c', LISTING_PY, OUTDIR]);
if (listing.status !== 0) {
  console.error(`[fail] wheel 清单读取失败: ${listing.stderr}`);
  process.exit(1);
}
const { names, metadata } = JSON.parse(listing.stdout);

const failures = [];
for (const required of [
  'constella_sdk/py.typed',
  'constella_sdk/THIRD-PARTY-NOTICES.md',
  'constella_sdk/__init__.py',
  'constella_sdk/bootstrap.py',
  'constella_sdk/caps.py',
]) {
  if (!names.includes(required)) failures.push(`wheel 缺 ${required}`);
}
const tsVersion = JSON.parse(readFileSync(path.join(SDK_ROOT, 'package.json'), 'utf8')).version;
const metaVersion = /^Version:\s*(\S+)/m.exec(metadata)?.[1];
if (metaVersion !== tsVersion) failures.push(`wheel Version ${metaVersion} != ts package version ${tsVersion}（§6.4c 恒等）`);

if (failures.length) {
  console.error('build-py FAIL：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[ok] sdist+wheel 各一；wheel 含 py.typed＋THIRD-PARTY-NOTICES.md＋包源（${names.length} 成员）`);
console.log(`[ok] wheel Version=${metaVersion} == ts package version（两包恒等）`);

// setuptools 在工程根生成的 egg-info 元数据残留——冒烟即弃（.gitignore 另有兜底）
rmSync(path.join(PY_ROOT, 'constella_sdk.egg-info'), { recursive: true, force: true });
console.log('build-py ok');
