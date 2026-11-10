// StepSchema —— 环节 3 参数 schema 表单（T6-07；TDD-C-13 §3 StepSchema 行「N3 字段定义器：
// 类型白名单八类/默认值/必填/校验/help/分组 + ParamFormRenderer 实时预览」＋N6 策略与 N7 IO
// 声明以「高级声明」分组挂本环节——03 §1 ⚠ 冻结形；01 §5.3 PATH1 环节 3＋PRD-CUSTOM-N3/N6/N7）。
//
//   N3 字段定义器：ParamField 全编辑面——k/label/t（select 只列白名单八类=PARAM_TYPE_WHITELIST
// 单一来源；脏值〔AI/zip 载入〕占位显示供修正，不静默丢弃）/group/required/default（按 t 分控件
// ——boolean 三态/number·slider 数字化/json 序列化）/help/validate{regex,min,max,minLines}/
// slider min-max-step/select opts——增删改排序即时写草稿（本组件不持预览：ParamFormPreview
// 由 EditorShell 侧右栏挂＝C-02 ParamFormRenderer 同源渲染，X-8）。
//   N6/N7 高级声明：policy（timeoutMs/retries/backoffMs/onFailure 两形态——failBranch exit
// 选项面=N2 outs，02 §8.1 #5；数字框空=字段缺省、0=显式有效值，X-4/02 §8.6）；io（input/
// output 单声明＋outputs per-exit 声明——键选项面=N2 outs，02 §8.1 #6/#7、X-5）。
//   错误回显=computeStepErrors 投影（T6-06——validateDefinition 单一来源，不自造规则）按
// field 路径定位挂行内：paramsSchema[i].*/policy.onFailure.exit/io.outputs.<exit>…
import type { IoContract, IoField, ParamField, ParamValidate, RunPolicy } from '@constella/shared/dsl';
import { PARAM_TYPE_WHITELIST } from '../definition';
import type { StepFieldError } from './definition-draft';

export interface StepSchemaProps {
  /** N3 参数 schema（draft.paramsSchema 直读） */
  paramsSchema: ParamField[];
  /** N6 运行策略（draft.policy——null=未声明位，02 §8.6 缺省默认） */
  policy: RunPolicy | null;
  /** N7 IO 契约（draft.io——null=未声明） */
  io: IoContract | null;
  /** N2 出口 id 集合（N6 failBranch exit／N7 outputs 键的合法域——选项面＋交叉校验回显） */
  exitIds: readonly string[];
  /** schema 环节门错误（N3/N6-failBranch/N7 三组规则投影——computeStepErrors） */
  errors: readonly StepFieldError[];
  onSchemaChange(paramsSchema: ParamField[]): void;
  onPolicyChange(policy: RunPolicy | null): void;
  onIoChange(io: IoContract | null): void;
}

const INPUT_CLS =
  'w-full rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none';

const BTN_CLS = 'rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-40';

/** 数字框显示值（undefined=''——空=字段缺省；0='0' 显式有效值，X-4） */
function numStr(v: number | undefined): string {
  return v === undefined ? '' : String(v);
}

/** 最小未占用键（add-field 生成不撞现存 k 的缺省键——重名仍可手造） */
function freshKey(prefix: string, used: readonly string[]): string {
  let n = used.length + 1;
  const taken = new Set(used);
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** 行内错误回显（field 精确/前缀匹配——StepMeta FieldErrors 同法；match 由调用域给定） */
function RowErrors({ errors, match }: { errors: readonly StepFieldError[]; match: (field: string) => boolean }) {
  const hits = errors.filter((e) => match(e.field));
  if (hits.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((e, i) => (
        <span key={i} data-field-error={e.field} data-error-rule={e.rule} className="text-[11px] text-[var(--red)]">
          {e.message}
        </span>
      ))}
    </div>
  );
}

/** 行 patch（undefined=删键——空 label/group/help 等不残留，round-trip 干净；
 * 动态键增删经 Record 视图——双重 as 为 TS2352 正规过桥） */
