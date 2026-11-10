// zip 域 payload（X-01 §1 ipc 行；02 §3.4 zip:export/import（v1.0b 勘误：两段式＋打包变体）；
// X-01 M4 收口增补 ③；C-08 §1 通道面冻结表；C-M1 §1：错误码 ZIP-WRITE-FAILED /
// ZIP-FLOW-NOT-FOUND / ZIP-INVALID / ZIP-UNSAFE-ENTRY；管线与 12.2#4 安全校验本体归 C-08）。
import type { PackageManifest, ScriptRef } from '../manifest/package-manifest';
import type { FlowNode } from './storage.payload';

// ———— zip:export（两变体；02 §3.4 v1.0b：发布打包变体 {types[],savePath,meta}，checksum=SHA-256 幂等键）————

/** 流程导出变体：{flowId,savePath} → {file,count,scripts}（02 §3.4；空流程拒绝归 C-08） */
export interface ZipExportFlowReq {
  flowId: string;
  savePath: string;
}

export interface ZipExportFlowRes {
  file: string;
  count: number;
  scripts: ScriptRef[];
}

/** 发布打包变体（✅ 02 v1.0b＋X-01 #8⑨；C-08 §1 exportPackage：勾选节点集→四件套 zip＋SHA-256，
 * C-09 Publisher 消费；meta 形＝C-08 §1 冻结 {name}） */
export interface ZipExportPublishReq {
  types: string[];
  savePath: string;
  meta: { name: string };
}

export interface ZipExportPublishRes {
  filePath: string;
  checksum: string;
}

/** 流程导出字节变体（✅ 02 v1.0f 勘误〔2026-11-10 PM 裁决〕：`{flowId}` 无 savePath——
 * flow 发布产物上传链消费；nodes/*.json BFS 拓扑序＝「FlowSteps 序列化」语义的物化形
 * （01 A-13.2），不上传裸 steps JSON） */
export interface ZipExportFlowBytesReq {
  flowId: string;
}

/** 发布打包字节变体（✅ 02 v1.0f 同源：`{types[],meta}` 无 savePath——multipart 免文件读回
 * 〔renderer 无 fs 读面，与 v1.0e import 字节变体对称〕） */
export interface ZipExportPublishBytesReq {
  types: string[];
  meta: { name: string };
}

/** 字节变体统一响应（v1.0f 冻结形）：产物字节＋节点数＋脚本清单＋SHA-256（幂等键） */
export interface ZipExportBytesRes {
  bytes: Uint8Array;
  count: number;
  scripts: ScriptRef[];
  checksum: string;
}

/** zip:export req/res 联合（通道同面；✅ v1.0f：盘双变体＋字节双变体=四变体——
 * **通道名/通道数不变**（check-ipc-surface 面不受影响）） */
export type ZipExportReq = ZipExportFlowReq | ZipExportPublishReq | ZipExportFlowBytesReq | ZipExportPublishBytesReq;
export type ZipExportRes = ZipExportFlowRes | ZipExportPublishRes | ZipExportBytesRes;

// ———— zip:import（两段式：inspect → confirm 回调（renderer 侧）→ commit；02 v1.0b）————

/** inspect 段：{path,phase:'inspect'} → 安全校验+解析＝summary **不落盘不入库**（02 §12.2#2）＋token */
export interface ZipImportInspectReq {
  path: string;
  phase: 'inspect';
}

/** inspect 段字节变体（✅ 02 v1.0e 勘误〔2026-11-10 PM 裁决〕：`{bytes}` 变体——market download
 * 字节直入导入链，不落临时文件；响应形/token 语义与 path 变体同面） */
export interface ZipImportInspectBytesReq {
  bytes: Uint8Array;
  phase: 'inspect';
}

/** inspect 段响应＝导入清单（C-08 §1 ImportSummary 冻结形）＋token（绑定内容 SHA-256，防调包） */
export interface ZipImportInspectRes {
  /** 节点清单（C-08 §1 冻结 unknown[]；瀑布排布前原始清单） */
  nodes: unknown[];
  /** 无脚本节点（noScript 标记面；安装确认明示「不可运行」） */
  noScript: string[];
  /** 类目集合（perms 推导输入——renderer 经 C-05 derivePerms(categories) 同源推导） */
  categories: string[];
  /** zip manifest 原文 */
  manifest: PackageManifest;
  /** 绑定 inspect 内容的 SHA-256 token（commit 段复验防调包） */
  token: string;
}

/** commit 段：{path,phase:'commit',token} → 解包落盘+assetPackages.upsert+definitions.upsert →
 * {nodes[],noScript[]}（token 复验失败＝ZIP-UNSAFE-ENTRY 面） */
export interface ZipImportCommitReq {
  path: string;
  phase: 'commit';
  token: string;
}

/** commit 段字节变体（✅ 02 v1.0e 同源：bytes 链 commit 段不落临时文件——renderer 持 download
 * 字节重传；token 复验=bytes 内容 SHA-256，与 path 变体同语义） */
export interface ZipImportCommitBytesReq {
  bytes: Uint8Array;
  phase: 'commit';
  token: string;
}

/** 导入产物节点（C-08 §1 ImportedNode；瀑布排布入画布的节点实例——形=FlowDoc.nodes 元素） */
export type ImportedNode = FlowNode;

/** commit 段响应（＝02 §3.4 zip:import 响应形 {nodes[],noScript[]}） */
export interface ZipImportCommitRes {
  nodes: ImportedNode[];
  noScript: string[];
}

/** zip:import req/res 联合（两段式同通道；X-01 #8⑧③；✅ v1.0e：path/bytes 双源 × inspect/commit
 * 两段=四变体——**通道名/通道数不变**（check-ipc-surface 面不受影响）） */
export type ZipImportReq =
  | ZipImportInspectReq
  | ZipImportCommitReq
  | ZipImportInspectBytesReq
  | ZipImportCommitBytesReq;
export type ZipImportRes = ZipImportInspectRes | ZipImportCommitRes;
