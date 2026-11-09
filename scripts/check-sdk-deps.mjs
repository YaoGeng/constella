// sdk 双包依赖红线守护（T4-12 交付；口径 = TDD-K-01 §6.6／05 T4-12——T4-10 期间人工守的红线成文化）。
//
// 用法：node scripts/check-sdk-deps.mjs（仓库根；任意 cwd 均可，路径按 import.meta.url 定位）
//   成功：逐项打印 [ok] 并输出 `check-sdk-deps ok`，exit 0
//   失败：打印全部违规项，exit 1
//
// 断言面：
//   1. ts 红线：sdk/package.json `dependencies` ≡ {}（零运行时依赖）
//   2. ts import 面（sdk/src＋sdk/fixtures＋sdk/test 的 *.ts；.mjs harness 为构建工具面、不在扫描域）：
//      仅允许 相对路径（./ ../）、`node:` 内建、`@constella/shared`（+#subpath）；
//      豁免＝包名自引用 `@constella/sdk`（devDep workspace:* 为包名解析必要，fixtures/test
//      契约导入形照此书写——T4-10/T4-11 评审移交项 1）与 test 域 dev 断言框架 `vitest`；
//   3. py 红线：sdk/py/pyproject.toml `dependencies = []` 且 sdk/py/constella_sdk/**.py
//      import 面零三方（stdlib＋包内相对导入 only）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = path.join(repoRoot, 'sdk');
const failures = [];
const ok = (msg) => console.log(`[ok] ${msg}`);

// ---------- 1. ts dependencies={} ----------
let pkg;
try {
  pkg = JSON.parse(readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
} catch (err) {
  console.error(`[fail] 无法读取 sdk/package.json：${err.message}`);
  process.exit(1);
}
const depsKeys = Object.keys(pkg.dependencies ?? {});
if (depsKeys.length === 0 && pkg.dependencies !== undefined) {
  ok('ts dependencies={}（零运行时依赖红线）');
} else if (depsKeys.length === 0) {
  failures.push('ts package.json 缺 dependencies 字段（应显式声明 {}）');
} else {
  failures.push(`ts dependencies 应为 {}，实际: ${JSON.stringify(pkg.dependencies)}`);
}

// ---------- 2. ts import 面 ----------
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.tmp') continue;
      walk(p, exts, out);
    } else if (exts.some((e) => p.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

// 注释剥离（扫描用）：块注释整段去；行注释要求 // 前为行首/空白——字符串内的 'https://'
// 等不受影响。剥离可消注释中的示例 import 误报（如 index.ts 头注「import { run } from
// '@constella/sdk'」）；代价仅是理论上的漏报面（真实 import 不会出现在注释之后同行）。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const TS_SCOPES = [
  { dir: path.join(sdkDir, 'src'), label: 'src', extra: [] }, // 发货面：严格
  { dir: path.join(sdkDir, 'fixtures'), label: 'fixtures', extra: ['self'] }, // 契约脚本：SDK 包名导入形
  { dir: path.join(sdkDir, 'test'), label: 'test', extra: ['self', 'vitest'] }, // 测试面：另容 dev 断言框架
];

const IMPORT_RES = [
  /import\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /export\s+[^'";]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function tsSpecAllowed(spec, extra) {
  if (spec.startsWith('./') || spec.startsWith('../')) return true; // 相对路径
  if (spec.startsWith('node:')) return true; // node 内建
  if (spec === '@constella/shared' || spec.startsWith('@constella/shared/')) return true;
  if (extra.includes('self') && (spec === '@constella/sdk' || spec.startsWith('@constella/sdk/'))) return true;
  if (extra.includes('vitest') && (spec === 'vitest' || spec.startsWith('vitest/'))) return true;
  return false;
}

for (const scope of TS_SCOPES) {
  const files = walk(scope.dir, ['.ts']);
  const bad = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const re of IMPORT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (/\$\{/.test(m[1])) continue; // entry 生成器模板占位（非真实 specifier）
        if (!tsSpecAllowed(m[1], scope.extra)) bad.push(`${path.relative(repoRoot, file)}: ${m[1]}`);
      }
    }
  }
  if (bad.length) failures.push(`ts import 面（${scope.label}，${files.length} 文件）违规:\n    ${bad.join('\n    ')}`);
  else ok(`ts import 面 ${scope.label}（${files.length} 文件）：相对/node:/@constella/shared${scope.extra.length ? `＋${scope.extra.join('/')}` : ''} only`);
}

