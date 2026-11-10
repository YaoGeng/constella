// ImportOrchestrator —— renderer 导入编排面（T5-07 / TDD-C-08 §3 组件行＋§1 接口冻结形）。
//
// 两段式编排（§1）：inspect（安全校验+解析=summary **不落盘不入库**——12.2#2）→ C-02 校验
// （inspect 段逐定义校验——validateDefinition 注入，ctx.hasType=C-05 注入且**排除自身**——
// 同名同型覆盖〔A-11.1〕不受动态查误伤，types.ts L36 装配口径）→ confirm（注入回调——实现=
// C-09 InstallConfirm 装配点注入，单测可注入 ()=>true；source='builtin'=官方示例包免确认
// 〔W-35 裁定 A〕；未注入且非 builtin=未确认取消——12.2#2 安全缺省）→ commit（token 复验在
// main）→ WaterfallPlacer 瀑布（每项右移 36px/下移 40px——demo L2630）→ CanvasSink.dropNodes
// 整批单历史项可撤销（T3-08 导出面签名）＋markDirty → library.upsert（demo L2632-2643 同构：
// 有脚本节点带 scriptMeta）→ C-05 register（注册表刷新）。
//
// importArchive=单一入口（§2 ↑被依赖：C-07 NodeDevAgent「开发即沉淀」/C-09 安装链共用——
// 接口冻结形）。P-3：bridge=注入式 IPC 面（同 ExportOrchestrator 惯例）；本面零 zip 库依赖
// （§6.8 读写收窄 main）；零 C-01/C-07/C-09 import（CanvasSink/confirm 经注入）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PermLabel } from '@constella/shared/dto';
import type { ImportedNode, StorageInvokeReq, ZipImportReq, ZipImportRes } from '@constella/shared/ipc';
import type { PackageManifest, ScriptRef } from '@constella/shared/manifest';
import { createWaterfallPlacer } from './waterfall-placer';

/** §1 冻结形：ImportSummary（=X-01 ZipImportInspectRes 去 token——清单面） */
export interface ImportSummary {
  nodes: unknown[];
  noScript: string[];
  categories: string[];
  manifest: PackageManifest;
}

/** §1 冻结形：ImportResult（=02 §3.4 zip:import 响应形——commit 段返回） */
export interface ImportResult {
  nodes: ImportedNode[];
  noScript: string[];
}

/** bytes 链 inspect 产物（✅ 02 v1.0e〔T5-10〕：flow 安装链消费面——summary＋token；
 *  confirm/落图/入库不在本面（12.2#2 责任在调用方 C-09 Installer——链首已弹确认框） */
export interface ImportInspectOutcome {
  summary: ImportSummary;
  token: string;
}

/** 导入编排 IPC 面（window.constella 子集——装配点直传 preload API） */
export interface ZipImportBridge {
  /** zip:import（两段式同通道——02 v1.0b） */
  zipImport(payload: ZipImportReq): Promise<ZipImportRes>;
  /** storage:invoke（library.upsert——C-06 面） */
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
}

/** C-05 注册表注入面（§2 imports ↓：get/has/register 子集——同层注入、无 import 边） */
export interface ImportRegistryFace {
  has(type: string): boolean;
  register(doc: NodeDefinition): void;
}

/** C-02 validateDefinition 注入形（T4-07 单一来源——伪装类型拦截 02 §12.4） */
export type ImportDefinitionValidator = (
  doc: NodeDefinition,
  ctx?: { hasType(t: string): boolean },
) => { ok: boolean; errors: Array<{ field: string; message: string }> };

/** CanvasSink 注入面（T3-08 导出面 dropNodes/markDirty 的结构子集——C-01 域装配传入） */
export interface ImportCanvasSink {
  /** 瀑布落点整批一次可撤销（坐标由调用方按 +36/+40 计——本编排经 WaterfallPlacer；
   *  name/noScript=序列化语义字段透传——T5-07 评审裁定 B 转交） */
  dropNodes(
    specs: ReadonlyArray<{
      type: string;
      params?: Record<string, unknown>;
      x: number;
      y: number;
      name?: string;
      noScript?: boolean;
    }>,
  ): string[];
  /** A-5.1 脏标记 */
  markDirty(): void;
}

/** confirm 回调注入形（实现=C-09 InstallConfirm 装配点注入；单测注入 ()=>true） */
export type ImportConfirm = (summary: ImportSummary) => Promise<boolean>;

