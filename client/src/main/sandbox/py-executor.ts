// PyExecutor —— py 链执行器（T4-17 / TDD-C-M1 §3 PyExecutor 组件行＋03 §4 S-4 ②⑥＋
// §8① 解释器发现策略收窄＋03 L1795 勘误 v1.0d）。
//
// 冻结面（§3 组件行＋卡 T4-17）：
//   - resolve(): PythonPath | EnvMissing（§3 冻结签名）——发现策略（§8① 收窄）：
//     ① settings 路径覆盖优先（存在即采用——覆盖优先于启动器解析，测试注入缝同序）；
//     ② py 启动器**一次解析**（`py -0p` → 绝对路径，缺省标记 * 项胜出）后直接 spawn
//       python.exe（避免 py.exe 包装层，S-4 ②）——结果缓存（一次解析语义）；
//     ③ 均无果 → EnvMissing → SandboxExecutor 归一 RUN-ENV-MISSING（02 §12.1 节点级
//       执行环境缺失降级，非崩溃）；
//   - spawn 形参 `-I -X utf8`＋windowsHide＋stdio pipe（S-4 ② 冻结；windowsHide/stdio
//     由 SandboxExecutor spawn 统一持）；
//   - entry 生成＝薄脚本形态＋v1.0d 前置垫片（Python 3.11+ `-I` 隐含 `-P`，脚本目录不入
//     sys.path——冻结两行前插 `sys.path.insert(0, dirname(abspath(__file__)))`；参照实现
//     ＝sdk/py/tests/run_contract.py 的 SHIM）＋`boot(getattr(entry_mod, "<fn>", None))`
//     （getattr None≈ts 侧 undefined——ENTRY_NO_RUN 面对齐，缺出口函数=装配错误 exit 2）；
//   - constella_sdk 包与 entry 同置沙箱 scripts/ 目录（K-01 §2「py 包与 entry 同置」）；
//     包源=装配注入（sdk/py/constella_sdk——生产组合根接线随 T4-20，同 ts 链 sdkModules 先例）；
//   - 02 §12.1「scripts 只读挂载（拷贝）」：脚本所在包 scripts/ 目录整体拷入沙箱
//     （s3 相对 import 的 lib/ 随行；__pycache__ 不拷）；
//   - executorEnv＝{TEMP,TMP}=run 私有目录（§6.1e cwd·TEMP·TMP 三同——S-4 ⑥；经
//     assembleChildEnv 末段合入覆盖白名单透传值，ts 链 host 透传口径不动〔T4-16 评审偏差⑦
//     收口：py 链按 S-4〕）；
//   - `-I` 隔离＝禁依赖 PYTHON* env（-I⇒-E 忽略 PYTHON* 且传入 env 块本就无该前缀键——
//     T4-11 同口径，断言面=传入块键集）。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkdirLayout } from './workdir-factory';

/** py -0p 枚举项（发现策略注入缝——缺省真执行 py 启动器） */
export interface LauncherPython {
  /** python.exe 绝对路径 */
  path: string;
  /** 版本串（如 3.12.10） */
  version: string;
  /** 缺省标记（py -0p 的 * 项——多个安装时胜出） */
  isDefault: boolean;
}

/** 发现成功（§3 `PythonPath`——一次解析缓存；missing=false 判别位供联合窄化） */
export interface PythonPath {
  missing: false;
  path: string;
  source: 'settings' | 'py-launcher';
}

/** 发现失败（§3 `EnvMissing`——SandboxExecutor 归一 RUN-ENV-MISSING） */
export interface EnvMissing {
  missing: true;
  reason: string;
}

/** resolve() 返回联合（§3 冻结签名 `resolve(): PythonPath | EnvMissing`） */
export type PythonResolution = PythonPath | EnvMissing;

/** v1.0d 前置垫片（勘误原文；-I⇒-P 使脚本目录不入 sys.path 的实证处置） */
export const PY_ENTRY_SHIM = 'import os, sys\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n';

/** spawn 规格（SandboxExecutor 消费——cmd/args 冻结形参＋executorEnv） */
export interface PySpawnSpec {
  cmd: string;
  args: string[];
  /** executorEnv（TEMP/TMP 三同覆盖——assembleChildEnv executorEnv 位合入） */
  env: Record<string, string>;
  entryPath: string;
}

/** 构造依赖 */
export interface PyExecutorDeps {
  /** constella_sdk 包源目录（K-01 §2：包与 entry 同置沙箱 scripts/；装配注入位） */
  pyPackageDir: string;
  /** settings python 路径覆盖（§8①：覆盖优先于 py 启动器解析；缺省=启动器解析） */
  pythonPathOverride?: string;
  /** py 启动器枚举注入缝（缺省=真 `py -0p` 一次解析；测试注入失败态/缓存面） */
  listLauncherPythons?: () => LauncherPython[];
}

/** `py -0p` 输出行解析（形如 ` -V:3.12 *        C:\...\python.exe`——版本/* 标记/路径列间为
 *  变长空格；ASCII 面，本地化无关） */
function parseLauncherList(stdout: string): LauncherPython[] {
  const out: LauncherPython[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*-V:(\S+)[ \t]*(\*?)[ \t]*(\S+\.exe)[ \t]*$/i.exec(line);
    if (m !== null) out.push({ version: m[1]!, path: m[3]!, isDefault: m[2] === '*' });
  }
  return out;
}

