// SavePipeline —— 手动编辑器保存链（T6-09 / TDD-C-13 §3 SavePipeline 行＋§1 saveToLibrary
// 签名；05 T6-09 卡链序逐环节）：validateDefinition（C-02 单一来源）→命名空间检查（C-05
// hasType＋X-01 BUILTIN_TYPE_IDS 双查）→C-05 register→C-06 upsertDefinition→资产包落盘
// （C-08 同一导入链——「开发即沉淀」）；同名同型=覆盖不新增（A-11.1）。
// **library.upsert 单写=链内 ImportOrchestrator ⑥段**（T6-19 A1 遗留1 去重——原显式段与
// 链内段每存两条；params 模板〔N3 default 投影〕经 assemble params 层随包入链，与 C-07
// NodeDevAgent「✨new 步骤 params 随链消费」同形——实例层即入库数据源）。
//
//   导入形态（v1.0e 对齐——03 L1101 勘误注 2026-11-10 PM）：内存 zip bytes 直入
// `importArchiveBytes`（confirm 自动放行——用户确认已在保存钮收口，A-10.2 不双收，同 T5-03
// adoptDraft 口径）；「先落 cache 临时文件再 importArchive(path)」的 M4#10 旧收口已被该勘误
// 显式覆盖（「C-13 §2 同解同步」——cache 临时文件转 V2 扩展点）。零新通道（24 通道冻结面
// 不动）、与 C-07 NodeDevAgent 产物同链同题同解（D-11 产物等价——无来源歧视）。
//
//   M5（batch-3 转交 1）：保存链只打包当前 lang——assetsFromScriptDraft（ScriptDraft→
// SaveAssets 适配层）只产当前语言脚本条目，未选中语言草稿文本的语法错不拦（不进校验门）
// 不打包（不进 assets/zip）。
//
//   P-3：产物组装器/导入链/注册表/存储全部经构造注入（组装器与 T5-03 assembleNodePackage
// 同件注入——产物等价单一来源；本模块不 import workshop/zip 运行时件，仅 type 引 C-08 面）。
// 校验投影复用 computeStepErrors（./definition-draft——环节门与保存门同一来源，防两套规则漂移）。
import type { ExecSpec, NodeDefinition } from '@constella/shared/dsl';
import type { ImportArchiveOpts, ImportResult } from '../zip/import-orchestrator';
import { computeStepErrors } from './definition-draft';
import type { ScriptDraft, StepErrors } from './definition-draft';
import type { ScriptLang } from './syntax-checker';

/** §1 SaveReport（02 §3.2 C-13 行关键接口逐字：{ok:true} | {ok:false, stepErrors}——错误定位到环节+字段） */
export type SaveReport = { ok: true } | { ok: false; stepErrors: StepErrors };

/** §1 保存资产（02 §3.2 逐字：scripts/config 两 Record——键=zip 包内相对路径、值=文本） */
export interface SaveAssets {
  scripts: Record<string, string>;
  config: Record<string, string>;
}

// ————————————————————————————————————————————
// 产物组装注入面（P-3：assembleNodePackage 同形——assembly 装配/测试注入真件）
// ————————————————————————————————————————————

/** 脚本资产（与 T5-03 NodePackageScript 同构——file=zip 包内相对路径〔与 exec.file 同值〕） */
export interface SavePackageScript {
  file: string;
  lang: 'python' | 'ts';
  entry: string;
  code: string;
}

/** config/deps 条目（file=包内相对路径；content=原文） */
export interface SavePackageFileEntry {
  file: string;
  content: string;
}

/** 四件套组装入参（与 T5-03 NodePackageParts 结构同构——结构类型相容即真件可注入） */
export interface SavePackageParts {
  definition: NodeDefinition;
  script?: SavePackageScript;
  config?: SavePackageFileEntry;
  params?: Record<string, unknown>;
  manifestName?: string;
}

export interface SaveAssembledPackage {
  bytes: Uint8Array;
}

/** 组装器注入形（生产=T5-03 assembleNodePackage 同件——zip 布局对齐基准、§6.3 diff 零） */
export type SavePackageAssembler = (parts: SavePackageParts) => SaveAssembledPackage;

/** C-08 导入链注入位（importArchiveBytes——保存链唯一写入通道；同 NodeDevAgent.DraftImportFace 形） */
export interface SaveImportFace {
  importArchiveBytes(bytes: Uint8Array, opts?: ImportArchiveOpts): Promise<ImportResult>;
}

