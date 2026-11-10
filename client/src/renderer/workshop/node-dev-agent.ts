// NodeDevAgent —— 现场开发（T5-03 / TDD-C-07 §3 NodeDevAgent 行＋§1 六环节 3 段；02 §9.1
// 「现场开发生成物」权威；02 §9.2 表「开发节点」行）。
//   develop(spec)：LLM 生成（N1~N8 定义 JSON＋scripts/*.py|ts〔run(ctx) 契约＋PARAMS 默认值表〕
// ＋config/*.yaml＋deps 声明）→草稿自检（C-02 validateDefinition 单一来源——T4-07；失败草稿卡
// 报错**不组装**）→store 组装器（draft-zip-builder——零三方 zip 库依赖）→NodeDraft（含 zip bytes/
// manifest/试跑元数据）返回调用方挂 ConfirmGate 草稿卡（demo L2432-2447「已通过自检」草稿卡语义）。
//   产物导入形态＝**内存 zip bytes 直入 importArchiveBytes**（03 L1101 v1.0e 对齐注〔2026-11-10
// PM，随 02 v1.0e/f 勘误〕：cache 临时文件转 V2 扩展点、C-13 §2 同解同步）——走 C-08 同一导入链
// 「开发即沉淀」（校验/落盘/注册/入库，02 §9.1）。
//   adoptDraft(draft)：确认（ConfirmGate 草稿卡——A-10.2 唯一确认点）后唯一写入触发：
// importArchiveBytes **恰一次**（链内 confirm 自动放行——用户确认已在卡上收口）→注册/入库/
// 视口中心落节点/markDirty 链内完成（ImportOrchestrator ④~⑦ 段；WaterfallPlacer 首项=视口中心
// 锚定——demo L2438-2440 centerWorld 同语义）→定位闪烁＋开抽屉（注入回调——canvas 域能力，
// P-3 装配归应用壳；demo L2443 panToNode+openDrawerNode）。
//   B-5 试跑（02 §12.2#3 冻结合法面：**只有经确认安装的 node-types 资产目录可被
// SandboxExecutor 加载**）：试跑=**adopted 草稿**的资产路径（adopt 结果回传 NodeTrialMeta——
// 结构性保证：未经 adopt 无合法 scriptPath）→run:spawnScript 直调（注入面）；事件回显
// run:scriptEvent 订阅经注入（按 nodeRunId 过滤，exit 自动退订）。lang 字面量='py'|'ts'
// （02 §3.4——与 N4 ExecSpec.lang 'python'|'ts' 不同源，package-manifest.ts 头注同款口径）。
//   LLM 生成失败兜底口径＝02 §9.2（兜底链限意图面）不扩：生成失败上抛挂卡、不吞不改写。
import type { ExecSpec, IoContract, NodeDefinition, ParamField, RunPolicy } from '@constella/shared/dsl';
import type { PackageManifest } from '@constella/shared/manifest';
import type { ScriptEvent, SpawnScriptReq, SpawnScriptRes } from '@constella/shared/ipc';
import type { ImportArchiveOpts, ImportResult } from '../zip/import-orchestrator';
import type { LlmChatRequest, LlmGateway } from './llm-gateway';
import { assembleNodePackage, type NodePackageFileEntry, type NodePackageScript } from './draft-zip-builder';

// ————————————————————————————————————————————
// 契约类型
// ———————————————————————————————————————————

/** 开发需求（意图「开发节点」原话 / FlowPlanner ✨new 缺口步骤定型） */
export interface DevelopSpec {
  /** 需求语句（用户原话） */
  request: string;
  /** 期望类型 id（规划缺口步骤权威指定——LLM 草稿 type 不采） */
  type?: string;
  /** 期望展示名 */
  name?: string;
  /** 参数预填（✨new 步骤 params——nodes/*.json 实例层，落节点/入库随链消费） */
  params?: Record<string, unknown>;
}