function patchAt(list: ParamField[], i: number, patch: Partial<ParamField>): ParamField[] {
  return list.map((f, j) => {
    if (j !== i) return f;
    const next: Record<string, unknown> = { ...f };
    for (const [key, val] of Object.entries(patch)) {
      if (val === undefined) delete next[key];
      else next[key] = val;
    }
    return next as unknown as ParamField;
  });
}

/** validate patch（空键删除；全空=摘 validate 键——02 §8.3 校验项缺省位） */
function withValidate(field: ParamField, patch: Partial<ParamValidate>): ParamField {
  const next: Record<string, unknown> = { ...(field.validate ?? {}) };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined || val === '') delete next[key];
    else next[key] = val;
  }
  if (Object.keys(next).length === 0) {
    const rest: Record<string, unknown> = { ...field };
    delete rest.validate;
    return rest as unknown as ParamField;
  }
  return { ...field, validate: next as unknown as ParamValidate };
}

/** policy patch（undefined=删键；全空=null 未声明位——缺省默认 timeout 30s/retries 0/abort） */
function patchPolicy(policy: RunPolicy | null, patch: Partial<RunPolicy>): RunPolicy | null {
  const next: Record<string, unknown> = { ...policy };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) delete next[key];
    else next[key] = val;
  }
  if (Object.keys(next).length === 0) return null;
  return next as RunPolicy;
}

/** io patch（三声明位全空=null 未声明——02 §8.1「io 可缺」） */
function withIo(io: IoContract | null, mut: (d: IoContract) => void): IoContract | null {
  const next: IoContract = { ...(io ?? {}) };
  mut(next);
  if (next.input === undefined && next.output === undefined && next.outputs === undefined) return null;
  return next;
}

/** default 编辑控件（按 t 分形：boolean 三态 select／number·slider 数字化／json 序列化回写） */
function DefaultControl({ field, onDefault }: { field: ParamField; onDefault(v: unknown): void }) {
  if (field.t === 'boolean') {
    return (
      <select
        data-schema-field="default"
        value={field.default === undefined ? '' : String(field.default)}
        onChange={(e) => onDefault(e.target.value === '' ? undefined : e.target.value === 'true')}
        className={INPUT_CLS}
      >
        <option value="">默认值（未设）</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (field.t === 'number' || field.t === 'slider') {
    return (
      <input
        type="number"
        data-schema-field="default"
        value={field.default === undefined || field.default === null ? '' : String(field.default)}
        onChange={(e) => onDefault(e.target.value === '' ? undefined : Number(e.target.value))}
        placeholder="默认值（数字）"
        className={INPUT_CLS}
      />
    );
  }
  if (field.t === 'json') {
    return (
      <input
        data-schema-field="default"
        value={
          field.default === undefined || field.default === null
            ? ''
            : typeof field.default === 'string'
              ? field.default
              : JSON.stringify(field.default)
        }
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onDefault(undefined);
            return;
          }
          try {
            onDefault(JSON.parse(raw));
          } catch {
            onDefault(raw); // 非法 JSON 暂存原文（预览控件层 json 解析提示承接）
          }
        }}
        placeholder="默认值（JSON）"
        className={INPUT_CLS}
      />
    );
  }
  return (
    <input
      data-schema-field="default"
      value={field.default === undefined || field.default === null ? '' : String(field.default)}
      onChange={(e) => onDefault(e.target.value === '' ? undefined : e.target.value)}
      placeholder="默认值"
      className={INPUT_CLS}
    />
  );
}

