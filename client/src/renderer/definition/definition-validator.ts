// DefinitionValidator —— 节点定义八条校验器单一来源（C-02 §3 组件行；T4-07；02 §8.1 校验规则=权威）。
//
// 被四方复用（§2 ↑被依赖）：C-05 装载（loadAll 注入——T1-10 侧已留缺省跳过位）/C-13 编辑器/
// C-07 自检/C-08 导入；本模块禁止 import C-05（反向依赖），命名空间查重经 ctx 注入。
// 纯函数 node 直跑；脏数据入口（AI 生成/zip 导入）在类型系统外构造，规则按运行时值判定。
// 交叉校验＝#5 failBranch↔outs、#7 outputs↔outs（05 卡「交叉校验」项即此两条）。
import type { IoField, NodeDefinition, ParamField } from '@constella/shared/dsl';
import type { FieldError, ValidateContext, ValidationResult } from './types';
import { checkExec } from './exec-ref-checker';
import { checkNamespace } from './namespace-guard';
import { checkSemver } from './version-field';

/** N3 参数类型白名单（V1 冻结 8 类，02 §8.1/§8.3 映射表同源；开放扩展=注册新 renderer
 * 映射后随锚升表——X-01 ParamType 开放联合的 V1 收敛面） */
export const PARAM_TYPE_WHITELIST = [
  'text',
  'number',
  'select',
  'textarea',
  'boolean',
  'secret',
  'json',
  'slider',
] as const;

/** N7 fields 项检查（#6/#7 共用：每项 name＋type；fields 缺失＝形错） */
function checkFields(
  fields: readonly IoField[] | undefined,
  basePath: string,
  rule: 'N7-output-fields' | 'N7-outputs-fields',
): FieldError[] {
  if (!Array.isArray(fields)) {
    return [{ field: basePath, message: `${basePath} 缺失（fields 须为数组）`, rule }];
  }
  const errors: FieldError[] = [];
  fields.forEach((f, i) => {
    if (typeof f?.name !== 'string' || f.name.trim() === '') {
      errors.push({
        field: `${basePath}[${i}].name`,
        message: `${basePath}[${i}] 缺 name（N7：每项 name＋type）`,
        rule,
      });
    }
    if (typeof f?.type !== 'string' || f.type.trim() === '') {
      errors.push({
        field: `${basePath}[${i}].type`,
        message: `${basePath}[${i}] 缺 type（N7：每项 name＋type）`,
        rule,
      });
    }
  });
  return errors;
}

/** #3 validate 形检查（02 §8.1：min/max/regex/minLines）——regex 须可编译、数值键须为有限数 */
function checkParamValidate(p: ParamField | undefined, i: number): FieldError[] {
  const v = p?.validate;
  if (v == null) return [];
  const errors: FieldError[] = [];
  const base = `paramsSchema[${i}].validate`;
  if (v.regex !== undefined) {
    let compilable = true;
    try {
      void new RegExp(v.regex);
    } catch {
      compilable = false;
    }
    if (!compilable) {
      errors.push({
        field: `${base}.regex`,
        message: `validate.regex 非法正则：${String(v.regex)}`,
        rule: 'N3-validate',
      });
    }
  }
  for (const key of ['min', 'max', 'minLines'] as const) {
    const val = v[key];
    if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val))) {
      errors.push({
        field: `${base}.${key}`,
        message: `validate.${key} 须为数字（当前「${String(val)}」）`,
        rule: 'N3-validate',
      });
    }
  }
  return errors;
}

/**
 * 八条校验（C-02 §1 签名；ctx 可选＝与 C-05 DefinitionValidator 单参形兼容——缺省时跳过
 * 动态命名空间查、仅静态 BUILTIN_TYPE_IDS 查，loadAll 装载路径即此形态）。
 * 错误序＝N1→N8 维度序（消费方按序展示）。
 */
