// ConfigYamlEditor 自产自析纯函数层（T6-08；TDD-C-13 §3 ConfigYamlEditor 行「config/*.yaml
// 默认值编辑+与 N3 参数键一致性校验」＋§6.1e「config 键与 schema 键不一致→警告」）。
//
//   自产自析红线（设计值登记）：repo 零 yaml 解析库（client 依赖面无 yaml 面）
// ——不引新依赖不装包，本模块手写极简双向 stringify/parse，解析面只认本模块产出形
// （demo L1051-1056 同构三段：头注释／顶格 node:／顶格 params: 段下两空格缩进键值）。
// 通用 yaml（锚点&、多文档---、流式[]等）不解析=边界外（运行时消费归 main 侧 node-types
// 装载，02 §8.4——本层只服务编辑器键一致性警告与默认值生成）。
//   UI 编辑面（yaml 文本编辑＋警告呈现＋覆盖顺序页头提示）由 ./step-config.tsx 承载——
// 本文件为 C-13 §3 ConfigYamlEditor 行的纯逻辑半段（领地文件清单扩展名 .ts 为准）。
import type { ParamField } from '@constella/shared/dsl';

/** 解析产物（键序保留——stringify 往返稳定；params 值一律单行文本） */
export interface ConfigYamlDoc {
  /** `node: <type>` 行值 */
  node: string;
  /** params: 段键值（值=单行文本；多行已由生成侧 ' | ' 扁平化） */
  params: Record<string, string>;
  /** 键出现序（stringify 按此序回写） */
  order: string[];
}

/** 键一致性差异（§6.1e 警告判定输入——警告不拦截环节门） */
export interface ConfigKeyDiff {
  /** N3 已定义、yaml params 段缺失的键 */
  missing: string[];
  /** yaml params 段有、N3 未定义的键 */
  extra: string[];
  /** yaml 形不符（无 params: 段——按 schema 全键失配提示） */
  malformed: boolean;
}

/** 头注释行（demo L1055 同构——stringify 每次重生成，手写注释不往返保留=设计值） */
function headerLine(node: string): string {
  return `# config/${node}.yaml · 节点默认配置（抽屉参数可覆盖）`;
}

/** 按 N3 schema 生成默认 config yaml（demo configYaml(k) L1052-1055 同构：值=String(default??'')、换行→' | '） */
export function configFromSchema(type: string, schema: readonly ParamField[]): string {
  const lines = schema.map((p) => `  ${p.k}: ${String(p.default ?? '').replace(/\n/g, ' | ')}`).join('\n');
  return `${headerLine(type)}\nnode: ${type}\nparams:\n${lines}\n`;
}

/**
 * 极简解析（自产形三段）：顶格 `node:`／顶格 `params:` 开段（段下 ≥1 空格缩进的 `k: v` 行，
 * 顶格行即收段）；注释/空行/未知顶格键宽容忽略。无 `params:` 段 → null（形不符）。
 */
export function parseConfigYaml(text: string): ConfigYamlDoc | null {
  const doc: ConfigYamlDoc = { node: '', params: {}, order: [] };
  let inParams = false;
  let sawParams = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, ''); // CRLF 容错（textarea 平台差）
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indented = /^ +/.test(line);
    if (indented) {
      if (!inParams) continue; // params: 段外的缩进行（自产形无此面）——宽容忽略
      const colon = line.indexOf(':');
      if (colon === -1) continue; // 无冒号的缩进行——宽容忽略
      const k = line.slice(0, colon).trim();
      const v = line.slice(colon + 1).trim();
      if (k === '') continue;
      if (!(k in doc.params)) doc.order.push(k); // 首见记序（重复键后值覆盖，序不重记）
      doc.params[k] = v;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key === 'params') {
      inParams = true;
      sawParams = true;
      continue;
    }
    inParams = false; // 其他顶格键收段（node 或未知键）
    if (key === 'node') doc.node = val;
  }
  return sawParams ? doc : null;
}

/** 回写规范形（demo L1055 同构：头注释＋node＋params 两空格缩进；键按 order 序） */
export function stringifyConfigYaml(doc: ConfigYamlDoc): string {
  const lines = doc.order.map((k) => `  ${k}: ${doc.params[k] ?? ''}`).join('\n');
  return `${headerLine(doc.node)}\nnode: ${doc.node}\nparams:\n${lines}\n`;
}

/** 与 N3 键一致性比对（§6.1e）：missing=schema 有 yaml 无／extra=yaml 有 schema 无／
 * malformed=parse null（missing 回落 schema 全键——全量失配提示）；序=schema 序/首见序。 */
export function diffConfigKeys(yaml: string, schema: readonly ParamField[]): ConfigKeyDiff {
  const schemaKeys = schema.map((p) => p.k);
  const doc = parseConfigYaml(yaml);
  if (doc === null) {
    return { missing: [...schemaKeys], extra: [], malformed: true };
  }
  const yamlKeys = new Set(doc.order);
  const schemaSet = new Set(schemaKeys);
  return {
    missing: schemaKeys.filter((k) => !yamlKeys.has(k)),
    extra: doc.order.filter((k) => !schemaSet.has(k)),
    malformed: false,
  };
}