/** N3 单字段编辑行（行内错误=field 命中 paramsSchema[i] 前缀——§6.1b 定位面） */
function SchemaFieldRow(props: {
  field: ParamField;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  errors: readonly StepFieldError[];
  onPatch(i: number, patch: Partial<ParamField>): void;
  onPatchValidate(i: number, patch: Partial<ParamValidate>): void;
  onRemove(i: number): void;
  onMove(i: number, dir: -1 | 1): void;
}) {
  const { field, index, isFirst, isLast, errors, onPatch, onPatchValidate, onRemove, onMove } = props;
  const setNum = (key: 'min' | 'max' | 'step', raw: string): void => {
    const v = raw === '' ? undefined : Number(raw);
    const patch: Partial<ParamField> = {};
    if (key === 'min') patch.min = v;
    else if (key === 'max') patch.max = v;
    else patch.step = v;
    onPatch(index, patch);
  };
  const setValidateNum = (key: 'min' | 'max' | 'minLines', raw: string): void => {
    const v = raw === '' ? undefined : Number(raw);
    const patch: Partial<ParamValidate> = {};
    if (key === 'min') patch.min = v;
    else if (key === 'max') patch.max = v;
    else patch.minLines = v;
    onPatchValidate(index, patch);
  };

  return (
    <div data-schema-row={index} className="flex flex-col gap-1.5 rounded-md border border-[var(--line-2)] px-2.5 py-2">
      <div className="grid grid-cols-12 gap-1.5">
        <input
          data-schema-field="k"
          value={field.k}
          placeholder="参数键 k"
          onChange={(e) => onPatch(index, { k: e.target.value })}
          className={`${INPUT_CLS} col-span-3 font-mono`}
        />
        <select
          data-schema-field="t"
          value={field.t}
          onChange={(e) => {
            const t = e.target.value;
            // 类型切换：secret 自动带 storage（02 §8.1 示例形）；清离类型专属键（opts/min-max-step
            // ——param-form-model 仅 slider 消费 min/max/step、select 消费 opts，残留=脏声明）
            const patch: Partial<ParamField> =
              t === 'secret' ? { t, storage: 'safeStorage' } : { t, storage: undefined };
            if (t !== 'select') patch.opts = undefined;
            if (t !== 'slider') {
              patch.min = undefined;
              patch.max = undefined;
              patch.step = undefined;
            }
            onPatch(index, patch);
          }}
          className={`${INPUT_CLS} col-span-2`}
        >
          {!(PARAM_TYPE_WHITELIST as readonly string[]).includes(field.t) && (
            <option value={field.t}>{`${field.t || '（空）'}（白名单外）`}</option>
          )}
          {PARAM_TYPE_WHITELIST.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="col-span-2 flex items-center gap-1.5 text-[11px] text-[var(--tx-3)]">
          <input
            type="checkbox"
            data-schema-field="required"
            checked={field.required === true}
            onChange={(e) => onPatch(index, { required: e.target.checked ? true : undefined })}
          />
          必填
        </label>
        <input
          data-schema-field="group"
          value={field.group ?? ''}
          placeholder="分组 group"
          onChange={(e) => onPatch(index, { group: e.target.value === '' ? undefined : e.target.value })}
          className={`${INPUT_CLS} col-span-2`}
        />
        <input
          data-schema-field="label"
          value={field.label ?? ''}
          placeholder="标签 label（缺省=k）"
          onChange={(e) => onPatch(index, { label: e.target.value === '' ? undefined : e.target.value })}
          className={`${INPUT_CLS} col-span-3`}
        />
      </div>

      <div className="grid grid-cols-12 gap-1.5">
        <div className="col-span-4">
          <DefaultControl field={field} onDefault={(v) => onPatch(index, { default: v })} />
        </div>
        <input
          data-schema-field="help"
          value={field.help ?? ''}
          placeholder="help 提示文案"
          onChange={(e) => onPatch(index, { help: e.target.value === '' ? undefined : e.target.value })}
          className={`${INPUT_CLS} col-span-8`}
        />
      </div>

      {field.t === 'slider' && (
        <div className="grid grid-cols-12 gap-1.5">
          <input type="number" data-schema-field="min" value={numStr(field.min)} placeholder="slider min" onChange={(e) => setNum('min', e.target.value)} className={`${INPUT_CLS} col-span-4`} />
          <input type="number" data-schema-field="max" value={numStr(field.max)} placeholder="slider max" onChange={(e) => setNum('max', e.target.value)} className={`${INPUT_CLS} col-span-4`} />
          <input type="number" data-schema-field="step" value={numStr(field.step)} placeholder="slider step" onChange={(e) => setNum('step', e.target.value)} className={`${INPUT_CLS} col-span-4`} />
        </div>
      )}

      {field.t === 'select' && (
        <input
          data-schema-field="opts"
          value={(field.opts ?? []).join(',')}
          placeholder="select 静态选项（逗号分隔；运行时数据驱动下拉=G-1 vNext）"
          onChange={(e) => {
            const opts = e.target.value
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter((s) => s !== '');
            onPatch(index, opts.length === 0 ? { opts: undefined } : { opts });
          }}
          className={INPUT_CLS}
        />
      )}

      {field.t === 'secret' && (
        <span className="text-[10.5px] text-[var(--tx-3)]">
          密钥型：界面掩码＋safeStorage 加密存储（storage:'safeStorage'，02 §8.3）；明文不入导出/发布包（X-20）
        </span>
      )}

      <div className="grid grid-cols-12 gap-1.5">
        <input
          data-schema-field="validate.regex"
          value={field.validate?.regex ?? ''}
          placeholder="校验正则 regex（02 §8.3 抽屉保存执行）"
          onChange={(e) => onPatchValidate(index, { regex: e.target.value === '' ? undefined : e.target.value })}
          className={`${INPUT_CLS} col-span-6 font-mono`}
        />
        <input type="number" data-schema-field="validate.min" value={numStr(field.validate?.min)} placeholder="范围 min" onChange={(e) => setValidateNum('min', e.target.value)} className={`${INPUT_CLS} col-span-2`} />
        <input type="number" data-schema-field="validate.max" value={numStr(field.validate?.max)} placeholder="范围 max" onChange={(e) => setValidateNum('max', e.target.value)} className={`${INPUT_CLS} col-span-2`} />
        <input type="number" data-schema-field="validate.minLines" value={numStr(field.validate?.minLines)} placeholder="行数 minLines" onChange={(e) => setValidateNum('minLines', e.target.value)} className={`${INPUT_CLS} col-span-2`} />
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--tx-3)]">{`paramsSchema[${index}]`}</span>
        <div className="flex items-center gap-1">
          <button type="button" data-schema-move-up={index} disabled={isFirst} className={BTN_CLS} onClick={() => onMove(index, -1)}>
            ↑
          </button>
          <button type="button" data-schema-move-down={index} disabled={isLast} className={BTN_CLS} onClick={() => onMove(index, 1)}>
            ↓
          </button>
          <button type="button" data-schema-remove={index} className={BTN_CLS} onClick={() => onRemove(index)}>
            删
          </button>
        </div>
      </div>

      <RowErrors errors={errors} match={(f) => f === `paramsSchema[${index}]` || f.startsWith(`paramsSchema[${index}].`)} />
    </div>
  );
}

