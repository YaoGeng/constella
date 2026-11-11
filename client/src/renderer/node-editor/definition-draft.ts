// DefinitionDraft —— C-13 编辑器模块内草稿 store（T6-06；TDD-C-13 §3 DefinitionDraft 行＋§1
// openNodeEditor 接口段；01 §5.3 PATH1 六环节＝语义权威）。
//
//   内存草稿红线（§3「模块内草稿 store（内存；未保存不落盘、不入 02 §3.3 六 store）」）：
// 零 persist 中间件、零 zundo temporal、零 storage/IPC import——close 即弃，保存链（SavePipeline）
// 随 T6-09 落位。draft 读写＋dirty 位（§3 组件级接口）＝本 store 全部职责。
//
//   实时校验＝T4-07 validateDefinition 单一来源（C-02 §3；03 C-13 §2 imports ↓ 点名——
// 不自造规则）：环节门（gate）只看「规则→环节」投影 computeStepErrors；唯二例外=PATH1
// 表单门两条——名称必填（01 §5.3 环节 1 冻结原文「名称必填校验」）与 type 必填（DSL PK，
// 02 §7.1 node_definitions.type 表列＋02 §8.1 命名空间检查对象）——均非 02 §8.1 八条规则面，
// 以 N1-*-required 规则码独立留痕（T6-09 SavePipeline 汇总时同口径呈现）。
//
//   草稿路由（§1）：openNodeEditor() 无 seed＝create 新建；openNodeEditor({type})＝
// editDefinition 再编辑（既有 custom 定义——经注入 getDefinition 载入〔C-05 registry.get /
// C-06 loadAllDefinitions 投影，装配点接线；P-3 本模块不持注册表实例〕）。edit 载入后
// meta.source 固定改写 'manual'（§1 StepMeta 行「source 可编辑态固定 'manual' 写入语义位」
// ——02 §8.2 upsert 四入口之手动编辑器）；改写不计 dirty（dirty=用户改动，基线=载入态）。
//
//   环节 4 脚本草稿（T6-08）：script.lang/py/ts/configYaml 内存草稿（未保存不落盘——保存链
// 随 T6-09 SavePipeline；edit 态资产文本装载=装配点注入面，create/edit 同空起）。lang 值域
// 对齐 DSL ExecSpec.lang 'python'|'ts'（UI 显示 py|ts——「py|ts 切换」字面的等价确定形，
// 免草稿→exec 落库二次转换）；py/ts 双文本各自存续=「切换保留各自文本」语义（零拷贝零丢失）。
// 环节门增 N4-syntax（PATH1 语法校验门第三条——01 §5.3 环节 4「语法校验保存门」/03 C-13
// §6.1d）：当前选中语言文本经 SyntaxChecker 有错 → step 'script'、field 'script.code'
// 拦门（未选中语言草稿暂存不拦——保存链只打包当前 lang，T6-09 口径）；config 键失配
// =§6.1e 警告不拦截（ConfigYamlEditor UI 面，不入 computeStepErrors）。
import { create } from 'zustand';
import type { IoContract, NodeDefinition, NodeMeta, NodePorts, ParamField, RunPolicy } from '@constella/shared/dsl';
import { validateDefinition } from '../definition';
import type { DefRule, FieldError } from '../definition';
import { check } from './syntax-checker';
import type { ScriptLang } from './syntax-checker';

/** 六环节键（01 §5.3 六环节；PATH1 环节 4/5=script 两页合一环节，02 §3.2 C-13 行） */
export type EditorStepKey = 'meta' | 'ports' | 'schema' | 'script' | 'inner' | 'save';

/** 六环节序（stepper 编排与门判定共用） */
export const EDITOR_STEPS = ['meta', 'ports', 'schema', 'script', 'inner', 'save'] as const;

const STEP_INDEX: Record<EditorStepKey, number> = {
  meta: 0,
  ports: 1,
  schema: 2,
  script: 3,
  inner: 4,
  save: 5,
};

/** 六环节标题（stepper 文案；环节对位注记见 03 §1 六环节组件面） */
export const STEP_LABELS: Record<EditorStepKey, string> = {
  meta: '① 元信息',
  ports: '② 端口',
  schema: '③ 参数 schema',
  script: '④ 脚本＋配置',
  inner: '⑤ 组合步骤',
  save: '⑥ 入库保存',
};

/** 环节门错误形（FieldError 超集：PATH1 表单门两条＋环节 4 语法门一条以扩展规则码入列——见文件头注） */
export type StepErrorRule = DefRule | 'N1-name-required' | 'N1-type-required' | 'N4-syntax';