export interface SavePipelineDeps {
  /** C-05 hasType（命名空间动态查——ctx 排除自身：同名同型覆盖 A-11.1 不误伤，同 T5-03 自检口径） */
  hasType?(t: string): boolean;
  /** 产物组装器（真件=T5-03 assembleNodePackage——D-11 产物等价单一来源） */
  assemble: SavePackageAssembler;
  /** C-05 register（运行时注册表 upsert——同名同型覆盖） */
  register(doc: NodeDefinition): void;
  /** C-06 upsertDefinition（definitions.upsert 持久化——IpcDefinitionStore 半段） */
  upsertDefinition(doc: NodeDefinition): Promise<void>;
  /** C-08 导入链（资产包落盘 node-types/＋library.upsert 单写⑥段——bytes 直入恰一次） */
  importer: SaveImportFace;
}

export interface NodeEditorSavePipeline {
  /** §1 接口（02 §3.2 逐字）：saveToLibrary(doc, assets): Promise<SaveReport> */
  saveToLibrary(doc: NodeDefinition, assets: SaveAssets): Promise<SaveReport>;
}

export type SavePipelineErrorCode =
  | 'SAVE-ASSETS' // assets 形违规（多脚本条目/非法后缀/路径穿越——构造性错误不静默折叠）
  | 'SAVE-IMPORT'; // 导入链失败（异常包装——链内错误非环节校验面）

export class SavePipelineError extends Error {
  readonly code: SavePipelineErrorCode;
  constructor(code: SavePipelineErrorCode, message: string) {
    super(message);
    this.name = 'SavePipelineError';
    this.code = code;
  }
}

// ————————————————————————————————————————————
// M5 适配层：ScriptDraft → SaveAssets（只打包当前 lang）
// ————————————————————————————————————————————

/** type → 安全文件名段（C-07 toDraft 同款派生——非字母数字段折叠 _；M4 对齐基准＝C-07 产物布局） */
function stemOf(type: string): string {
  return type.replace(/[^a-zA-Z0-9]+/g, '_');
}

/**
 * 脚本草稿→保存资产（M5 落位点）：只产当前 lang 的脚本条目（scripts/<stem>.<ext>）——未选中
 * 语言文本不进 assets（其语法错不拦、内容不打包）；当前 lang 文本空→无脚本条目（弱节点
 * exec=null——noScript 判定输入不虚报）；configYaml 纯空白→无 config 条目。
 */
export function assetsFromScriptDraft(type: string, script: ScriptDraft): SaveAssets {
  const stem = stemOf(type);
  const code = script.lang === 'python' ? script.py : script.ts;
  const scripts = code.trim() === '' ? {} : { [`scripts/${stem}.${script.lang === 'ts' ? 'ts' : 'py'}`]: code };
  const config = script.configYaml.trim() === '' ? {} : { [`config/${stem}.yaml`]: script.configYaml };
  return { scripts, config };
}

// ————————————————————————————————————————————
// 保存链本体
// ————————————————————————————————————————————

/** 条目相对路径形态预检（02 §12.2#4 同形规则：`..` 段／绝对路径——assets 键在外部直调面可控） */
function isUnsafeEntryName(name: string): boolean {
  return (
    name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(name) || name.split(/[\\/]/).includes('..')
  );
}

/** library 条目参数模板（N3 default 投影——新建实例的预填底数；无 default 键不落。
 *  T6-19 起经 assemble params 层随包入链（链内 ⑥段入库数据源——与 C-07 ✨new 预填同形）。 */
function paramsTemplateOf(doc: NodeDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of doc.paramsSchema) {
    if (p.default !== undefined) out[p.k] = p.default;
  }
  return out;
}