/** Python 模块名判定（标识符——import 语句形可用；否则 importlib 泛化形） */
function isIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/**
 * PyExecutor（§3 组件行：py 启动器一次解析→直接 spawn python.exe＋`-I -X utf8`；
* 包/脚本置入沙箱＋entry 生成）。
 */
export class PyExecutor {
  private cached: PythonResolution | undefined;

  constructor(private readonly deps: PyExecutorDeps) {}

  /** 解释器发现（§3 冻结签名；一次解析=结果缓存——后续 spawn 直用） */
  resolve(): PythonResolution {
    if (this.cached !== undefined) return this.cached;
    this.cached = this.resolveOnce();
    return this.cached;
  }

  private resolveOnce(): PythonResolution {
    // ① settings 路径覆盖优先（§8①）
    const override = this.deps.pythonPathOverride;
    if (override !== undefined && override !== '') {
      if (existsSync(override)) return { missing: false, path: path.resolve(override), source: 'settings' };
      return { missing: true, reason: `settings python 路径覆盖不存在: ${override}` };
    }
    // ② py 启动器一次解析（缺省 * 项胜出＋存在性校验）
    let listed: LauncherPython[];
    try {
      listed = this.deps.listLauncherPythons !== undefined ? this.deps.listLauncherPythons() : this.runPyLauncherList();
    } catch (err) {
      return { missing: true, reason: `py 启动器解析异常: ${String(err)}` };
    }
    const usable = listed.find((e) => e.isDefault && existsSync(e.path)) ?? listed.find((e) => existsSync(e.path));
    if (usable === undefined) {
      return {
        missing: true,
        reason: listed.length === 0 ? 'py 启动器不可用或未列出任何安装（py -0p 无输出）' : 'py -0p 列出项均不存在于磁盘',
      };
    }
    return { missing: false, path: path.resolve(usable.path), source: 'py-launcher' };
  }

  /** `py -0p` 真执行（PATH 上 python 为 WindowsApps stub——一律经启动器，S-4 结论） */
  private runPyLauncherList(): LauncherPython[] {
    const r = spawnSync('py', ['-0p'], { encoding: 'utf8', windowsHide: true });
    if (r.error !== undefined) throw r.error;
    if (r.status !== 0) return [];
    return parseLauncherList(r.stdout ?? '');
  }

  /**
   * spawn 规格组装（脚本包目录/constella_sdk 包置入沙箱 scripts/＋entry 生成；
   * §3 PyExecutor 行职责面——调用方 SandboxExecutor 已先检 resolve）。
   */
  prepare(scriptPath: string, entryFn: string, workdir: WorkdirLayout): PySpawnSpec {
    const resolution = this.resolve();
    if (resolution.missing) {
      throw new Error(`PyExecutor.prepare：解释器未解析（须先经 SandboxExecutor resolve 检→RUN-ENV-MISSING）: ${resolution.reason}`);
    }
    // ① 02 §12.1 scripts 只读挂载（拷贝）：脚本所在包 scripts 目录整体入沙箱（lib/ 随行）
    cpSync(path.dirname(scriptPath), workdir.scriptsDir, { recursive: true, force: true });
    // ② K-01 §2 包与 entry 同置：constella_sdk → scripts/constella_sdk（__pycache__ 不拷）
    cpSync(this.deps.pyPackageDir, path.join(workdir.scriptsDir, 'constella_sdk'), {
      recursive: true,
      force: true,
      filter: (src) => !src.includes('__pycache__'),
    });
    // ③ entry 薄脚本生成（v1.0d 垫片＋冻结形）
    const entryPath = path.join(workdir.scriptsDir, 'entry.py');
    writeFileSync(entryPath, this.entrySource(scriptPath, entryFn), 'utf8');
    return {
      cmd: resolution.path,
      args: ['-I', '-X', 'utf8', entryPath], // S-4 ② 冻结形参
      env: { TEMP: workdir.root, TMP: workdir.root }, // §6.1e 三同（S-4 ⑥）
      entryPath,
    };
  }

  /** entry 源码（SHIM＋冻结两行＋boot(getattr)——参照实现=run_contract.py entry_source） */
  private entrySource(scriptPath: string, entryFn: string): string {
    const stem = path.basename(scriptPath).replace(/\.py$/i, '');
    const fnLiteral = JSON.stringify(entryFn === '' ? 'run' : entryFn); // 缺省入口=run（ts 链同口径）
    const importLine = isIdentifier(stem)
      ? `import ${stem} as entry_mod`
      : `import importlib\nentry_mod = importlib.import_module(${JSON.stringify(stem)})`; // 非‘标识符资产名泛化形
    return (
      // 参照实现（run_contract.py entry_source）逐字节同形：SHIM 置顶（无注释头）——垫片两行
      // 必须先于冻结两行执行，保持与 T4-11 harness 生成物逐字节一致便于互证。
      PY_ENTRY_SHIM +
      'from constella_sdk.bootstrap import boot\n' +
      importLine +
      '\n' +
      `boot(getattr(entry_mod, ${fnLiteral}, None))\n`
    );
  }
}
