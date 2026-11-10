// ExamplePreloader —— 首启预装器（T5-08 / TDD-C-08 §3 组件行＋「示例资产 9 首启装载」段）。
//
// 职责（03 L1888/L1890）：随 client 分发的 9 示例 zip（client/assets/examples——gen-examples.mjs
// 确定性产物）→ **经本卡 main 侧管线直调**（不经 zip:import 通道、通道面 24 不变）逐包 upsert
// 入库；幂等=asset_packages content_hash 防重＋同名同型 upsert。
//
// 免确认口径（W-35 裁定 A——03 L1890 ⚠a 收口）：source='builtin'=官方分发=可信来源，
// 免除 02 §12.2#2 安装确认；**经同一安全校验管线**——直调 AssetInstaller.commit（其内嵌
// validateMeta＋validate 全规则双跑＋token=内容 SHA-256 复验），不复制第二套校验代码。
// 挂载点=C-06 open()（迁移完成后、种子流程写入前——M4 裁决 2/#11），经注入回调触发
// （AppRuntime deps.preloadExamples——production-assembly 装配，P-3 不 import C-06/C-M1）。
//
// 幂等序（§6.7「二启零 delta」）：逐包 readFile→SHA-256→assetPackages.hasHash 命中即整包
// 跳过（零 upsert＝updated_at 不动、零落盘）→ 未命中才 commit（token=hash——同一字节流自洽
// 复验）。资产升级（03 §8 扩展点②）：随分发替换 zip→hash 变化→自动预装新包，旧定义同名
// 同型 upsert 覆盖。
//
// 失败策略（锚含糊 ⚠ 本卡冻结、随卡评审）：单包失败**不阻断启动**——预装=增强面，逐包
// try/catch 隔离＋日志点名（损坏/缺失属分发缺陷，大声留痕供诊断），其余包照常预装；
// examplesDir 整体缺失同理（installed=0＋warn）。
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetInstaller } from './asset-installer';

export interface ExamplePreloaderDeps {
  /** 示例 zip 目录（生产=client/assets/examples 随分发；只认 *.zip、字典序稳定） */
  examplesDir: string;
  /** 导入链 commit 段（T5-07 复用——安全校验双跑＋解包落盘＋definitions/assetPackages 双 upsert） */
  installer: AssetInstaller;
  /** C-06 直调点（main 内部面）：content_hash 幂等查——命中即整包跳过（二启零 delta） */
  assetPackages: { hasHash(contentHash: string): boolean };
  /** 日志面（缺省不记） */
  log?: (...args: unknown[]) => void;
}

export interface ExamplePreloader {
  /** §3 冻结组件级接口：扫描示例 zip→逐包 hash 防重＋全安检直调 commit→{installed} */
  preloadIfMissing(): Promise<{ installed: number }>;
}

export function createExamplePreloader(deps: ExamplePreloaderDeps): ExamplePreloader {
  return {
    async preloadIfMissing() {
      let zips: string[];
      try {
        zips = (await readdir(deps.examplesDir)).filter((f) => f.endsWith('.zip')).sort();
      } catch (err) {
        // 目录缺失/不可读=增强面降级（不阻断启动——open 装配序继续走种子）
        deps.log?.(
          `[example-preloader] 示例目录不可读（跳过预装）：${deps.examplesDir}——`,
          err instanceof Error ? err.message : String(err),
        );
        return { installed: 0 };
      }

      let installed = 0;
      let failed = 0;
      for (const name of zips) {
        const zipPath = path.join(deps.examplesDir, name);
        try {
          const bytes = await readFile(zipPath);
          const contentHash = createHash('sha256').update(bytes).digest('hex');
          if (deps.assetPackages.hasHash(contentHash)) continue; // 幂等：同 hash 已登记→整包跳过
          // 直调 commit（token=hash：同一字节流自洽复验）；免确认=无 inspect→confirm 段
          // （W-35 裁定 A——官方分发经同一安全校验管线）
          await deps.installer.commit(zipPath, contentHash);
          installed += 1;
        } catch (err) {
          failed += 1; // 单包失败不阻断（⚠ 冻结策略）：点名留痕、继续其余包
          deps.log?.(
            `[example-preloader] 示例包 ${name} 预装失败（跳过，不阻断启动）：`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      deps.log?.(
        `[example-preloader] 预装完成：installed=${installed}/skipped=${zips.length - installed - failed}` +
          `/failed=${failed}（${deps.examplesDir}）`,
      );
      return { installed };
    },
  };
}
