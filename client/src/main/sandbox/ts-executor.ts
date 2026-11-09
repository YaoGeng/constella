// TsExecutor —— ts 链执行器（T4-16 / TDD-C-M1 §3 TsExecutor 组件行＋03 §4 S-5 ①~⑤ 强制项）。
//
// S-5 配置冻结（spike 实证）：esbuild bundle:true / platform:'node' / format:'cjs' /
// target:'node24' / sourcemap:'linked'（外置 .map＋sourceMappingURL 注释）——单场景构建 9–67ms。
//
// 强制项落位：
//   - ①协议冻结＝K-01 bootstrap 承载（本组件只生成 entry：`import { boot } from
//     '@constella/sdk/bootstrap'; import * as m from '<脚本>'; boot(m.<entry>)`——S-5 冻结形，
//     entry 名＝req.entry〔X-01 ExecSpec.entry 入口函数名〕；模块未导出该函数 → boot 侧
//     ENTRY_NO_RUN/exit 2）；
//   - ④显式 ELECTRON_RUN_AS_NODE='1'（漏注=按 Electron main 语义执行且进程不退出——P1 实测）；
//   - ⑤source-map-support：子进程形参 `--enable-source-maps`（Node 24 内建 source map 支持；
//     source-map-support 三方包=新增依赖违本卡红线——自拟承接留痕，双运行时实测错误栈回源 .ts）。
//
// @constella/sdk 解析（自拟冻结留痕）：client 无该 workspace dep（K-01=被拉起资产、非 main
// import 面——C-M1 §2 红线），esbuild alias 显式映射到 sdk TS 源绝对路径；路径由装配注入
// （测试=monorepo 相对定位；生产组合根接线随 T4-20 组收尾——同 cdp/vault 先例）。
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** @constella/sdk 双 subpath 的 TS 源绝对路径（alias 映射目标——见文件头自拟项） */
export interface SdkModulePaths {
  sdk: string;
  bootstrap: string;
}

/** 构造依赖 */
export interface TsExecutorDeps {
  /** sdk 双 subpath TS 源（alias 目标；必填——装配面注入，见文件头） */
  sdkModules: SdkModulePaths;
  /** 子进程可执行文件（缺省 process.execPath：node 直跑=vitest/node 宿主；electron main
   *  装配后=electron.exe＋ELECTRON_RUN_AS_NODE） */
  execPath?: string;
  /** esbuild build 注入缝（缺省真 esbuild 0.28.2——T0-08 版本锁断言消费复核） */
  buildFn?: typeof build;
}

/**
 * TsExecutor（§3 组件行：esbuild bundle＋entry 生成＋RUN_AS_NODE＋source-map-support）。
 */
export class TsExecutor {
  constructor(private readonly deps: TsExecutorDeps) {}

  /** 写 entry 文件（entryPath=落盘绝对路径；S-5 冻结形，import 相对基准=entryPath 所在目录） */
  writeEntry(scriptPath: string, entryPath: string, entryFn: string): void {
    const fn = entryFn === '' ? 'run' : entryFn;
    const rel = path.relative(path.dirname(entryPath), scriptPath).replaceAll('\\', '/');
    const importPath = rel.startsWith('.') ? rel : `./${rel}`;
    const member = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fn) ? `m.${fn}` : `m[${JSON.stringify(fn)}]`;
    const source = [
      '// Constella SandboxExecutor 生成 entry（S-5 冻结形——勿手改）',
      "import { boot } from '@constella/sdk/bootstrap';",
      `import * as m from '${importPath}';`,
      `boot(${member});`,
      '',
    ].join('\n');
    mkdirSync(path.dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, source, 'utf8');
  }

  /**
   * bundle＋spawn 规格（§3 组件级接口 `prepare(scriptPath,entry): {cmd,args,env}`——
   * entry=已写好的 entry 文件绝对路径；bundle 产物=同目录 bundle.cjs＋bundle.cjs.map〔linked〕）。
   */
  async prepare(
    scriptPath: string,
    entry: string,
  ): Promise<{ cmd: string; args: string[]; env: Record<string, string> }> {
    void scriptPath; // 脚本经 entry 相对 import 已入 bundle 图（保留形参=§3 冻结签名）
    const bundlePath = path.join(path.dirname(entry), 'bundle.cjs');
    const doBuild = this.deps.buildFn ?? build;
    await doBuild({
      entryPoints: [entry],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      sourcemap: 'linked',
      alias: {
        '@constella/sdk/bootstrap': this.deps.sdkModules.bootstrap,
        '@constella/sdk': this.deps.sdkModules.sdk,
      },
      logLevel: 'silent',
    });
    return {
      cmd: this.deps.execPath ?? process.execPath,
      args: ['--enable-source-maps', bundlePath],
      env: { ELECTRON_RUN_AS_NODE: '1' }, // S-5 ④ 显式注入（漏注=Electron main 语义不退出）
    };
  }
}