export function validateDefinition(
  doc: NodeDefinition,
  ctx?: ValidateContext,
): ValidationResult {
  const errors: FieldError[] = [];
  const outs = Array.isArray(doc.ports?.outs) ? doc.ports.outs : [];
  const exitIds = new Set(
    outs.map((o) => o?.id).filter((id): id is string => typeof id === 'string'),
  );

  // #1 N1：custom 不得撞内置 12 类（ctx.hasType＋BUILTIN_TYPE_IDS 双查；builtin 定义不查）
  if (doc.kind === 'custom') errors.push(...checkNamespace(doc.type, ctx));

  // #2 N2：outs ≥1 且出口 id 唯一（ins 0~N 自由，01 PRD-CUSTOM-N2）
  if (outs.length === 0) {
    errors.push({
      field: 'ports.outs',
      message: 'ports.outs 至少 1 个出口（N2：0~N 入、1~N 出）',
      rule: 'N2-outs-empty',
    });
  } else {
    const seen = new Set<string>();
    outs.forEach((o, i) => {
      const id = o?.id;
      if (typeof id !== 'string' || id === '') return; // 空/缺 id 不在八条规则面
      if (seen.has(id)) {
        errors.push({
          field: `ports.outs[${i}].id`,
          message: `出口 id「${id}」重复（N2 出口 id 唯一）`,
          rule: 'N2-outs-duplicate',
        });
      } else {
        seen.add(id);
      }
    });
  }

  // #3 N3：t ∈ 白名单 8 类＋validate 形合法
  if (Array.isArray(doc.paramsSchema)) {
    doc.paramsSchema.forEach((p, i) => {
      if (!(PARAM_TYPE_WHITELIST as readonly string[]).includes(p?.t ?? '')) {
        errors.push({
          field: `paramsSchema[${i}].t`,
          message: `参数类型「${String(p?.t)}」不在 V1 白名单 8 类（text/number/select/textarea/boolean/secret/json/slider）`,
          rule: 'N3-type',
        });
      }
      errors.push(...checkParamValidate(p, i));
    });
  }

  // #4 N4：exec.lang∈{python,ts}＋file/entry 非空（exec 可缺=noScript 判定输入）
  errors.push(...checkExec(doc.exec));

  // #5 N6：failBranch exit 必须命中本节点 N2 outs（具名失败出口 X-3——MA-1 unknown 形）
  const onFailure = doc.policy?.onFailure;
  if (onFailure?.type === 'failBranch' && !exitIds.has(onFailure.exit)) {
    errors.push({
      field: 'policy.onFailure.exit',
      message: `failBranch exit「${String(onFailure.exit)}」不在本节点 outs 出口 id 集合（N6 交叉校验）`,
      rule: 'N6-failBranch',
    });
  }

  // #6 N7：io.output.fields 每项 name＋type
  const io = doc.io;
  if (io?.output) errors.push(...checkFields(io.output.fields, 'io.output.fields', 'N7-output-fields'));

  // #7 N7：io.outputs 键 ⊆ outs＋per-exit fields 每项 name＋type（X-5）
  if (io?.outputs) {
    for (const [exitId, spec] of Object.entries(io.outputs)) {
      if (!exitIds.has(exitId)) {
        errors.push({
          field: `io.outputs.${exitId}`,
          message: `io.outputs 键「${exitId}」超出本节点 outs 出口 id 集合（N7 交叉校验）`,
          rule: 'N7-outputs-keys',
        });
      }
      errors.push(...checkFields(spec?.fields, `io.outputs.${exitId}.fields`, 'N7-outputs-fields'));
    }
  }

  // #8 N8：version/pkg_version semver 形状
  if (!checkSemver(doc.version)) {
    errors.push({
      field: 'version',
      message: `version「${String(doc.version)}」非 semver 形状（X.Y.Z）`,
      rule: 'N8-semver',
    });
  }
  if (!checkSemver(doc.packageVersion)) {
    errors.push({
      field: 'packageVersion',
      message: `packageVersion「${String(doc.packageVersion)}」非 semver 形状（X.Y.Z）`,
      rule: 'N8-semver',
    });
  }

  return { ok: errors.length === 0, errors };
}