/** 现场开发草稿（T5-04 建议：自带 id——ConfirmGate 草稿卡注入位；workshopStore draft 槽定形） */
export interface NodeDraft {
  /** 草稿 id（draft-<uuid>——会话内唯一，ConfirmGate stage({kind:'draft',draft,id:draft.id})） */
  id: string;
  type: string;
  name: string;
  /** N1~N8 定义（草稿自检已过——C-02） */
  definition: NodeDefinition;
  /** 四件套清单面（manifest.json 同形——草稿卡清单展示） */
  manifest: PackageManifest;
  /** store 档 zip 字节（确认前只在内存——adopt 后直入 importArchiveBytes） */
  zip: Uint8Array;
  /** 脚本资产（弱节点=undefined：exec=null、manifest 无 scripts 键） */
  script?: NodePackageScript;
  /** config/*.yaml 条目 */
  config?: NodePackageFileEntry;
  /** deps/ 声明条目 */
  deps?: NodePackageFileEntry;
  /** 参数预填（实例层——试跑 params 底数） */
  params: Record<string, unknown>;
}

/** B-5 试跑元数据（adopt 结果回传——02 §12.2#3 白名单面：node-types/<type>/<pkgVersion>/ 资产） */
export interface NodeTrialMeta {
  /** 02 §3.4 字面量 'py'|'ts'（与 N4 'python'|'ts' 不同源） */
  lang: 'py' | 'ts';
  entry: string;
  /** adopted 资产脚本路径（node-types 相对约定——应用壳可注入绝对解析器） */
  scriptPath: string;
  /** 包级默认配置原文（config/*.yaml） */
  configYaml?: string;
  /** N6 超时守护（0＝不设守护；缺省 30s） */
  timeoutMs: number;
  /** N6 重试（0＝显式禁用；缺省 0） */
  retries: number;
  /** 参数底数（PARAMS ← config ← 实例 params 覆盖序的实例层，02 §14） */
  params: Record<string, unknown>;
}

/** adoptDraft 产物（§1 adoptDraft(draftId): Promise<NodeRef> 的载荷展开——试跑面回传） */
export interface AdoptDraftResult {
  /** 落点画布节点 id（导入链 commit 产物——定位闪烁/开抽屉目标） */
  nodeId: string;
  type: string;
  name: string;
  /** 试跑元数据（无脚本/导入 noScript 点名=null——不可试跑） */
  trial: NodeTrialMeta | null;
}

export interface TrialRunOpts {
  /** 覆盖参数底数（手输优先） */
  params?: Record<string, unknown>;
  /** 上游输入（试跑手输；缺省 null） */
  input?: unknown;
  /** 指定 nodeRunId（复跑同面/观测对齐）。**冻结形 `<runId>:<nodeId>`**（C-03 RunLoop——main
   *  splitNodeRunId 首冒号拆分、两段非空强校验，每次 spawn 必经：无冒号值在真 T4-16 对端必拒）；
   *  缺省＝`trial-<uuid>:<nodeId>`（nodeId=adopt 产物） */
  nodeRunId?: string;
  /** 事件回显（run:scriptEvent 经注入订阅转发——仅本 run 事件；exit 后自动退订） */
  onEvent?: (evt: ScriptEvent) => void;
}

export interface TrialRunHandle {
  res: SpawnScriptRes;
  /** 手动退订事件回显（exit 自动退订后幂等） */
  dispose(): void;
}

export type NodeDevAgentErrorCode =
  | 'DEV-LLM-DRAFT' // LLM 草稿结构不可用（缺 type/ports/paramsSchema.k、exec 缺 script 等）
  | 'DEV-VALIDATE' // 草稿自检未过（C-02 逐条 errors 随附——草稿卡报错不组装）
  | 'DEV-NOT-DRAFT' // adoptDraft 入参非 NodeDraft
  | 'DEV-IMPORT-EMPTY' // 导入链回零节点
  | 'DEV-NOT-ADOPTED' // 试跑无已安装资产（02 §12.2#3 白名单面）
  | 'DEV-NO-RUN-FACE'; // 试跑未装配 spawnScript 注入面

export class NodeDevAgentError extends Error {
  readonly code: NodeDevAgentErrorCode;
  /** DEV-VALIDATE 时随附（C-02 FieldError 形——草稿卡逐条列错） */
  readonly errors?: ReadonlyArray<{ field: string; message: string }>;
  constructor(code: NodeDevAgentErrorCode, message: string, errors?: ReadonlyArray<{ field: string; message: string }>) {
    super(message);
    this.name = 'NodeDevAgentError';
    this.code = code;
    if (errors !== undefined) this.errors = errors;
  }
}

/** C-02 validateDefinition 注入形（T4-07 单一来源——与 ImportOrchestrator 注入面同构） */
export type DraftDefinitionValidator = (
  doc: NodeDefinition,
  ctx?: { hasType(t: string): boolean },
) => { ok: boolean; errors: ReadonlyArray<{ field: string; message: string }> };