export function createSavePipeline(deps: SavePipelineDeps): NodeEditorSavePipeline {
  const reject = (code: SavePipelineErrorCode, message: string): never => {
    throw new SavePipelineError(code, message);
  };

  return {
    saveToLibrary: async (doc, assets) => {
      // ———— ① 资产→N4 exec 定型（M5：非空脚本条目恰一=当前 lang 条目） ————
      const scriptPairs = Object.entries(assets.scripts).filter(([, code]) => code.trim() !== '');
      if (scriptPairs.length > 1) {
        reject('SAVE-ASSETS', `assets.scripts 含 ${scriptPairs.length} 个非空条目——保存链只打包当前 lang 恰一条（M5）`);
      }
      const scriptFile = scriptPairs[0]?.[0];
      const scriptCode = scriptPairs[0]?.[1];
      if (scriptFile !== undefined && isUnsafeEntryName(scriptFile)) {
        reject('SAVE-ASSETS', `assets.scripts 条目名路径攻击面拒绝：${scriptFile}（.. 穿越/绝对路径，02 §12.2#4 形）`);
      }
      const configPairs = Object.entries(assets.config).filter(([, content]) => content.trim() !== '');
      const configFile = configPairs[0]?.[0];
      const configContent = configPairs[0]?.[1];
      if (configFile !== undefined && isUnsafeEntryName(configFile)) {
        reject('SAVE-ASSETS', `assets.config 条目名路径攻击面拒绝：${configFile}（02 §12.2#4 形）`);
      }
      const lang: ScriptLang | null =
        scriptFile === undefined ? null : scriptFile.endsWith('.ts') ? 'ts' : scriptFile.endsWith('.py') ? 'python' : null;
      if (scriptFile !== undefined && lang === null) {
        reject('SAVE-ASSETS', `assets.scripts 条目「${scriptFile}」后缀非 .ts/.py——无法定型 N4 ExecSpec.lang`);
      }
      const exec: ExecSpec | null =
        scriptFile === undefined || lang === null
          ? null // 弱节点（当前 lang 文本空——noScript 判定输入，02 §8.4）
          : {
              lang,
              file: scriptFile,
              entry: 'run',
              ...(configFile !== undefined ? { config: configFile } : {}),
            };

      // ———— ② 保存定义定型：kind=custom＋source='manual'（§6.1f 写入 N1——02 §8.2 四入口之一） ————
      const savedDoc: NodeDefinition = {
        ...doc,
        kind: 'custom',
        meta: { ...doc.meta, source: 'manual' },
        exec,
      };

      // ———— ③ validateDefinition＋环节 4 语法门＋命名空间双查（BUILTIN 静态＋hasType 动态
      //     排除自身——同名同型覆盖 A-11.1 不误伤）→ stepErrors 环节投影（单一来源投影件） ————
      const gateScript: ScriptDraft = {
        lang: lang ?? 'python',
        py: lang === 'python' ? (scriptCode ?? '') : '', // M5：只校验当前 lang 文本
        ts: lang === 'ts' ? (scriptCode ?? '') : '',
        configYaml: configContent ?? '',
      };
      const stepErrors = computeStepErrors(
        savedDoc,
        { hasType: (t) => t !== savedDoc.type && (deps.hasType?.(t) ?? false) },
        savedDoc.type, // 恒排除自身（保存语义=upsert 覆盖；create 撞已注册名的拦截在环节门面）
        gateScript,
      );
      if (Object.keys(stepErrors).length > 0) return { ok: false, stepErrors };

      // ———— ④ C-05 register（注册表刷新——同名同型覆盖不新增） ————
      deps.register(savedDoc);

      // ———— ⑤ C-06 upsertDefinition（definitions.upsert 持久化） ————
      await deps.upsertDefinition(savedDoc);

      // ———— ⑥（已去重——T6-19 A1 遗留1）library.upsert 单写=链内 ImportOrchestrator ⑥段：
      //     params 模板（N3 default 投影）经下方 assemble params 层随包入链；scriptMeta 由链内
      //     manifest 映射推导（强节点 {lang,file}／无脚本空占位——原显式段同形） ————

      // ———— ⑦ 产物三件组 zip（组装器注入——真件=T5-03 assembleNodePackage 同件，zip 布局
      //     对齐 C-07〔§6.3 diff 零红线〕；params=N3 default 模板——nodes/*.json 实例层，
      //     入库/落节点随链消费；P-3 本模块不 import workshop） ————
      const pkg = deps.assemble({
        definition: savedDoc,
        params: paramsTemplateOf(savedDoc),
        ...(scriptFile !== undefined && scriptCode !== undefined && lang !== null
          ? { script: { file: scriptFile, lang, entry: 'run', code: scriptCode } }
          : {}),
        ...(configFile !== undefined && configContent !== undefined ? { config: { file: configFile, content: configContent } } : {}),
      });

      // ———— ⑧ C-08 同一导入链（bytes 直入恰一次——校验/落盘/注册/入库链内同构；confirm
      //     自动放行：用户确认已在保存钮收口；异常上抛由 StepSave 呈错误面） ————
      try {
        await deps.importer.importArchiveBytes(pkg.bytes, { confirm: async () => true });
      } catch (err) {
        if (err instanceof SavePipelineError) throw err;
        throw new SavePipelineError(
          'SAVE-IMPORT',
          `资产包导入失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { ok: true };
    },
  };
}