/** 环节 4 脚本草稿态（T6-08 StepScript/StepConfig 消费——lang 对齐 DSL ExecSpec.lang） */
export interface ScriptDraft {
  /** 当前脚本语言（'python' | 'ts'——UI 显示 py|ts） */
  lang: ScriptLang;
  /** python 脚本文本（lang 切换各自存续） */
  py: string;
  /** ts 脚本文本 */
  ts: string;
  /** config/*.yaml 文本（环节 4 config 页——键一致性警告判定输入） */
  configYaml: string;
}

/** 脚本草稿初始态（lang=python：demo 内置节点脚本 py 主导〔SCRIPT_BODIES 十余条 py vs 一条
 * ts〕的事实基线——设计值；文本空起=模板注入是显式动作〔StepScript 注入按钮〕不预置） */
function defaultScriptDraft(): ScriptDraft {
  return { lang: 'python', py: '', ts: '', configYaml: '' };
}

export interface StepFieldError {
  field: string;
  message: string;
  rule: StepErrorRule;
}

/** 错误定位到环节（SaveReport stepErrors 形的先行局部态——T6-09 前以 EditorShell 交付） */
export type StepErrors = Partial<Record<EditorStepKey, StepFieldError[]>>;

/** §1 openNodeEditor 入参（02 §3.2 C-13 行关键接口逐字：seed?: { type?: string }） */
export interface EditorSeed {
  type?: string;
}

/** 入口注入面（P-3：注册表/定义存储实例不进本模块——装配点/T6-17 应用壳接线） */
export interface EditorEntryDeps {
  /** edit 载入既有定义（C-05 registry.get 同形；缺省=create 语义不触） */
  getDefinition?(type: string): NodeDefinition | undefined;
  /** 命名空间动态查（C-05 hasType 注入——自身同型排除在 computeStepErrors 内统一做，A-11.1） */
  hasType?(t: string): boolean;
}

/** create 态初始草稿（N1~N8 最小合法骨架：outs≥1 合规、version 首发默认 1.0.0——D-11） */
function defaultDraft(): NodeDefinition {
  return {
    type: '',
    kind: 'custom',
    meta: { name: '', icon: '✨', category: '', source: 'manual' },
    ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
    paramsSchema: [],
    exec: null,
    inner: null,
    policy: null,
    io: null,
    version: '1.0.0',
    packageVersion: '1.0.0',
  };
}

/** 纯 JSON 深拷贝（NodeDefinition 全维度皆 JSON 数据面——无函数/循环引用） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** edit 载入归一：仅改写 source 语义位，其余逐字段保留（§6.1a 全字段往返保留基线） */
function normalizeForEditor(seed: NodeDefinition): NodeDefinition {
  const draft = clone(seed);
  draft.meta = { ...draft.meta, source: 'manual' };
  return draft;
}

/** validateDefinition 八条规则 → 环节归属（N6/N7「高级声明」分组挂 StepSchema——03 §1 ⚠ 冻结形，T6-07 消费） */
function stepOfError(e: FieldError): EditorStepKey {
  switch (e.rule) {
    case 'N1-namespace':
      return 'meta';
    case 'N2-outs-empty':
    case 'N2-outs-duplicate':
      return 'ports';
    case 'N3-type':
    case 'N3-validate':
      return 'schema';
    case 'N4-exec':
      return 'script';
    case 'N6-failBranch':
      return 'schema'; // N6 声明位=StepSchema 高级声明分组（03 §1 冻结；若独立环节随 T6-07 调）
    case 'N7-output-fields':
    case 'N7-outputs-keys':
    case 'N7-outputs-fields':
      return 'schema'; // N7 同上
    case 'N8-semver':
      return 'save';
  }
}

/**
 * 草稿→分环节错误投影（实时校验回显与环节门共用——单一来源 validateDefinition 直跑）。
 * ctx.hasType=命名空间动态查：edit 态传 selfType 排除自身（A-11.1 同型覆盖不误伤——
 * definition/types.ts 注「编辑既有定义时应传排除自身的 ctx」）；create 态不排除
 * （新打已注册类型=动态撞名报错）。静态 BUILTIN_TYPE_IDS 查在 checkNamespace 内恒跑（双查）。
 * script=环节 4 脚本草稿（T6-08）：当前 lang 文本语法错误→N4-syntax 投影（可省——
 * 旧调用面〔specs 两参直跑〕兼容）。
 */