/** C-08 导入链注入位（T5-10 冻结面收窄投影——adopt 半段唯一写入通道） */
export interface DraftImportFace {
  importArchiveBytes(bytes: Uint8Array, opts?: ImportArchiveOpts): Promise<ImportResult>;
}

export interface NodeDevAgentDeps {
  llm: LlmGateway;
  /** 请求携带模型（V1.0 settings 单配置无 model 键——经 profileProvider 或此处入口） */
  model?: string;
  /** 草稿自检校验器（C-02 单一来源注入） */
  validate: DraftDefinitionValidator;
  /** C-05 注册表 hasType 注入（N1 命名空间动态查——自检 ctx 排除自身，A-11.1 同型覆盖不误伤） */
  hasType?(t: string): boolean;
  /** 导入链注入位（importArchiveBytes——确认后唯一写入通道） */
  importer: DraftImportFace;
  /** 定位闪烁回调（canvas 域能力——panToNode 语义，P-3 装配归应用壳） */
  locateNode?(nodeId: string): void;
  /** 开抽屉回调（openDrawerNode 语义——demo L2443） */
  openDrawer?(nodeId: string): void;
  /** adopted 资产路径解析（node-types/<type>/<pkgVersion>/<file> 绝对路径——应用壳注入；缺省相对约定） */
  assetScriptPath?(type: string, pkgVersion: string, file: string): string;
  /** B-5 试跑 spawnScript 面（preload run:spawnScript 直调注入） */
  spawnScript?(req: SpawnScriptReq): Promise<SpawnScriptRes>;
  /** 事件回显订阅面（preload run:scriptEvent 注入——按 nodeRunId 过滤转发） */
  subscribeScriptEvent?(listener: (evt: ScriptEvent) => void): () => void;
}

export interface NodeDevAgent {
  /** §3 组件级接口：现场开发——生成→自检→组装 zip→NodeDraft（零写入：不触导入链） */
  develop(spec: DevelopSpec): Promise<NodeDraft>;
  /** 确认后「加入画布」（ConfirmGate adoptDraft 注入位——02 §9.2 表末行四动作） */
  adoptDraft(draft: unknown): Promise<AdoptDraftResult>;
  /** B-5 试跑（adopted 资产 spawnScript 直调——02 §12.2#3 合法面） */
  trialRun(adopted: AdoptDraftResult, opts?: TrialRunOpts): Promise<TrialRunHandle>;
}

// ————————————————————————————————————————————
// 提示词（B-3：AI 生成真实脚本——demo 模板拼接废弃）
// ———————————————————————————————————————————

const DEVELOP_SYSTEM_PROMPT = [
  '你是星丛节点工坊的现场开发器（NodeDevAgent）。根据需求为一个自定义节点生成完整资产（N1~N8 全维度）：',
  '- type：类型 id（小写点分命名空间如 xhs.search；不得撞内置 12 类：trigger.manual/trigger.cron/cdp.open/cdp.extract/cdp.click/http.request/ai.llm/data.transform/logic.branch/delay/file.write/human.review）',
  '- name＋meta：展示名＋元信息（icon 用 emoji、category 类目、description 节点说明）',
  '- ports：N2 端口（ins 入口 id 列表，[]＝触发节点；outs 出口 ≥1 且 id 唯一，出口命名即分支语义）',
  '- paramsSchema：N3 参数表单（k 键唯一；t ∈ text/number/select/textarea/boolean/secret/json/slider；default 给默认值）',
  '- exec：N4 执行体声明（lang ∈ python|ts；entry 固定 run）',
  '- script：脚本源码——文件头 PARAMS 默认值表（覆盖 paramsSchema 各键默认值）＋run(ctx) 入口函数（返回数据对象或 {branch,…} 走分支出口）',
  '- policy：N6 运行策略（timeoutMs/retries/onFailure；failBranch.exit 须命中 outs 出口 id）',
  '- io：N7 IO 契约（output.fields 每项 name＋type；outputs 按出口声明时键 ⊆ outs）',
  '- version：N8 semver（缺省 1.0.0）',
  '- configYaml：包级默认配置 YAML 文本（可选）',
  '- deps：依赖声明（可选——python 给 requirements 行、ts 给 package.json 片段）',
  '仅输出 JSON（不要散文）。',
].join('\n');

