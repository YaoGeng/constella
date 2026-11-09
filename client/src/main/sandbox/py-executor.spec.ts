// PyExecutor 组件用例（T4-17 / TDD-C-M1 §3 PyExecutor 行＋§8① 解释器发现策略收窄＋
// 勘误 v1.0d entry 垫片；S-4 ② 形参/包同置/TEMP·TMP 三同）。
// 全链（spawn 真子进程）归 py-chain.spec.ts；本文件=发现/entry 生成/spawn 规格组件面。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PyExecutor, PY_ENTRY_SHIM, type LauncherPython } from './py-executor';
import { WorkdirFactory } from './workdir-factory';
import { SDK_PY_FIXTURES, SDK_PY_PACKAGE } from './testing/sandbox-harness';

/** 临时 WorkdirLayout 供给（prepare 面） */
function makeLayout(): { root: string; layout: ReturnType<WorkdirFactory['create']> } {
  const root = mkdtempSync(path.join(tmpdir(), 'constella-pyex-'));
  const factory = new WorkdirFactory({ sandboxRoot: root });
  return { root, layout: factory.create('r-1', 'n-1') };
}

/** py -0p 假枚举（resolve 注入缝——避免依赖宿主 py 状态的面） */
const fakeLauncher = (paths: string[]): (() => LauncherPython[]) =>
  () => paths.map((p, i) => ({ path: p, version: `3.${i}.0`, isDefault: i === 0 }));

describe('PyExecutor · 解释器发现（§8①：settings 覆盖 → py -0p 一次解析 → 失败=EnvMissing）', () => {
  it('py -0p 一次解析：缺省标记（*）项胜出＋路径存在性校验＋结果缓存（一次解析）', () => {
    let calls = 0;
    const exeA = path.join(tmpdir(), 'pyexec-a-check.py'); // 不落盘——存在性校验应淘汰
    const exeB = process.execPath; // 真存在（node.exe 充当存在性锚）
    const py = new PyExecutor({
      pyPackageDir: SDK_PY_FIXTURES,
      listLauncherPythons: () => {
        calls += 1;
        return [
          { path: exeA, version: '3.11.0', isDefault: false },
          { path: exeB, version: '3.12.10', isDefault: true },
        ];
      },
    });
    const r1 = py.resolve();
    expect(r1).toMatchObject({ path: exeB, source: 'py-launcher' }); // * 项优先＋存在性
    expect(py.resolve()).toBe(r1); // 缓存（同引用）
    expect(calls).toBe(1); // 一次解析
  });

  it('settings 路径覆盖优先（存在即采用）；覆盖缺省（路径不存在）→ EnvMissing', () => {
    const good = new PyExecutor({ pyPackageDir: SDK_PY_FIXTURES, pythonPathOverride: process.execPath });
    expect(good.resolve()).toMatchObject({ path: process.execPath, source: 'settings' });

    const bad = new PyExecutor({
      pyPackageDir: SDK_PY_FIXTURES,
      pythonPathOverride: path.join(tmpdir(), 'nonexistent-python', 'python.exe'),
    });
    const r = bad.resolve();
    expect(r).toMatchObject({ missing: true });
    if (r.missing) expect(r.reason).toContain('settings');
  });

  it('py 启动器缺失/无可用项 → EnvMissing（RUN-ENV-MISSING 降级源）', () => {
    const noLauncher = new PyExecutor({ pyPackageDir: SDK_PY_FIXTURES, listLauncherPythons: () => [] });
    expect(noLauncher.resolve()).toMatchObject({ missing: true });

    const noneExists = new PyExecutor({
      pyPackageDir: SDK_PY_FIXTURES,
      listLauncherPythons: fakeLauncher([path.join(tmpdir(), 'gone-a.exe'), path.join(tmpdir(), 'gone-b.exe')]),
    });
    const r = noneExists.resolve();
    expect(r).toMatchObject({ missing: true });
    if (r.missing) expect(r.reason).toContain('py');
  });

  it('真实 py -0p 解析（宿主面）：绝对 python.exe', () => {
    const py = new PyExecutor({ pyPackageDir: SDK_PY_FIXTURES });
    const r = py.resolve();
    expect(r.missing).toBeFalsy();
    if (!r.missing) {
      expect(r.path.toLowerCase().endsWith('python.exe')).toBe(true);
      expect(path.isAbsolute(r.path)).toBe(true);
      expect(existsSync(r.path)).toBe(true);
    }
  });
});

