// zip:export 管线本体（T5-06 / TDD-C-08 §1 通道表 zip:export 行＋§4 四件套）——注入位=
// T4-20 seam（storage-bridge/zip-channels ZipExportPipeline；production-assembly 经
// deps.zipExportPipeline 条件传入）。
//
// 两变体（02 §3.4 v1.0b 勘误）：
//   - 流程导出 `{flowId,savePath}` → main 组装四件套→store 档写盘→`{file,count,scripts}`；
//   - 发布打包 `{types[],savePath,meta}` → 勾选类型集四件套＋SHA-256（幂等键——C-09 Publisher
//     消费）→`{filePath,checksum}`。
//
// 四件套（01 A-4.03；demo L2573-2602 参照非权威）：manifest.json（X-01 PackageManifest 源型：
// kind/name/version/scripts 映射）＋nodes/*.json＋scripts/*.py|*.ts（自注册资产目录取——
// node-types/<type>/<pkg_version>/，02 §8.4「与抽屉查看脚本预览同源」）＋config/*.yaml＋
// deps/（requirements.txt/package.json 按语言——demo L2591-2592）。
//
// 剥离口径：
//   - nodes/*.json 剥离 id·noScript（demo L2580）；
//   - X-20（C-08 §4）：secret 型参数值**整键剔除、仅保 schema 声明**——secret 键判定=定义
//     paramsSchema t==='secret'（schema 声明随定义保留在包内），另加防御扫描：任何形如
//     secret.param.* 的字符串值一律剔除（定义缺失时不漏剥）；
//   - 自定义类型定义随包（definition 键）——发布变体一律随包（自包含产物），流程变体仅
//     custom 随包（内置 12 平台自带；demo 同构）。
//
// 确定性：全部条目 DOS 时间取 ZIP_EPOCH（1980-01-01 UTC）——同输入同产物字节，checksum
// 为真内容幂等键（D-11 首发 v1.0.0；X-01 manifest 无 exportedAt 字段，源型不加）。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC_ERROR_CODES, type FlowDoc, type ZipExportReq, type ZipExportRes } from '@constella/shared/ipc';
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PackageManifest, ScriptRef } from '@constella/shared/manifest';
import { ZipError, type ZipExportPipeline } from '../storage-bridge/zip-channels';
import { createZipWriter, type ZipFileInput } from './zip-writer';

/** 确定性产物时间锚（DOS 纪元 1980-01-01T00:00:00Z——checksum 幂等前提；S-6 ① UTC 自洽口径） */
export const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/** demo L2591 原文（deps/requirements.txt——python 按语言缺省） */
const PY_DEPS = '# 自研节点脚本依赖 [AI 生成]\nhttpx>=0.27\npyyaml>=6.0\n';
/** demo L2592 原文（deps/package.json——ts 按语言缺省） */
const TS_DEPS = JSON.stringify(
  { name: 'constella-node-scripts', private: true, dependencies: { '@constella/sdk': '^1.0.0' } },
  null,
  2,
);

export interface ZipExportPipelineDeps {
  /** 流程读取面（生产=flows DAO get——缺流程→ZIP-FLOW-NOT-FOUND） */
  getFlow(flowId: string): FlowDoc | undefined;
  /** 定义读取面（生产=definitions DAO loadAll 投影——secret 剥离/脚本映射/定义随包） */
  getDefinition(type: string): NodeDefinition | undefined;
  /** 自注册资产根（scripts/config 内容源：node-types/<type>/<pkg_version>/，02 §8.4） */
  nodeTypesRoot: string;
  /** 日志面（缺省不记） */
  log?: (...args: unknown[]) => void;
}

/** 防御扫描：secret 引用键形（SecretParamBinder refKeyOf `secret.param.<scope>.<k>`） */
function isSecretRefValue(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('secret.param.');
}

/** X-20：secret 型参数值整键剔除（schema 声明在定义 paramsSchema——随 definition 保留） */
function stripSecretParams(params: Record<string, unknown>, def: NodeDefinition | undefined): Record<string, unknown> {
  const secretKeys = new Set(
    (def?.paramsSchema ?? []).filter((f) => f.t === 'secret').map((f) => f.k),
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (secretKeys.has(k) || isSecretRefValue(v)) continue; // 整键剥离（值与引用键均不携带）
    out[k] = v;
  }
  return out;
}