export function computeStepErrors(
  draft: NodeDefinition,
  deps?: EditorEntryDeps,
  /** edit 态自身 type（A-11.1 排除位；create 省略） */
  selfType?: string,
  /** 环节 4 脚本草稿（T6-08——省略则跳过语法门） */
  script?: ScriptDraft,
): StepErrors {
  const verdict = validateDefinition(draft, {
    hasType: (t) =>
      selfType === undefined ? (deps?.hasType?.(t) ?? false) : t !== selfType && (deps?.hasType?.(t) ?? false),
  });
  const out: StepErrors = {};
  for (const e of verdict.errors) {
    (out[stepOfError(e)] ??= []).push(e);
  }
  // PATH1 表单门两条（01 §5.3 环节 1／DSL PK——非八条规则面，独立规则码留痕，见文件头注）
  const gate: StepFieldError[] = [];
  if (draft.meta.name.trim() === '') {
    gate.push({ field: 'meta.name', message: '名称必填（N1 元信息——01 §5.3 PATH1 环节 1）', rule: 'N1-name-required' });
  }
  if (draft.type.trim() === '') {
    gate.push({ field: 'type', message: '类型 id 必填（DSL 主键——02 §7.1 node_definitions.type）', rule: 'N1-type-required' });
  }
  if (gate.length > 0) (out.meta ??= []).unshift(...gate);
  // 环节 4 语法门（T6-08；§6.1d）：当前 lang 文本经 SyntaxChecker——有错拦 script 环节，
  // message 形「L<行号> <message>」（错误行定位——StepScript 错误列表直显）
  if (script !== undefined) {
    const code = script.lang === 'python' ? script.py : script.ts;
    for (const e of check(script.lang, code)) {
      (out.script ??= []).push({ field: 'script.code', message: `L${e.line} ${e.message}`, rule: 'N4-syntax' });
    }
  }
  return out;
}

export interface DefinitionDraftState {
  open: boolean;
  mode: 'create' | 'edit';
  /** 草稿（内存——未保存不落盘） */
  draft: NodeDefinition;
  /** dirty 底数快照（create=初始骨架；edit=载入归一态——source 改写不计脏） */
  baseline: NodeDefinition;
  /** 环节 4 脚本草稿（T6-08——内存不落盘；lang/py/ts/configYaml） */
  script: ScriptDraft;
  /** script 草稿 dirty 底数（与 baseline 同语义——create/edit 同空起） */
  scriptBaseline: ScriptDraft;
  step: EditorStepKey;
  /** edit 载入失败（miss／builtin 拒）——EditorShell 呈错误面，不静默降级 create */
  seedError: string | null;
  /** 入口注入面存续（环节门实时校验复用） */
  deps: EditorEntryDeps | null;

  /** §1 入口：create（无 seed）／editDefinition(type) 再编辑 */
  openNodeEditor(seed?: EditorSeed, deps?: EditorEntryDeps): void;
  closeEditor(): void;
  patchMeta(patch: Partial<NodeMeta>): void;
  /** type 编辑（create 态；edit 态 PK 不可变——A-11.1 同名同型 upsert 对象恒定，防御性 no-op） */
  setType(type: string): void;
  setPorts(ports: NodePorts): void;
  /** 环节 3 读写面（T6-07 StepSchema）：N3 字段表＋N6/N7 高级声明（null=未声明位——02 §8.6 缺省默认） */
  setParamsSchema(paramsSchema: ParamField[]): void;
  setPolicy(policy: RunPolicy | null): void;
  setIo(io: IoContract | null): void;
  /** 环节 4 脚本草稿读写面（T6-08 StepScript/StepConfig——patchScript 形对齐 patchMeta） */
  patchScript(patch: Partial<ScriptDraft>): void;
  /** 环节跳转（回退自由；前进=逐门校验，未过门不得前进） */
  goToStep(target: EditorStepKey): void;
  nextStep(): void;
  prevStep(): void;
  /** 测试隔离（内存态全清） */
  reset(): void;
}

/** dirty 位选择器（draft/script 双底数序列比对——§3 组件级接口「draft 读写＋dirty 位」） */
export function isDirty(s: Pick<DefinitionDraftState, 'draft' | 'baseline' | 'script' | 'scriptBaseline'>): boolean {
  return JSON.stringify(s.draft) !== JSON.stringify(s.baseline) || JSON.stringify(s.script) !== JSON.stringify(s.scriptBaseline);
}