export interface ImportOrchestratorDeps {
  bridge: ZipImportBridge;
  registry: ImportRegistryFace;
  validate: ImportDefinitionValidator;
  canvasSink: ImportCanvasSink;
  /** 视口中心世界坐标（WaterfallPlacer 基准——应用壳注入） */
  viewportCenter(): { x: number; y: number };
  /** perms 同源推导（C-05 PermDeriver 同表类目→标签——装配点注入；缺省不推导） */
  derivePerms?(categories: readonly string[]): PermLabel[];
  /** 日志/toast 面（warn 点名+toast 计数——demo L2637-2643 同构；缺省不记） */
  notify?(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  /** 开发面日志（缺省不记） */
  log?: (...args: unknown[]) => void;
}

export interface ImportArchiveOpts {
  /** 安装确认（12.2#2——未确认不入库；缺省且 source='user'=取消） */
  confirm?: ImportConfirm;
  /** 'builtin'=官方示例包免确认（W-35 裁定 A：官方分发域——经同一安全校验+hash 幂等） */
  source?: 'user' | 'builtin';
}

/** 用户取消导入（confirm 拒绝/缺省——编排面向 UI 的显式信号，非错误弹窗面） */
export class ImportCancelledError extends Error {
  readonly cancelled = true;
  constructor() {
    super('已取消导入（未确认不入库——02 §12.2#2）');
    this.name = 'ImportCancelledError';
  }
}

let libSeq = 0;
function newLibraryEntryId(): string {
  return `lib-${Date.now().toString(36)}-${(libSeq++).toString(36)}`;
}

/** summary.nodes 元素运行时形（main PackageParser 产物——X-01 unknown[] 的消费侧收窄） */
interface ParsedSummaryNode {
  type: string;
  name: string;
  definition?: NodeDefinition;
}

export interface ImportOrchestrator {
  /** §1 冻结形：importArchive(path, opts?)——C-07/C-09 共用单一入口 */
  importArchive(path: string, opts?: ImportArchiveOpts): Promise<ImportResult>;
  /** bytes 全链（✅ 02 v1.0e〔T5-10〕）：与 importArchive 同构——market download 字节直入
   *  （node/pack 安装链消费；confirm 注入=InstallConfirm 装配点共用一框） */
  importArchiveBytes(bytes: Uint8Array, opts?: ImportArchiveOpts): Promise<ImportResult>;
  /** bytes inspect 面（flow 安装链消费：安全校验＋C-02 校验＝summary+token；不 confirm 不落盘
   *  不入库——12.2#2 责任在调用方，confirm 归 C-09 Installer 链首框） */
  inspectBytes(bytes: Uint8Array): Promise<ImportInspectOutcome>;
  /** bytes commit 面（flow 安装链消费：资产落盘＋register(defs)；不落画布不入节点库——落图归
   *  C-09 FlowInstaller 新流程，library 归节点库语义两分） */
  commitBytes(bytes: Uint8Array, token: string, defs?: ReadonlyArray<NodeDefinition>): Promise<ImportResult>;
}

/** inspect/commit req 源归一（path/bytes 双源——02 v1.0e） */
function inspectReqOf(source: { path: string } | { bytes: Uint8Array }): ZipImportReq {
  return 'path' in source ? { path: source.path, phase: 'inspect' } : { bytes: source.bytes, phase: 'inspect' };
}
function commitReqOf(source: { path: string } | { bytes: Uint8Array }, token: string): ZipImportReq {
  return 'path' in source ? { path: source.path, phase: 'commit', token } : { bytes: source.bytes, phase: 'commit', token };
}

export function createImportOrchestrator(deps: ImportOrchestratorDeps): ImportOrchestrator {
  const placer = createWaterfallPlacer({ viewportCenter: deps.viewportCenter });

  /** ② 段：C-02 逐定义校验（inspect 产物——伪装类型拦截 02 §12.4；ctx 排除自身：
   *  同名同型覆盖 A-11.1 不受动态查误伤——namespace-guard 装配口径）。返回去重定义集。 */
  function validateSummaryDefs(summary: ImportSummary): Map<string, NodeDefinition> {
    const seenDefs = new Map<string, NodeDefinition>();
    for (const raw of summary.nodes) {
      const n = raw as ParsedSummaryNode;
      if (n?.definition === undefined || n.definition === null) continue;
      const def = n.definition;
      if (seenDefs.has(def.type)) continue;
      seenDefs.set(def.type, def);
      const ctx = { hasType: (t: string) => t !== def.type && deps.registry.has(t) };
      const verdict = deps.validate(def, ctx);
      if (!verdict.ok) {
        const first = verdict.errors[0];
        const msg = `定义校验失败拒入：${def.type}——${first?.field ?? ''} ${first?.message ?? ''}（不静默改名，02 §12.4）`;
        deps.notify?.('err', msg);
        throw new Error(msg);
      }
    }
    return seenDefs;
  }

  /** 全链导入主体（path/bytes 双源共用——02 v1.0e 后唯一行为差异=通道 req 源字段） */
  async function runImport(source: { path: string } | { bytes: Uint8Array }, opts: ImportArchiveOpts): Promise<ImportResult> {
    // ———— ① inspect：安全校验+解析＝summary（main——不落盘不入库）＋token ————
    const inspectRes = await deps.bridge.zipImport(inspectReqOf(source));
    if (!('token' in inspectRes)) throw new Error('zip:import 响应变体不符（inspect 段应回 summary+token）');
    const summary: ImportSummary = {
      nodes: inspectRes.nodes,
      noScript: inspectRes.noScript,
      categories: inspectRes.categories,
      manifest: inspectRes.manifest,
    };

    // ———— ② C-02 逐定义校验 ————
    const seenDefs = validateSummaryDefs(summary);

    // ———— ③ confirm（12.2#2：未确认不入库；builtin 免确认——W-35 裁定 A）————
    if (opts.source !== 'builtin') {
      const confirmed = opts.confirm !== undefined ? await opts.confirm(summary) : false;
      if (!confirmed) throw new ImportCancelledError();
    }
    // perms 同源推导（安装确认面已过——12.2#2 消费；本编排在此触发供 notify 留痕）
    const perms = deps.derivePerms?.(summary.categories) ?? [];
    if (perms.length > 0) deps.log?.(`[zip] 导入权限标签：${perms.join('、')}`);

    // ———— ④ commit：token 复验→解包落盘＋双 upsert（main——AssetInstaller）————
    const commitRes = await deps.bridge.zipImport(commitReqOf(source, inspectRes.token));
    if ('token' in commitRes) {
      throw new Error('zip:import 响应变体不符（commit 段应回 {nodes,noScript}）');
    }
    const nodes = commitRes.nodes;

    // ———— ⑤ 瀑布排布（每项 +36/+40）→ CanvasSink.dropNodes 整批单历史项＋markDirty ————
    //（name/noScript 透传——T5-07 评审裁定 B 转交：序列化语义字段不丢，运行闸不击穿）
    const positions = placer.positions(nodes.length);
    deps.canvasSink.dropNodes(
      nodes.map((n, i) => ({
        type: n.type,
        params: n.params,
        ...positions[i]!,
        ...(n.name !== undefined ? { name: n.name } : {}),
        ...(n.noScript === true ? { noScript: true } : {}),
      })),
    );
    deps.canvasSink.markDirty();

    // ———— ⑥ library.upsert（demo L2632-2643：有脚本节点带 scriptMeta）————
    const noScriptNames = new Set(commitRes.noScript);
    for (const n of nodes) {
      const ref = summary.manifest.scripts?.[n.name] ?? summary.manifest.scripts?.[n.type];
      const hasScript = !noScriptNames.has(n.name) && ref !== undefined;
      await deps.bridge.storageInvoke({
        op: 'library.upsert',
        args: {
          entry: {
            id: newLibraryEntryId(),
            name: n.name,
            type: n.type,
            params: n.params,
            // 无脚本=空占位（与 C-06 DAO rowToEntry 缺省同形——library_entries.script_meta 可空列）
            scriptMeta: hasScript ? { lang: (ref as ScriptRef).lang, file: (ref as ScriptRef).file } : { lang: 'ts', file: '' },
            updatedAt: Date.now(),
          },
        },
      });
    }

    // ———— ⑦ C-05 register（commit 后注册表刷新——同名同型覆盖）————
    for (const def of seenDefs.values()) deps.registry.register(def);

    // ———— ⑧ 通知面（demo L2635-2643 同构：成功 toast＋noScript warn 点名+计数）————
    deps.notify?.('ok', `已导入 ${nodes.length} 个节点`);
    if (commitRes.noScript.length > 0) {
      deps.notify?.('warn', `包内缺 scripts/：${commitRes.noScript.join('、')} — 这些节点无法运行（强节点没有脚本走不了）`);
      deps.notify?.('err', `⚠ ${commitRes.noScript.length} 个节点缺脚本，运行会失败`);
    }
    deps.log?.(`[zip] importArchive ${summary.manifest.name}（${nodes.length} 节点，脚本 ${nodes.length - commitRes.noScript.length} 个）`);
    return { nodes, noScript: commitRes.noScript };
  }

  return {
    importArchive: (path, opts) => runImport({ path }, opts ?? {}),
    importArchiveBytes: (bytes, opts) => runImport({ bytes }, opts ?? {}),
    async inspectBytes(bytes) {
      const inspectRes = await deps.bridge.zipImport({ bytes, phase: 'inspect' });
      if (!('token' in inspectRes)) throw new Error('zip:import 响应变体不符（inspect 段应回 summary+token）');
      const summary: ImportSummary = {
        nodes: inspectRes.nodes,
        noScript: inspectRes.noScript,
        categories: inspectRes.categories,
        manifest: inspectRes.manifest,
      };
      validateSummaryDefs(summary); // C-02 校验不缺位（bytes flow 链同防线——02 §12.4）
      return { summary, token: inspectRes.token };
    },
    async commitBytes(bytes, token, defs) {
      const commitRes = await deps.bridge.zipImport({ bytes, phase: 'commit', token });
      if ('token' in commitRes) {
        throw new Error('zip:import 响应变体不符（commit 段应回 {nodes,noScript}）');
      }
      // C-05 register 保留在 C-08 链内（03 C-09 §2——defs=inspect 段 seenDefs，调用方从
      // summary.nodes[].definition 提取传入；flow 链 custom 定义随资产落盘同步注册表）
      for (const def of defs ?? []) deps.registry.register(def);
      deps.log?.(`[zip] commitBytes ${commitRes.nodes.length} 节点（flow 安装链——落图归 C-09 FlowInstaller）`);
      return { nodes: commitRes.nodes, noScript: commitRes.noScript };
    },
  };
}