describe('PyExecutor · prepare（S-4 ② 形参＋K-01 §2 包同置＋v1.0d 垫片＋§6.1e 三同）', () => {
  it('entry 生成：SHIM 前置垫片＋冻结形＋模块 import＋boot(getattr(entry_mod, fn, None))', () => {
    const { root, layout } = makeLayout();
    try {
      const py = new PyExecutor({ pyPackageDir: SDK_PY_PACKAGE });
      const spec = py.prepare(path.join(SDK_PY_FIXTURES, 's1_basic.py'), 'notRun', layout);
      const entry = readFileSync(spec.entryPath, 'utf8');
      const lines = entry.split(/\r?\n/);
      // 垫片两行置顶（v1.0d：-I⇒-P 脚本目录不入 sys.path——冻结两行前加）
      expect(lines[0]).toBe('import os, sys');
      expect(lines[1]).toBe('sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))');
      expect(entry).toContain('from constella_sdk.bootstrap import boot'); // 冻结第一行
      expect(entry).toContain('import s1_basic as entry_mod'); // 模块 import（标识符形）
      expect(entry).toContain('boot(getattr(entry_mod, "notRun", None))'); // ENTRY_NO_RUN 面（getattr None≈ts undefined）
      expect(entry.startsWith(PY_ENTRY_SHIM)).toBe(true);
      // spawn 规格（S-4 ② 冻结形参）
      expect(spec.args).toEqual(['-I', '-X', 'utf8', spec.entryPath]);
      expect(path.basename(spec.entryPath)).toBe('entry.py');
      expect(spec.cmd.toLowerCase().endsWith('python.exe')).toBe(true);
      // §6.1e 三同：TEMP/TMP 覆盖=run 私有目录（executorEnv 面——assembleChildEnv 末段合入）
      expect(spec.env).toEqual({ TEMP: layout.root, TMP: layout.root });
      expect(path.basename(layout.root)).toBe('n-1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非标识符模块名 → importlib.import_module 形（宿主生成面泛化——资产名不受限）', () => {
    const { root, layout } = makeLayout();
    try {
      const scriptsSrc = path.join(root, 'assets-scripts');
      mkdirSync(scriptsSrc, { recursive: true });
      const script = path.join(scriptsSrc, 'my-script.py');
      writeFileSync(script, 'async def run(ctx):\n    return {"data": 1}\n', 'utf8');
      const py = new PyExecutor({ pyPackageDir: SDK_PY_PACKAGE });
      const spec = py.prepare(script, 'run', layout);
      const entry = readFileSync(spec.entryPath, 'utf8');
      expect(entry).toContain('import importlib');
      expect(entry).toContain('entry_mod = importlib.import_module("my-script")');
      expect(entry).toContain('boot(getattr(entry_mod, "run", None))');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('包同置＋scripts 拷贝（K-01 §2：constella_sdk 与 entry 同置沙箱 scripts/；02 §12.1 scripts 拷贝）', () => {
    const { root, layout } = makeLayout();
    try {
      const py = new PyExecutor({ pyPackageDir: SDK_PY_PACKAGE });
      py.prepare(path.join(SDK_PY_FIXTURES, 's3_relative_import.py'), 'run', layout);
      // 包四件随置（__pycache__ 不拷）
      expect(existsSync(path.join(layout.scriptsDir, 'constella_sdk', '__init__.py'))).toBe(true);
      expect(existsSync(path.join(layout.scriptsDir, 'constella_sdk', 'bootstrap.py'))).toBe(true);
      expect(existsSync(path.join(layout.scriptsDir, 'constella_sdk', 'caps.py'))).toBe(true);
      expect(existsSync(path.join(layout.scriptsDir, 'constella_sdk', 'py.typed'))).toBe(true);
      // 包源同目录 scripts 资产整体拷入（s3 的 lib/ 随行——相对 import 与 __file__ 定位）
      expect(existsSync(path.join(layout.scriptsDir, 's3_relative_import.py'))).toBe(true);
      expect(existsSync(path.join(layout.scriptsDir, 'lib', 'helper.py'))).toBe(true);
      expect(existsSync(path.join(layout.scriptsDir, 'lib', 'items.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