const DRAFT_CANONICAL_KEYS = [
  'type',
  'name',
  'meta',
  'ports',
  'paramsSchema',
  'exec',
  'policy',
  'io',
  'version',
  'packageVersion',
  'script',
  'configYaml',
  'deps',
] as const;

function developUserPrompt(spec: DevelopSpec): string {
  const lines = [`需求：${spec.request}`];
  if (spec.type !== undefined) lines.push(`类型 id 定为：${spec.type}（以此为准）`);
  if (spec.name !== undefined) lines.push(`展示名定为：${spec.name}`);
  const params = spec.params ?? {};
  if (Object.keys(params).length > 0) lines.push(`参数预填：${JSON.stringify(params)}`);
  return lines.join('\n');
}

// ————————————————————————————————————————————
// LLM 草稿归一（防御式——脏数据入口在类型系统外构造，规则按运行时值判定）
// ———————————————————————————————————————————

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 条目相对路径形态预检（02 §12.2#4 同形规则：`..` 段／POSIX·Windows 绝对路径——LLM 可控
 *  文件名 develop 段即拒，错误前移到草稿卡；导入链 ZIP-UNSAFE-ENTRY 为第二道兜底） */
function isUnsafeEntryName(name: string): boolean {
  return (
    name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(name) || name.split(/[\\/]/).includes('..')
  );
}

interface NormalizedDraft {
  definition: NodeDefinition;
  script?: NodePackageScript;
  config?: NodePackageFileEntry;
  deps?: NodePackageFileEntry;
}

/** 参数表单项已知键投影（X-01 ParamField 面——LLM 赘键不透传） */
const PARAM_FIELD_KEYS = [
  'k',
  'label',
  't',
  'group',
  'default',
  'required',
  'help',
  'ph',
  'mono',
  'opts',
  'storage',
  'min',
  'max',
  'step',
  'validate',
] as const;

