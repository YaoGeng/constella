// zip:import 两段式管线本体（T5-07 / TDD-C-08 §1 通道表 zip:import 行——02 v1.0b 勘误；
// ✅ 02 v1.0e 勘误〔2026-11-10 PM 裁决，T5-10 前置授权 2 落地〕：inspect/commit 增 `{bytes}`
// 变体——market download 字节直入导入链不落临时文件；通道名/通道数不变）。
//
// 注入位=T4-20 seam（storage-bridge/zip-channels ZipImportPipeline；production-assembly 经
// deps.zipImportPipeline 条件传入——index.ts 装配）。两段式同通道（path/bytes 双源）：
//   - inspect `{path|bytes,phase:'inspect'}` → 安全校验＋解析＝summary **不落盘不入库**（02 §12.2#2）
//     ＋token（绑定内容 SHA-256——commit 段复验防调包）；
//   - commit `{path|bytes,phase:'commit',token}` → AssetInstaller.commit/commitBytes（token 复验→
//     解包落盘→assetPackages.upsert→definitions.upsert）→ `{nodes[],noScript[]}`（02 §3.4 响应形）。
//
// 管线抛错统一 ZipError（Error+string code——经 IpcGateway serializeError 归一 {code,message}）。
// importArchive 单一入口（renderer ImportOrchestrator 编排——C-07 NodeDevAgent/C-09 安装链共用）。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { IPC_ERROR_CODES, type ZipImportReq, type ZipImportRes } from '@constella/shared/ipc';
import { ZipError, type ZipImportPipeline } from '../storage-bridge/zip-channels';
import type { AssetInstaller } from './asset-installer';
import type { PackageParser } from './package-parser';
import type { ZipReader } from './zip-reader';
import type { SecurityReport, ZipSecurityValidator } from './zip-security-validator';

export interface ZipImportPipelineDeps {
  reader: ZipReader;
  validator: ZipSecurityValidator;
  parser: PackageParser;
  installer: AssetInstaller;
  log?: (...args: unknown[]) => void;
}

function throwReport(report: Extract<SecurityReport, { ok: false }>): never {
  const code = report.code === 'ZIP-UNSAFE-ENTRY' ? IPC_ERROR_CODES.ZIP_UNSAFE_ENTRY : IPC_ERROR_CODES.ZIP_INVALID;
  throw new ZipError(code, report.message);
}

/** 源字节读取（path/bytes 双源归一——同一字节流语义，02 v1.0e） */
async function readSourceBytes(req: ZipImportReq): Promise<Uint8Array> {
  return 'bytes' in req ? req.bytes : readFile(req.path);
}

/** 读包＋安全校验双跑＋解析（inspect/commit 共用序——同一字节流） */
async function inspectPackage(
  deps: ZipImportPipelineDeps,
  bytes: Uint8Array,
): Promise<{ token: string; parsed: ReturnType<PackageParser['parse']> }> {
  const archive = await deps.reader.openBytes(bytes);
  const metaReport = deps.validator.validateMeta(archive.metas()); // 解压前限值（zip 炸弹）
  if (!metaReport.ok) throwReport(metaReport);
  const entriesMap = await archive.readAll();
  const entries = archive.metas().map((m) => ({
    ...m,
    ...(entriesMap.has(m.name) ? { data: entriesMap.get(m.name)! } : {}),
  }));
  const report = deps.validator.validate(entries); // 全规则（manifest JSON/Schema→ZIP-INVALID）
  if (!report.ok) throwReport(report);
  const parsed = deps.parser.parse(entriesMap);
  return { token: createHash('sha256').update(bytes).digest('hex'), parsed };
}

export function createZipImportPipeline(deps: ZipImportPipelineDeps): ZipImportPipeline {
  return async (req: Parameters<ZipImportPipeline>[0]): Promise<ZipImportRes> => {
    if (req.phase === 'inspect') {
      // inspect 段：summary＋token——不落盘不入库（12.2#2「未确认不入库」）
      const { token, parsed } = await inspectPackage(deps, await readSourceBytes(req));
      deps.log?.(`[zip] inspect ${parsed.manifest.name}（${parsed.nodes.length} 节点）——token=${token.slice(0, 12)}…`);
      return {
        nodes: parsed.nodes, // 瀑布排布前原始清单（X-01 unknown[]——renderer 消费）
        noScript: parsed.noScript,
        categories: parsed.categories,
        manifest: parsed.manifest,
        token,
      };
    }
    // commit 段：token 复验→解包落盘＋双 upsert（AssetInstaller——C-06 直调点；path/bytes 双源）
    const { nodes, noScript } =
      'bytes' in req ? await deps.installer.commitBytes(req.bytes, req.token) : await deps.installer.commit(req.path, req.token);
    return { nodes, noScript };
  };
}