export const useDefinitionDraftStore = create<DefinitionDraftState>((set, get) => ({
  open: false,
  mode: 'create',
  draft: defaultDraft(),
  baseline: defaultDraft(),
  script: defaultScriptDraft(),
  scriptBaseline: defaultScriptDraft(),
  step: 'meta',
  seedError: null,
  deps: null,

  openNodeEditor: (seed, deps) => {
    if (seed?.type === undefined) {
      const draft = defaultDraft(); // create：无 seed（§1）
      const script = defaultScriptDraft();
      set({ open: true, mode: 'create', seedError: null, draft, baseline: clone(draft), script, scriptBaseline: clone(script), step: 'meta', deps: deps ?? null });
      return;
    }
    const existing = deps?.getDefinition?.(seed.type);
    if (existing === undefined) {
      set({
        open: true,
        mode: 'edit',
        seedError: `未找到类型「${seed.type}」的既有定义（editDefinition 需 custom 定义在册——载入经装配注入 getDefinition）`,
        draft: defaultDraft(),
        baseline: defaultDraft(),
        script: defaultScriptDraft(),
        scriptBaseline: defaultScriptDraft(),
        step: 'meta',
        deps: deps ?? null,
      });
      return;
    }
    if (existing.kind !== 'custom') {
      set({
        open: true,
        mode: 'edit',
        seedError: `类型「${seed.type}」非 custom 定义（builtin 不可再编辑——01 §5.3 PATH1 编辑对象为既有自定义定义）`,
        draft: defaultDraft(),
        baseline: defaultDraft(),
        script: defaultScriptDraft(),
        scriptBaseline: defaultScriptDraft(),
        step: 'meta',
        deps: deps ?? null,
      });
      return;
    }
    const draft = normalizeForEditor(existing); // edit：既有 custom 再编辑（§1）
    const script = defaultScriptDraft(); // 资产文本装载=装配点注入面（T6-09 保存链接线前空起）
    set({ open: true, mode: 'edit', seedError: null, draft, baseline: clone(draft), script, scriptBaseline: clone(script), step: 'meta', deps: deps ?? null });
  },

  closeEditor: () => set({ open: false }),

  patchMeta: (patch) => {
    const s = get();
    set({ draft: { ...s.draft, meta: { ...s.draft.meta, ...patch, source: 'manual' } } }); // source 语义位恒 manual
  },

  setType: (type) => {
    const s = get();
    if (s.mode === 'edit') return; // edit 态 PK 不可变（UI 只读＋store 防御）
    set({ draft: { ...s.draft, type } });
  },

  setPorts: (ports) => {
    const s = get();
    set({ draft: { ...s.draft, ports } });
  },

  setParamsSchema: (paramsSchema) => {
    const s = get();
    set({ draft: { ...s.draft, paramsSchema } });
  },

  setPolicy: (policy) => {
    const s = get();
    set({ draft: { ...s.draft, policy } });
  },

  setIo: (io) => {
    const s = get();
    set({ draft: { ...s.draft, io } });
  },

  patchScript: (patch) => {
    const s = get();
    set({ script: { ...s.script, ...patch } }); // 环节 4 草稿（内存——lang 切换=只改 lang 键，py/ts 文本各自存续）
  },

  goToStep: (target) => {
    const s = get();
    if (!s.open || s.seedError !== null) return;
    if (STEP_INDEX[target] <= STEP_INDEX[s.step]) {
      set({ step: target }); // 回退/原地永远自由（往返编辑）
      return;
    }
    const errors = computeStepErrors(s.draft, s.deps ?? undefined, s.mode === 'edit' ? s.draft.type : undefined, s.script);
    for (let i = STEP_INDEX[s.step]; i < STEP_INDEX[target]; i++) {
      const key = EDITOR_STEPS[i];
      if (key === undefined || (errors[key]?.length ?? 0) > 0) return; // 门未过——不得前进
    }
    set({ step: target });
  },

  nextStep: () => {
    const s = get();
    const next = EDITOR_STEPS[STEP_INDEX[s.step] + 1];
    if (next === undefined) return; // 末环节（save 的保存动作随 T6-09 StepSave 落位）
    get().goToStep(next);
  },

  prevStep: () => {
    const s = get();
    const prev = EDITOR_STEPS[STEP_INDEX[s.step] - 1];
    if (prev === undefined) return;
    get().goToStep(prev);
  },

  reset: () => {
    const draft = defaultDraft();
    const script = defaultScriptDraft();
    set({ open: false, mode: 'create', draft, baseline: clone(draft), script, scriptBaseline: clone(script), step: 'meta', seedError: null, deps: null });
  },
}));

/** §1 入口函数（store 动作的直呼形式——DrawerShell「手动定义」分支/节点库「＋节点」接线用） */
export function openNodeEditor(seed?: EditorSeed, deps?: EditorEntryDeps): void {
  useDefinitionDraftStore.getState().openNodeEditor(seed, deps);
}