/** N7 字段列表编辑器（input/output/outputs.<exit> 共用——每项 name＋type〔必填〕＋example） */
function IoFieldsEditor(props: {
  scope: string;
  fields: IoField[];
  errors: readonly StepFieldError[];
  errorPrefix: string;
  onChange(fields: IoField[]): void;
}) {
  const { scope, fields, errors, errorPrefix, onChange } = props;
  const setRow = (i: number, patch: Partial<IoField>): void => {
    onChange(
      fields.map((f, j) => {
        if (j !== i) return f;
        const next: Record<string, unknown> = { ...f };
        for (const [key, val] of Object.entries(patch)) {
          if (val === undefined || val === '') delete next[key];
          else next[key] = val;
        }
        return next as unknown as IoField;
      }),
    );
  };

  return (
    <div data-io-fields={scope} className="flex flex-col gap-1.5 rounded-md border border-dashed border-[var(--line-2)] px-2 py-1.5">
      {fields.length === 0 && (
        <span className="text-[10.5px] text-[var(--tx-3)]">（无字段——每项须 name＋type，02 §8.1）</span>
      )}
      {fields.map((f, i) => (
        <div key={i} data-io-row={i} className="grid grid-cols-12 items-center gap-1.5">
          <input data-io-field="name" value={f.name ?? ''} placeholder="字段名 name *" onChange={(e) => setRow(i, { name: e.target.value })} className={`${INPUT_CLS} col-span-4`} />
          <input data-io-field="type" value={f.type ?? ''} placeholder="类型 type *（如 object[]）" onChange={(e) => setRow(i, { type: e.target.value })} className={`${INPUT_CLS} col-span-4`} />
          <input data-io-field="example" value={f.example ?? ''} placeholder="示例 example" onChange={(e) => setRow(i, { example: e.target.value === '' ? undefined : e.target.value })} className={`${INPUT_CLS} col-span-3`} />
          <button type="button" data-io-remove={i} className={`${BTN_CLS} col-span-1`} onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            删
          </button>
        </div>
      ))}
      <button type="button" data-io-add-field className={`${BTN_CLS} self-start`} onClick={() => onChange([...fields, { name: '', type: '' }])}>
        ＋字段
      </button>
      {/* 前缀匹配 only：精确命中（如键⊄outs 的 io.outputs.<exit>）在 outputs 出口行级渲染——同块不重复（评审 MINOR2） */}
      <RowErrors errors={errors} match={(f) => f.startsWith(`${errorPrefix}.`)} />
    </div>
  );
}