// ---------- 3. py 红线（pyproject dependencies=[]＋源 import 面） ----------
const pyproject = readFileSync(path.join(sdkDir, 'py', 'pyproject.toml'), 'utf8');
const pyDepsMatch = /dependencies\s*=\s*\[([^\]]*)\]/.exec(pyproject);
if (pyDepsMatch && pyDepsMatch[1].trim() === '') {
  ok('py dependencies=[]（零三方红线）');
} else {
  failures.push(`py dependencies 应为 []，实际: ${JSON.stringify(pyDepsMatch?.[1]?.trim() ?? '(缺字段)')}`);
}

// Python 3.12.10（S-4 锁定版）sys.stdlib_module_names 冻结快照（生成：
//   py -3 -c "import sys; print(*sorted(sys.stdlib_module_names))"——升级解释器时同步再生成）
const PY_STDLIB = new Set(
  ('__future__ _abc _aix_support _ast _asyncio _bisect _blake2 _bz2 _codecs _codecs_cn _codecs_hk ' +
    '_codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw _collections _collections_abc _compat_pickle ' +
    '_compression _contextvars _crypt _csv _ctypes _curses _curses_panel _datetime _dbm _decimal ' +
    '_elementtree _frozen_importlib _frozen_importlib_external _functools _gdbm _hashlib _heapq _imp ' +
    '_io _json _locale _lsprof _lzma _markupbase _md5 _msi _multibytecodec _multiprocessing _opcode ' +
    '_operator _osx_support _overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydatetime ' +
    '_pydecimal _pyio _pylong _queue _random _scproxy _sha1 _sha2 _sha3 _signal _sitebuiltins ' +
    '_socket _sqlite3 _sre _ssl _stat _statistics _string _strptime _struct _symtable _thread ' +
    '_threading_local _tkinter _tokenize _tracemalloc _typing _uuid _warnings _weakref _weakrefset ' +
    '_winapi _wmi _zoneinfo abc aifc antigravity argparse array ast asyncio atexit audioop base64 bdb ' +
    'binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop ' +
    'collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg crypt ' +
    'csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip ' +
    'enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath ' +
    'getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr ' +
    'importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma ' +
    'mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis ' +
    'nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle ' +
    'pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd ' +
    'py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource ' +
    'rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtplib sndhdr ' +
    'socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string ' +
    'stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib ' +
    'tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace ' +
    'traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv ' +
    'warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile ' +
    'zipimport zlib zoneinfo').split(' '),
);

const PY_IMPORT_RES = [/^\s*import\s+([A-Za-z_][\w.]*)/gm, /^\s*from\s+([A-Za-z_.][\w.]*)\s+import/gm];
const pyFiles = walk(path.join(sdkDir, 'py', 'constella_sdk'), ['.py']);
const pyBad = [];
for (const file of pyFiles) {
  // 行注释剥离：# 前为行首/空白（py 源内 '#...' 字符串不含此形）；块注释（docstring）为
  // 表达式语句、无 import 关键字形态，不剥离。
  const src = readFileSync(file, 'utf8').replace(/(^|\s)#[^\n]*/g, '$1');
  for (const re of PY_IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (spec.startsWith('.')) continue; // 包内相对导入
      const root = spec.split('.')[0];
      if (!PY_STDLIB.has(root)) pyBad.push(`${path.relative(repoRoot, file)}: ${spec}`);
    }
  }
}
if (pyBad.length) failures.push(`py 源 import 面违规（零三方红线）:\n    ${pyBad.join('\n    ')}`);
else ok(`py 源 import 面（${pyFiles.length} 文件）：stdlib＋包内相对 only`);

if (failures.length) {
  console.error('\ncheck-sdk-deps FAIL：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-sdk-deps ok');