/** demo L2579：节点名→安全文件名段（非法字符→_；中文名保留——UTF-8 文件名） */
function safeStem(name: string): string {
  return (name || 'node').replace(/[\\/:*?"<>|]/g, '_') || 'node';
}

/** 同名去重（demo 未处理——同流程重名节点追加 -2/-3 保持包内条目唯一） */
function uniqueStem(base: string, used: Map<string, number>): string {
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

interface AssembledPackage {
  files: ZipFileInput[];
  manifest: PackageManifest;
  scriptRefs: ScriptRef[];
}

/** 资产文件读取（自注册资产目录；缺文件大声失败——资产完整性 ZIP-WRITE-FAILED 点名） */
async function readAsset(deps: ZipExportPipelineDeps, def: NodeDefinition, rel: string): Promise<string> {
  try {
    return await readFile(path.join(deps.nodeTypesRoot, def.type, def.packageVersion, rel), 'utf8');
  } catch (err) {
    throw new ZipError(
      IPC_ERROR_CODES.ZIP_WRITE_FAILED,
      `资产文件缺失：${def.type}（pkg ${def.packageVersion}）→ ${rel}（${err instanceof Error ? err.message : String(err)}）`,
    );
  }
}

/** 自定义类型脚本资产收集（demo doneTypes 同型去重；scripts/config 入包＋ScriptRef 登记） */
async function collectTypeAssets(
  deps: ZipExportPipelineDeps,
  def: NodeDefinition | undefined,
  doneTypes: Set<string>,
  files: ZipFileInput[],
  scriptRefs: ScriptRef[],
): Promise<ScriptRef | undefined> {
  if (def === undefined || def.kind !== 'custom' || def.exec === null || doneTypes.has(def.type)) {
    return undefined;
  }
  doneTypes.add(def.type);
  const exec = def.exec;
  files.push({ name: exec.file, data: await readAsset(deps, def, exec.file) });
  if (exec.config !== undefined) {
    files.push({ name: exec.config, data: await readAsset(deps, def, exec.config) });
  }
  const ref: ScriptRef = { file: exec.file, lang: exec.lang, entry: exec.entry };
  scriptRefs.push(ref);
  return ref;
}

export function createZipExportPipeline(deps: ZipExportPipelineDeps): ZipExportPipeline {
  const writer = createZipWriter();
  return async (req: ZipExportReq): Promise<ZipExportRes> => {
    if ('flowId' in req) return exportFlowVariant(deps, writer, req);
    return exportPublishVariant(deps, writer, req);
  };
}

/** 流程导出变体：{flowId,savePath} → {file,count,scripts} */
async function exportFlowVariant(
  deps: ZipExportPipelineDeps,
  writer: ReturnType<typeof createZipWriter>,
  req: { flowId: string; savePath: string },
): Promise<{ file: string; count: number; scripts: ScriptRef[] }> {
  const flow = deps.getFlow(req.flowId);
  if (flow === undefined) {
    throw new ZipError(IPC_ERROR_CODES.ZIP_FLOW_NOT_FOUND, `流程不存在：${req.flowId}`);
  }
  if (flow.nodes.length === 0) {
    // renderer ExportOrchestrator 首道拒绝（demo L2575 文案）；main 侧兜底同文案
    throw new ZipError(IPC_ERROR_CODES.ZIP_WRITE_FAILED, '当前流程没有节点可导出');
  }

  const files: ZipFileInput[] = [];
  const scriptRefs: ScriptRef[] = [];
  const scriptsMap: Record<string, ScriptRef> = {};
  const doneTypes = new Set<string>();
  const usedStems = new Map<string, number>();

  for (const node of flow.nodes) {
    const def = deps.getDefinition(node.type);
    const entry: Record<string, unknown> = {
      type: node.type,
      name: node.name,
      position: node.position,
      params: stripSecretParams(node.params, def), // X-20：secret 整键剔除
    };
    if (def?.kind === 'custom') entry.definition = def; // 自定义定义随包（含 paramsSchema=「仅保 schema 声明」载体）
    files.push({
      name: `nodes/${uniqueStem(safeStem(node.name), usedStems)}.json`, // id·noScript 不入包（demo L2580）
      data: JSON.stringify(entry, null, 2),
    });
    const ref = await collectTypeAssets(deps, def, doneTypes, files, scriptRefs);
    if (ref !== undefined) scriptsMap[node.name] = ref; // manifest.scripts：node→{file,lang,entry}（X-01）
  }

  appendDepsFiles(files, scriptRefs);
  files.unshift({ name: 'manifest.json', data: manifestJson({ kind: 'flow', name: flow.name, scriptsMap }) });
  await writer.write(files, req.savePath, { date: ZIP_EPOCH });
  deps.log?.(`[zip] exportFlow ${flow.name}（${flow.nodes.length} 节点）→ ${req.savePath}`);
  return { file: req.savePath, count: flow.nodes.length, scripts: scriptRefs };
}

/** 发布打包变体：{types[],savePath,meta} → {filePath,checksum}（SHA-256 幂等键） */
async function exportPublishVariant(
  deps: ZipExportPipelineDeps,
  writer: ReturnType<typeof createZipWriter>,
  req: { types: string[]; savePath: string; meta: { name: string } },
): Promise<{ filePath: string; checksum: string }> {
  if (req.types.length === 0) {
    throw new ZipError(IPC_ERROR_CODES.ZIP_WRITE_FAILED, '未勾选任何节点类型——发布打包需至少一个类型');
  }
  const files: ZipFileInput[] = [];
  const scriptRefs: ScriptRef[] = [];
  const scriptsMap: Record<string, ScriptRef> = {};
  const doneTypes = new Set<string>();
  const usedStems = new Map<string, number>();

  for (const type of req.types) {
    const def = deps.getDefinition(type);
    if (def === undefined) {
      throw new ZipError(IPC_ERROR_CODES.ZIP_WRITE_FAILED, `未知节点类型：${type}（发布打包需类型已在定义库）`);
    }
    // 发布物自包含：定义一律随包（导入侧 definitions.upsert 输入——C-08 §3 AssetInstaller）
    const entry = { type, name: def.meta.name, definition: def };
    files.push({ name: `nodes/${uniqueStem(safeStem(def.meta.name), usedStems)}.json`, data: JSON.stringify(entry, null, 2) });
    const ref = await collectTypeAssets(deps, def, doneTypes, files, scriptRefs);
    if (ref !== undefined) scriptsMap[type] = ref; // 发布变体映射键=类型（包无实例——T5-07 消费注记）
  }

  appendDepsFiles(files, scriptRefs);
  const kind = req.types.length === 1 ? 'node' : 'pack'; // X-01：node 单类型 / pack 节点集
  files.unshift({ name: 'manifest.json', data: manifestJson({ kind, name: req.meta.name, scriptsMap }) });
  const { bytes } = await writer.write(files, req.savePath, { date: ZIP_EPOCH });
  const checksum = createHash('sha256').update(bytes).digest('hex');
  deps.log?.(`[zip] exportPackage ${req.meta.name}（${req.types.length} 类型）→ ${req.savePath}`);
  return { filePath: req.savePath, checksum };
}

/** deps 按语言（demo L2591-2592：python→requirements.txt、ts→package.json） */
function appendDepsFiles(files: ZipFileInput[], scriptRefs: ScriptRef[]): void {
  const langs = new Set(scriptRefs.map((s) => s.lang));
  if (langs.has('python')) files.push({ name: 'deps/requirements.txt', data: PY_DEPS });
  if (langs.has('ts')) files.push({ name: 'deps/package.json', data: TS_DEPS });
}

/** manifest.json＝X-01 PackageManifest 源型（kind/name/version＋scripts 可缺） */
function manifestJson(m: { kind: PackageManifest['kind']; name: string; scriptsMap: Record<string, ScriptRef> }): string {
  const manifest: PackageManifest = {
    kind: m.kind,
    name: m.name,
    version: '1.0.0', // D-11 ⚠：首发 v1.0.0、V1 单版本覆盖更新
    ...(Object.keys(m.scriptsMap).length > 0 ? { scripts: m.scriptsMap } : {}),
  };
  return JSON.stringify(manifest, null, 2);
}