export function StepSchema(props: StepSchemaProps) {
  const { paramsSchema, policy, io, exitIds, errors, onSchemaChange, onPolicyChange, onIoChange } = props;
  const onFailure = policy?.onFailure;

  const addField = (): void => {
    onSchemaChange([...paramsSchema, { k: freshKey('param', paramsSchema.map((f) => f.k)), t: 'text' }]);
  };
  const removeField = (i: number): void => {
    onSchemaChange(paramsSchema.filter((_, j) => j !== i));
  };
  const moveField = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= paramsSchema.length) return;
    const next = [...paramsSchema];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    onSchemaChange(next);
  };

  const setPolicyNum = (key: 'timeoutMs' | 'retries' | 'backoffMs', raw: string): void => {
    const v = raw === '' ? undefined : Number(raw);
    const patch: Partial<RunPolicy> =
      key === 'timeoutMs' ? { timeoutMs: v } : key === 'retries' ? { retries: v } : { backoffMs: v };
    onPolicyChange(patchPolicy(policy, patch));
  };
  const setOnFailureType = (v: string): void => {
    const next: RunPolicy['onFailure'] =
      v === ''
        ? undefined
        : v === 'abort'
          ? { type: 'abort' }
          : { type: 'failBranch', exit: onFailure?.type === 'failBranch' ? onFailure.exit : (exitIds[0] ?? '') };
    onPolicyChange(patchPolicy(policy, { onFailure: next }));
  };
  const setOnFailureExit = (exit: string): void => {
    onPolicyChange(patchPolicy(policy, { onFailure: { type: 'failBranch', exit } }));
  };

  const outputsEntries = Object.entries(io?.outputs ?? {});
  const usedKeys = outputsEntries.map(([k]) => k);
  const unusedExits = exitIds.filter((id) => !usedKeys.includes(id));
  const renameOutputsKey = (oldKey: string, newKey: string): void => {
    onIoChange(
      withIo(io, (d) => {
        const rebuilt: NonNullable<IoContract['outputs']> = {};
        for (const [k, spec] of Object.entries(d.outputs ?? {})) {
          rebuilt[k === oldKey ? newKey : k] = spec;
        }
        d.outputs = rebuilt;
      }),
    );
  };
  const removeOutputsKey = (key: string): void => {
    onIoChange(
      withIo(io, (d) => {
        const rebuilt: NonNullable<IoContract['outputs']> = {};
        for (const [k, spec] of Object.entries(d.outputs ?? {})) {
          if (k !== key) rebuilt[k] = spec;
        }
        d.outputs = rebuilt;
      }),
    );
  };

  return (
    <div data-step-form="schema" className="flex flex-col gap-4">
      {/* N3 字段定义器 */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--tx-2)]">
            参数字段（N3——类型白名单八类/默认值/必填/校验/help/分组，02 §8.1）
          </span>
          <button type="button" data-schema-action="add-field" className={BTN_CLS} onClick={addField}>
            ＋字段
          </button>
        </div>
        {paramsSchema.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--line-2)] px-2 py-1.5 text-[11px] text-[var(--tx-3)]">
            （无参数——右栏预览即空表单；字段编辑即时反映）
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {paramsSchema.map((f, i) => (
            <SchemaFieldRow
              key={i} /* 行 key=index 稳定：k 每键变化不得卸载重挂整行丢焦点（评审 MAJOR）；重排/删行按位重挂无焦点代价 */
              field={f}
              index={i}
              isFirst={i === 0}
              isLast={i === paramsSchema.length - 1}
              errors={errors}
              onPatch={(idx, patch) => onSchemaChange(patchAt(paramsSchema, idx, patch))}
              onPatchValidate={(idx, patch) => onSchemaChange(paramsSchema.map((f2, j) => (j === idx ? withValidate(f2, patch) : f2)))}
              onRemove={removeField}
              onMove={moveField}
            />
          ))}
        </div>
      </section>

      {/* N6 高级声明 · 运行策略（03 §1 ⚠ 冻结形——挂 StepSchema） */}
      <section data-advanced-group="policy" className="flex flex-col gap-2 rounded-lg border border-[var(--line-2)] px-3 py-2.5">
        <span className="text-[11px] font-semibold text-[var(--tx-2)]">
          高级声明 · 运行策略 N6（缺省=timeout 30s / retries 0 / onFailure abort——02 §8.6；0=显式有效值，X-4）
        </span>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[10.5px] text-[var(--tx-3)]">
            超时 timeoutMs（0=不设守护）
            <input type="number" data-policy-field="timeoutMs" value={numStr(policy?.timeoutMs)} onChange={(e) => setPolicyNum('timeoutMs', e.target.value)} placeholder="缺省 30000" className={INPUT_CLS} />
          </label>
          <label className="flex flex-col gap-1 text-[10.5px] text-[var(--tx-3)]">
            重试 retries（0=显式禁用）
            <input type="number" data-policy-field="retries" value={numStr(policy?.retries)} onChange={(e) => setPolicyNum('retries', e.target.value)} placeholder="缺省 0" className={INPUT_CLS} />
          </label>
          <label className="flex flex-col gap-1 text-[10.5px] text-[var(--tx-3)]">
            退避基数 backoffMs
            <input type="number" data-policy-field="backoffMs" value={numStr(policy?.backoffMs)} onChange={(e) => setPolicyNum('backoffMs', e.target.value)} placeholder="如 2000" className={INPUT_CLS} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[10.5px] text-[var(--tx-3)]">
            失败策略 onFailure（X-3 两形态）
            <select data-policy-field="onFailure.type" value={onFailure?.type ?? ''} onChange={(e) => setOnFailureType(e.target.value)} className={INPUT_CLS}>
              <option value="">未声明（缺省 abort）</option>
              <option value="abort">abort（终止 run）</option>
              <option value="failBranch">failBranch（走具名失败出口）</option>
            </select>
          </label>
          {onFailure?.type === 'failBranch' && (
            <label className="flex flex-col gap-1 text-[10.5px] text-[var(--tx-3)]">
              失败出口 exit（⊆ N2 outs——02 §8.1 #5）
              <select
                data-policy-field="onFailure.exit"
                value={onFailure.exit ?? ''}
                onChange={(e) => setOnFailureExit(e.target.value)}
                className={INPUT_CLS}
              >
                {exitIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                {onFailure.exit !== undefined && !exitIds.includes(onFailure.exit) && (
                  <option value={onFailure.exit}>{`${onFailure.exit || '（空）'}（不在 outs）`}</option>
                )}
              </select>
            </label>
          )}
        </div>
        <RowErrors errors={errors} match={(f) => f.startsWith('policy.')} />
      </section>

      {/* N7 高级声明 · IO 契约（单 output 与 per-exit outputs 兼容共存，X-5） */}
      <section data-advanced-group="io" className="flex flex-col gap-2 rounded-lg border border-[var(--line-2)] px-3 py-2.5">
        <span className="text-[11px] font-semibold text-[var(--tx-2)]">高级声明 · IO 契约 N7（input 期望 / output 单声明 / outputs 按出口声明——02 §8.1 #6/#7）</span>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-[11px] text-[var(--tx-2)]">
            <input
              type="checkbox"
              data-io-toggle="input"
              checked={io?.input !== undefined}
              onChange={(e) =>
                onIoChange(
                  withIo(io, (d) => {
                    if (e.target.checked) d.input = { fields: [] };
                    else d.input = undefined;
                  }),
                )
              }
            />
            声明输入 io.input.fields（供 AI 规划/校验器，02 §8.7）
          </label>
          {io?.input !== undefined && (
            <IoFieldsEditor
              scope="input"
              fields={io.input.fields ?? []}
              errors={errors}
              errorPrefix="io.input.fields"
              onChange={(fields) => onIoChange(withIo(io, (d) => { d.input = { ...d.input, fields }; }))}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-[11px] text-[var(--tx-2)]">
            <input
              type="checkbox"
              data-io-toggle="output"
              checked={io?.output !== undefined}
              onChange={(e) =>
                onIoChange(
                  withIo(io, (d) => {
                    if (e.target.checked) d.output = { fields: [] };
                    else d.output = undefined;
                  }),
                )
              }
            />
            声明单输出 io.output.fields（未按出口分声明的出口回退此声明，X-5）
          </label>
          {io?.output !== undefined && (
            <IoFieldsEditor
              scope="output"
              fields={io.output.fields ?? []}
              errors={errors}
              errorPrefix="io.output.fields"
              onChange={(fields) => onIoChange(withIo(io, (d) => { d.output = { ...d.output, fields }; }))}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--tx-2)]">按出口声明 io.outputs（键 ⊆ N2 outs——per-exit 输出 schema，X-5）</span>
            <button
              type="button"
              data-io-action="add-outputs"
              disabled={unusedExits.length === 0}
              title={unusedExits.length === 0 ? '出口已全声明（或 outs 为空）' : undefined}
              className={BTN_CLS}
              onClick={() => {
                const key = unusedExits[0];
                if (key === undefined) return;
                onIoChange(withIo(io, (d) => { d.outputs = { ...(d.outputs ?? {}), [key]: { fields: [] } }; }));
              }}
            >
              ＋出口声明
            </button>
          </div>
          {outputsEntries.map(([exit, spec], idx) => {
            // 换键选项排除他行已占用出口 id（与 add-outputs 的 unusedExits 同口径——评审 MINOR1：
            // 改名为占用键会静默覆盖另一份 spec，选项面直接不给）
            const takenByOthers = usedKeys.filter((k) => k !== exit);
            const selectable = exitIds.filter((id) => !takenByOthers.includes(id));
            return (
            <div key={`${exit}-${idx}`} data-io-outputs-row={idx} className="flex flex-col gap-1.5 rounded-md border border-[var(--line-2)] px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <select data-io-outputs-field="exit" value={exit} onChange={(e) => renameOutputsKey(exit, e.target.value)} className={`${INPUT_CLS} max-w-[200px]`}>
                  {selectable.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  {!exitIds.includes(exit) && <option value={exit}>{`${exit}（不在 outs）`}</option>}
                </select>
                <button type="button" data-io-outputs-remove={idx} className={BTN_CLS} onClick={() => removeOutputsKey(exit)}>
                  删
                </button>
                <span className="font-mono text-[10px] text-[var(--tx-3)]">{`io.outputs.${exit}`}</span>
              </div>
              <RowErrors errors={errors} match={(f) => f === `io.outputs.${exit}`} />
              <IoFieldsEditor
                scope={`outputs.${exit}`}
                fields={Array.isArray(spec?.fields) ? spec.fields : []}
                errors={errors}
                errorPrefix={`io.outputs.${exit}`}
                onChange={(fields) => onIoChange(withIo(io, (d) => { d.outputs = { ...(d.outputs ?? {}), [exit]: { fields } }; }))}
              />
            </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