function projectKeys(raw: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

export function createNodeDevAgent(deps: NodeDevAgentDeps): NodeDevAgent {
  /** 响亮拒绝（不吞不改写——上抛挂卡由调用方渲染）。显式类型注解=never-returning CFA 面
   *  （调用点后续收窄依赖——TS 对 const 变量带注解的 never 函数才做控制流分析） */
  const reject: (code: NodeDevAgentErrorCode, message: string) => never = (code, message) => {
    throw new NodeDevAgentError(code, message);
  };

  /** 键名防御折叠（网关 canonicalKeys 只作用顶层——meta/ports 等内层差异在此抹平，N6） */
  const pick = (rec: Record<string, unknown>, key: string): unknown => {
    if (key in rec) return rec[key];
    const want = key.toLowerCase().replace(/[_-]/g, '');
    for (const k of Object.keys(rec)) {
      if (k.toLowerCase().replace(/[_-]/g, '') === want) return rec[k];
    }
    return undefined;
  };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  /** LLM 草稿→归一定义＋资产条目（结构不可用即 DEV-LLM-DRAFT 响亮报错） */
  const toDraft = (raw: unknown, spec: DevelopSpec): NormalizedDraft => {
    if (!isRecord(raw)) reject('DEV-LLM-DRAFT', 'LLM 草稿非法（非对象）');

    // —— N1：type/name/meta ——

    const type = spec.type ?? str(pick(raw, 'type'));
    if (type === '') reject('DEV-LLM-DRAFT', 'LLM 草稿缺 type（类型 id）');
    const metaRaw = isRecord(pick(raw, 'meta')) ? (pick(raw, 'meta') as Record<string, unknown>) : {};
    const name = spec.name || str(pick(raw, 'name')) || str(pick(metaRaw, 'name')) || type;
    const stem = type.replace(/[^a-zA-Z0-9]+/g, '_');

    // —— N2：ports（ins 0~N；outs 数组须在——空数组留 C-02 N2-outs-empty 逐条报） ——

    const portsRaw = pick(raw, 'ports');
    if (!isRecord(portsRaw)) reject('DEV-LLM-DRAFT', 'LLM 草稿缺 ports（N2 端口）');
    const ins = Array.isArray(portsRaw.ins) ? portsRaw.ins.filter((p): p is string => typeof p === 'string') : [];
    if (!Array.isArray(portsRaw.outs)) reject('DEV-LLM-DRAFT', 'LLM 草稿 ports.outs 非法（须出口数组）');
    const outs = portsRaw.outs.map((o) => {
      if (!isRecord(o) || typeof o.id !== 'string' || o.id === '') {
        reject('DEV-LLM-DRAFT', 'LLM 草稿 ports.outs 出口缺 id（N2 出口 id）');
      }
      return { id: o.id, label: str(o.label) || o.id };
    });

    // —— N3：paramsSchema（缺 k＝结构不可用；t 白名单留 C-02 N3-type 逐条报） ——

    const schemaRaw = pick(raw, 'paramsSchema');
    const paramsSchema: ParamField[] = Array.isArray(schemaRaw)
      ? schemaRaw.map((p, i) => {
          if (!isRecord(p) || typeof p.k !== 'string' || p.k === '') {
            reject('DEV-LLM-DRAFT', `LLM 草稿 paramsSchema[${i}] 缺 k（参数键）`);
          }
          return projectKeys(p, PARAM_FIELD_KEYS) as unknown as ParamField;
        })
      : [];

    // —— N4＋scripts：exec≠null ⟺ script 源码在（声明执行体而缺源码＝结构不可用，不虚报脚本） ——

    const execRaw = isRecord(pick(raw, 'exec')) ? (pick(raw, 'exec') as Record<string, unknown>) : undefined;
    const scriptCode = str(pick(raw, 'script'));
    if (scriptCode === '' && execRaw !== undefined) {
      reject('DEV-LLM-DRAFT', 'LLM 草稿声明 exec 但缺 script 源码（N4 执行体须随脚本资产）');
    }

    // —— config/deps 声明（条目文件名在此定型；N4 指针接线） ——

    // lang 枚举响亮拒绝（不静默折叠 python：错误语言打包后 C-02 构造性合法抓不到——评审裁定）
    if (execRaw !== undefined && execRaw.lang !== undefined && execRaw.lang !== 'python' && execRaw.lang !== 'ts') {
      reject('DEV-LLM-DRAFT', `LLM 草稿 exec.lang「${String(execRaw.lang)}」不在 python|ts 枚举（N4——不静默折叠）`);
    }
    const lang = (execRaw?.lang === 'ts' ? 'ts' : 'python') as ExecSpec['lang'];
    const ext = lang === 'ts' ? 'ts' : 'py';
    const scriptFile = str(execRaw?.file) || `scripts/${stem}.${ext}`;
    const entry = str(execRaw?.entry) || 'run';

    const configYaml = str(pick(raw, 'configYaml'));
    const config: NodePackageFileEntry | undefined =
      configYaml !== '' ? { file: `config/${stem}.yaml`, content: configYaml } : undefined;

    const depsRaw = pick(raw, 'deps');
    let depsEntry: NodePackageFileEntry | undefined;
    if (typeof depsRaw === 'string' && depsRaw !== '') {
      depsEntry = { file: lang === 'ts' ? 'deps/package.json' : 'deps/requirements.txt', content: depsRaw };
    } else if (isRecord(depsRaw) && typeof depsRaw.file === 'string' && typeof depsRaw.content === 'string') {
      depsEntry = { file: depsRaw.file, content: depsRaw.content };
    }

    // LLM 可控条目名路径形态预检（exec.file/deps.file——.. 穿越/绝对路径在 develop 段即拒，
    // 错误前移到草稿卡：不待 adopt 后导入链 ZIP-UNSAFE-ENTRY 才拦；规则同 02 §12.2#4 形）
    for (const [label, file] of [['exec.file', str(execRaw?.file)], ['deps.file', depsEntry !== undefined && isRecord(depsRaw) ? depsEntry.file : '']] as const) {
      if (file !== '' && isUnsafeEntryName(file)) {
        reject('DEV-LLM-DRAFT', `LLM 草稿 ${label} 条目名路径攻击面拒绝：${file}（.. 穿越/绝对路径，02 §12.2#4 形）`);
      }
    }

    const script: NodePackageScript | undefined =
      scriptCode !== '' ? { file: scriptFile, lang, entry, code: scriptCode } : undefined;
    const exec: ExecSpec | null =
      script !== undefined
        ? {
            lang,
            file: scriptFile,
            entry,
            ...(config !== undefined ? { config: config.file } : {}),
            ...(depsEntry !== undefined ? { deps: depsEntry.file } : {}),
          }
        : null;

    // —— N6 policy / N7 io / N8 version（已知键投影；交叉规则留 C-02 #5/#7/#8） ——

    const policyRaw = isRecord(pick(raw, 'policy')) ? (pick(raw, 'policy') as Record<string, unknown>) : undefined;
    const policyProjected = policyRaw !== undefined ? projectKeys(policyRaw, ['timeoutMs', 'retries', 'backoffMs', 'onFailure']) : undefined;
    const policy = policyProjected !== undefined && Object.keys(policyProjected).length > 0 ? (policyProjected as unknown as RunPolicy) : undefined;

    const ioRaw = isRecord(pick(raw, 'io')) ? (pick(raw, 'io') as Record<string, unknown>) : undefined;
    const ioProjected = ioRaw !== undefined ? projectKeys(ioRaw, ['input', 'output', 'outputs']) : undefined;
    const io = ioProjected !== undefined && Object.keys(ioProjected).length > 0 ? (ioProjected as unknown as IoContract) : undefined;

    const version = str(pick(raw, 'version')) || '1.0.0'; // D-11：首发 v1.0.0
    const packageVersion = str(pick(raw, 'packageVersion')) || '1.0.0';

    const definition: NodeDefinition = {
      type,
      kind: 'custom', // AI 现场开发（✨ 角标＝非内置）
      meta: {
        name,
        icon: str(pick(metaRaw, 'icon')) || '✨',
        category: str(pick(metaRaw, 'category')) || 'AI',
        ...(str(pick(metaRaw, 'description')) !== '' ? { description: str(pick(metaRaw, 'description')) } : {}),
        ...(str(pick(metaRaw, 'author')) !== '' ? { author: str(pick(metaRaw, 'author')) } : {}),
        source: 'ai-forge', // 02 §8.2 upsert 四入口之一：AI 现场开发
      },
      ports: { ins, outs },
      paramsSchema,
      exec,
      ...(policy !== undefined ? { policy } : {}),
      ...(io !== undefined ? { io } : {}),
      version,
      packageVersion,
    };
    return { definition, ...(script !== undefined ? { script } : {}), ...(config !== undefined ? { config } : {}), ...(depsEntry !== undefined ? { deps: depsEntry } : {}) };
  };

  /** B-5 试跑元数据（adopt 后才有——02 §12.2#3 白名单面的结构性保证） */
  const buildTrial = (d: NodeDraft, imported: ImportResult, node: ImportResult['nodes'][number]): NodeTrialMeta | null => {
    if (d.script === undefined) return null; // 弱节点（exec=null）
    if (imported.noScript.includes(node.name)) return null; // 导入链 noScript 点名（运行闸同源）
    return {
      lang: d.script.lang === 'python' ? 'py' : 'ts', // 02 §3.4 字面量（与 N4 不同源）
      entry: d.script.entry,
      scriptPath:
        deps.assetScriptPath?.(d.type, d.definition.packageVersion, d.script.file) ??
        `${d.type}/${d.definition.packageVersion}/${d.script.file}`, // node-types/<type>/<pkgVersion>/ 相对约定
      ...(d.config !== undefined ? { configYaml: d.config.content } : {}),
      timeoutMs: d.definition.policy?.timeoutMs ?? 30_000, // N6 缺省 30s
      retries: d.definition.policy?.retries ?? 0, // N6 缺省 0
      params: d.params,
    };
  };

  const isNodeDraft = (v: unknown): v is NodeDraft =>
    isRecord(v) &&
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.type === 'string' &&
    isRecord(v.definition) &&
    v.zip instanceof Uint8Array;

  return {
    develop: async (spec) => {
      // ① LLM 生成（chatJson 结构化；失败上抛挂卡——02 §9.2 兜底链限意图面，不扩）
      const req: LlmChatRequest = {
        model: deps.model,
        messages: [
          { role: 'system', content: DEVELOP_SYSTEM_PROMPT },
          { role: 'user', content: developUserPrompt(spec) },
        ],
      };
      const raw = await deps.llm.chatJson<Record<string, unknown>>(req, { canonicalKeys: DRAFT_CANONICAL_KEYS });

      // ② 草稿归一（结构不可用→DEV-LLM-DRAFT）
      const normalized = toDraft(raw, spec);

      // ③ 草稿自检（C-02 validateDefinition 单一来源；ctx 排除自身——A-11.1 同型覆盖合法；
      //    失败→DEV-VALIDATE 逐条随附，草稿卡报错**不组装**）
      const verdict = deps.validate(normalized.definition, {
        hasType: (t) => t !== normalized.definition.type && (deps.hasType?.(t) ?? false),
      });
      if (!verdict.ok) {
        throw new NodeDevAgentError(
          'DEV-VALIDATE',
          `草稿自检未过（${normalized.definition.type}）——逐条列卡，不组装不导入`,
          verdict.errors,
        );
      }

      // ④ store 组装器→NodeDraft（zip bytes 确认前只在内存——零写入）
      const pkg = assembleNodePackage({
        definition: normalized.definition,
        ...(normalized.script !== undefined ? { script: normalized.script } : {}),
        ...(normalized.config !== undefined ? { config: normalized.config } : {}),
        ...(normalized.deps !== undefined ? { deps: normalized.deps } : {}),
        params: spec.params ?? {},
      });
      return {
        id: `draft-${crypto.randomUUID()}`,
        type: normalized.definition.type,
        name: normalized.definition.meta.name,
        definition: normalized.definition,
        manifest: pkg.manifest,
        zip: pkg.bytes,
        ...(normalized.script !== undefined ? { script: normalized.script } : {}),
        ...(normalized.config !== undefined ? { config: normalized.config } : {}),
        ...(normalized.deps !== undefined ? { deps: normalized.deps } : {}),
        params: spec.params ?? {},
      };
    },

    adoptDraft: async (input) => {
      if (!isNodeDraft(input)) reject('DEV-NOT-DRAFT', '入参非 NodeDraft（草稿卡载荷形不符——不触导入链）');
      // ① 导入恰一次（v1.0e：内存 bytes 直入；链内 confirm 自动放行——用户确认已在草稿卡收口，
      //    A-10.2 唯一确认点不双收）；校验/落盘/注册/入库/视口中心落节点/markDirty 链内完成
      const imported = await deps.importer.importArchiveBytes(input.zip, { confirm: async () => true });
      const node = imported.nodes[0];
      if (node === undefined) reject('DEV-IMPORT-EMPTY', '导入链回零节点（包内缺 nodes/*.json？）');

      // ② 定位闪烁＋开抽屉（demo L2443 panToNode+openDrawerNode 语义——注入回调，P-3）
      deps.locateNode?.(node.id);
      deps.openDrawer?.(node.id);

      return { nodeId: node.id, type: node.type, name: node.name, trial: buildTrial(input, imported, node) };
    },

    trialRun: async (adopted, opts) => {
      const trial = adopted.trial;
      if (trial === null) {
        reject('DEV-NOT-ADOPTED', '该节点无可试跑脚本（资产未随包安装——02 §12.2#3：只有已确认安装的 node-types 资产可被加载）');
      }
      const spawn = deps.spawnScript;
      if (spawn === undefined) {
        reject('DEV-NO-RUN-FACE', '试跑未装配 spawnScript 面（preload run:spawnScript 注入——B-5）');
      }
      // C-03 RunLoop 冻结形 `<runId>:<nodeId>`（main splitNodeRunId 每次 spawn 必经——两段非空）
      const nodeRunId = opts?.nodeRunId ?? `trial-${crypto.randomUUID()}:${adopted.nodeId}`;

      // 事件回显：先订阅后 spawn（不丢首发）；仅本 run；exit 自动退订
      let unsub: (() => void) | undefined;
      let disposed = false;
      const dispose = (): void => {
        if (!disposed) {
          disposed = true;
          unsub?.();
        }
      };
      if (opts?.onEvent !== undefined && deps.subscribeScriptEvent !== undefined) {
        const forward = opts.onEvent;
        unsub = deps.subscribeScriptEvent((evt) => {
          if (evt.nodeRunId !== nodeRunId) return;
          forward(evt);
          if (evt.kind === 'exit') dispose();
        });
      }

      try {
        const res = await spawn({
          nodeRunId,
          lang: trial.lang,
          scriptPath: trial.scriptPath,
          entry: trial.entry,
          params: { ...trial.params, ...opts?.params },
          input: opts?.input ?? null,
          ...(trial.configYaml !== undefined ? { configYaml: trial.configYaml } : {}),
          timeoutMs: trial.timeoutMs,
          retries: trial.retries,
        });
        return { res, dispose };
      } catch (err) {
        dispose(); // 失败即退订（不残留订阅）
        throw err;
      }
    },
  };
}
