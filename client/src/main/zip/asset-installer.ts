// AssetInstaller —— commit 段解包落盘执行器（T5-07 / TDD-C-08 §3 AssetInstaller 组件行）。
//
// 序（§3 组件行）：token=内容 SHA-256 复验（防 inspect→commit 间调包→ZIP-UNSAFE-ENTRY）→
// 安全校验双跑（validateMeta 解压前＋validate 全规则）→解析→definitions.upsert（**C-06 直调
// 点**；先行——asset_packages.node_type FK 父）→解包落盘 node-types/<type>/<ver>/（§4 资产
// 目录布局；mtime 经 DosTimeConverter.restoreLocal 还原——S-6 ① 历史包本地墙钟口径）→
// assetPackages.upsert（content_hash=token——同包二次导入恰一行，hash 防重）。
//
// 落盘裁量（§4 布局字面）：包内全量条目（manifest/nodes/scripts/config/deps）拷入每个引入
// 类型目录 node-types/<type>/<packageVersion>/——多类型 pack 各持完整四件套（运行面
// （SandboxExecutor 白名单）只消费 scripts/config，重复为布局忠实）；纯内置节点流程包无
// custom 定义→零落盘零登记（02 §7.1 asset_packages.node_type FK 无处可挂）。多类型包登记
// 单行（验收「同包恰一行」）：node_type=首类型、pkg_version=manifest.version。
import { createHash } from 'node:crypto';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC_ERROR_CODES, type ImportedNode } from '@constella/shared/ipc';
import { ZipError } from '../storage-bridge/zip-channels';
import { createDosTimeConverter } from './dos-time';
import type { PackageParser } from './package-parser';
import type { ZipReader } from './zip-reader';
import type { SecurityReport, ZipSecurityValidator } from './zip-security-validator';

export interface AssetInstallerDeps {
  reader: ZipReader;
  validator: ZipSecurityValidator;
  parser: PackageParser;
  /** 自注册资产根（userData/node-types——02 §8.4；与 SandboxExecutor nodeTypesRoot 同源） */
  nodeTypesRoot: string;
  /** C-06 直调点（definitions.upsert——main 内 DAO 面） */
  definitions: { upsert(doc: import('@constella/shared/dsl').NodeDefinition): void };
  /** C-06 直调点（assetPackages.upsert——content_hash 幂等） */
  assetPackages: {
    upsert(args: {
      nodeType: string;
      pkgVersion: string;
      contentHash: string;
      dir: string;
      manifest: unknown;
    }): { id: string; reused: boolean };
  };
  log?: (...args: unknown[]) => void;
}

export interface AssetInstaller {
  /** §3 冻结组件级接口：commit(path,token)——hash 复验→解包落盘→双 upsert→{nodes,noScript} */
  commit(path: string, token: string): Promise<{ nodes: ImportedNode[]; noScript: string[] }>;
}

function throwReport(report: Extract<SecurityReport, { ok: false }>): never {
  // SecurityReport 非 ok 的 code 收窄为 ZIP-INVALID/ZIP-UNSAFE-ENTRY（C-M1 §1 错误面）
  const code = report.code === 'ZIP-UNSAFE-ENTRY' ? IPC_ERROR_CODES.ZIP_UNSAFE_ENTRY : IPC_ERROR_CODES.ZIP_INVALID;
  throw new ZipError(code, report.message);
}

let nodeSeq = 0;
function newImportedNodeId(type: string): string {
  return `n-${type.replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}-${(nodeSeq++).toString(36)}`;
}

export function createAssetInstaller(deps: AssetInstallerDeps): AssetInstaller {
  const conv = createDosTimeConverter();
  return {
    async commit(zipPath, token) {
      // ① token=内容 SHA-256 复验（同一字节流——openBytes 复用，杜绝 readFile 双读调包窗口）
      const bytes = await readFile(zipPath);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      if (contentHash !== token) {
        throw new ZipError(
          IPC_ERROR_CODES.ZIP_UNSAFE_ENTRY,
          `导入令牌复验失败：包内容与 inspect 清单不符（${zipPath} 在确认前被调包？）`,
        );
      }

      // ② 安全校验双跑（§3 ZipSecurityValidator 复用处=inspect/commit 双跑）
      const archive = await deps.reader.openBytes(bytes);
      const metas = archive.metas();
      const metaReport = deps.validator.validateMeta(metas);
      if (!metaReport.ok) throwReport(metaReport);
      const entriesMap = await archive.readAll();
      const entries = metas.map((m) => ({
        ...m,
        ...(entriesMap.has(m.name) ? { data: entriesMap.get(m.name)! } : {}),
      }));
      const report = deps.validator.validate(entries);
      if (!report.ok) throwReport(report);

      // ③ 解析
      const parsed = deps.parser.parse(entriesMap);

      // ④ definitions.upsert（C-06 直调点；先于 assetPackages——node_type FK 父行）
      for (const def of parsed.definitions) deps.definitions.upsert(def);

      // ⑤ 解包落盘 node-types/<type>/<packageVersion>/（§4 布局：包内全量条目）
      let primaryDir: string | undefined;
      for (const def of parsed.definitions) {
        const dir = path.join(deps.nodeTypesRoot, def.type, def.packageVersion);
        await mkdir(dir, { recursive: true });
        for (const m of metas) {
          if (m.dir) continue; // 目录条目不落盘（真实目录由 mkdir 建）
          const target = path.join(dir, ...m.name.split('/'));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, entriesMap.get(m.name)!);
          if (m.date !== undefined) {
            // S-6 ①：历史包 DOS 时间=写包机本地墙钟错读——减本机 UTC 偏移还原（差=0 验收项）
            // utimes 的 number 形参按 Unix 秒解释——毫秒时间戳须传 Date
            const mtime = new Date(conv.restoreLocal(m.date.getTime()));
            await utimes(target, mtime, mtime);
          }
        }
        if (primaryDir === undefined) primaryDir = dir;
      }

      // ⑥ assetPackages.upsert（content_hash=token 防重——同包二次导入恰一行）
      if (parsed.definitions.length > 0 && primaryDir !== undefined) {
        deps.assetPackages.upsert({
          nodeType: parsed.definitions[0]!.type,
          pkgVersion: parsed.manifest.version,
          contentHash: token,
          dir: primaryDir,
          manifest: parsed.manifest,
        });
      }

      deps.log?.(
        `[zip] commit ${parsed.manifest.name}（${parsed.nodes.length} 节点/${parsed.definitions.length} 类型）→ ${primaryDir ?? '零落盘（纯内置节点包）'}`,
      );

      // ⑦ ImportedNode[]（FlowNode 形——id 本侧生成；position=包内原值，瀑布坐标归 renderer）
      const nodes: ImportedNode[] = parsed.nodes.map((n) => ({
        id: newImportedNodeId(n.type),
        type: n.type,
        name: n.name,
        position: n.position,
        params: n.params,
        ...(n.noScript ? { noScript: true } : {}),
      }));
      return { nodes, noScript: parsed.noScript };
    },
  };
}
