// configYaml 解析与合并（T4-16 / TDD-C-M1 §3 SandboxExecutor 组件行「configYaml 合并语义」＋
// 02 §14 冻结覆盖序——M4 #5 收口：合并归 C-M1、yaml 解析收窄本组件单点，K-01 双运行时
// 不同构 yaml）。
//
// 冻结序（02 §14）：脚本内置 PARAMS 默认值 ← config/*.yaml（包级默认）← 节点实例 params（抽屉）。
// 本组件产出 ctx.params = { ...config, ...实例 params }——config 覆盖 PARAMS 默认、实例 params
// 覆盖 config；脚本作者侧 `p = { ...PARAMS, ...ctx.params }`（demo L1051-1056 语义）不变。
//
// 解析子集（自拟冻结留痕——不引 yaml 三方依赖〔本卡零新增依赖红线〕；包级 config 形=标量/
// 嵌套 map/标量序列）：
//   - 行形：`key: value`（标量）／`key:`（嵌套块）／`- value`（序列项）；空行与 `#` 注释行忽略
//     （行内尾注释=引号外空白后的 `#` 起）；tab 缩进拒绝；
//   - 标量：单/双引号字符串、true/false、null/~、整数/浮点、其余按裸字符串（裸串含 `: `〔冒号
//     +空格，YAML 映射指示形〕拒绝——URL 等 `:/` 形合法）；
//   - 嵌套以缩进表达（子块缩进 > 父键；同级缩进一致）；
//   - 不支持：锚点/引用、多文档、流式内联（[]/{}/`{a: 1}`）、复杂键。违规行 → CONFIG-YAML-INVALID
//   抛错（Error+string code——经 IpcGateway serializeError 归一 {code,message}；✅ T4-20 落地
//   〔2026-11-10〕：T4-16 🟡 登记项裁决＝登记制——本码已入 X-01 错误码集 IPC_ERROR_CODES，
//   不再走 INTERNAL 归一面；yaml 解析错误对用户可操作）。
import { IPC_ERROR_CODES } from '@constella/shared/ipc';

/** 解析失败错误（code=CONFIG-YAML-INVALID——序列化归一面见文件头） */
export class ConfigYamlError extends Error {
  readonly code: string = IPC_ERROR_CODES.CONFIG_YAML_INVALID;

  constructor(message: string) {
    super(message);
    this.name = 'ConfigYamlError';
  }
}

/** 标量解析（引号串/布尔/null/数值/裸串） */
function parseScalar(raw: string, lineNo: number): unknown {
  const t = raw.trim();
  if (t === '') return null;
  if (
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') || t.startsWith('{')) {
    throw new ConfigYamlError(`第 ${lineNo} 行：流式内联 [}/{ 不在子集内（序列用 '- ' 行、映射用缩进）: ${t}`);
  }
  if (t.includes(': ') || t.endsWith(':')) {
    throw new ConfigYamlError(`第 ${lineNo} 行：裸标量含映射指示形 ': '（字符串值须加引号）: ${t}`);
  }
  return t;
}

interface YamlLine {
  indent: number;
  text: string;
  lineNo: number;
}

/** 预处理：去 tab 缩进/空行/注释；`#` 仅在引号外空白后生效 */
function toLines(source: string): YamlLine[] {
  const out: YamlLine[] = [];
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    if (/^ *\t/.test(raw)) {
      throw new ConfigYamlError(`第 ${i + 1} 行：tab 缩进不支持（须空格）`);
    }
    let line = raw;
    const hash = line.indexOf('#');
    if (hash === 0 || (hash > 0 && /\s/.test(line[hash - 1]!) && !/['"]/.test(line.slice(0, hash)))) {
      line = line.slice(0, hash);
    }
    if (line.trim() === '') continue;
    const indent = /^ */.exec(line)![0].length;
    out.push({ indent, text: line.trim(), lineNo: i + 1 });
  }
  return out;
}

/** 递归下降解析（indent=当前块统一缩进层级） */
function parseBlock(lines: YamlLine[], pos: { i: number }, indent: number): unknown {
  // 序列分支：本层首行 `- ` 形
  if (pos.i < lines.length && lines[pos.i]!.indent === indent && lines[pos.i]!.text.startsWith('- ')) {
    const items: unknown[] = [];
    while (pos.i < lines.length && lines[pos.i]!.indent === indent && lines[pos.i]!.text.startsWith('- ')) {
      const item = lines[pos.i]!;
      items.push(parseScalar(item.text.slice(2), item.lineNo));
      pos.i++;
    }
    return items;
  }
  // map 分支
  const map: Record<string, unknown> = {};
  while (pos.i < lines.length) {
    const line = lines[pos.i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new ConfigYamlError(`第 ${line.lineNo} 行：缩进越级（期望 ${indent} 空格）`);
    }
    const m = /^([^:]+):(.*)$/.exec(line.text);
    if (m === null) {
      throw new ConfigYamlError(`第 ${line.lineNo} 行：须为 'key: value' 或 'key:' 嵌套形: ${line.text}`);
    }
    const key = m[1]!.trim();
    if (key === '') throw new ConfigYamlError(`第 ${line.lineNo} 行：空键`);
    const rest = m[2]!.trim();
    pos.i++;
    if (rest === '') {
      // 嵌套块（下一行缩进更深则递归，否则 null 空值）
      if (pos.i < lines.length && lines[pos.i]!.indent > indent) {
        map[key] = parseBlock(lines, pos, lines[pos.i]!.indent);
      } else {
        map[key] = null;
      }
    } else {
      map[key] = parseScalar(rest, line.lineNo);
    }
  }
  return map;
}

/**
 * 解析包级 config.yaml 文本（子集见文件头）——SandboxExecutor 组装 ctx.params 的单点。
 * 顶层须为 map（`key: value` 形）；空文本 → {}。
 */
export function parseConfigYaml(text: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  const lines = toLines(text);
  if (lines.length === 0) return {};
  if (lines[0]!.indent !== 0) {
    throw new ConfigYamlError(`第 ${lines[0]!.lineNo} 行：顶层缩进须为 0`);
  }
  const parsed = parseBlock(lines, { i: 0 }, 0);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigYamlError('顶层须为 key: value 映射');
  }
  return parsed as Record<string, unknown>;
}

/**
 * 02 §14 冻结序合并入 ctx.params：config ← 实例 params（实例覆盖 config；脚本 PARAMS 默认
 * 由脚本作者侧展开，不在本函数）。configYaml 缺省/空 → 实例 params 原样。
 */
export function mergeParams(
  params: Record<string, unknown>,
  configYaml?: string,
): Record<string, unknown> {
  const config = configYaml === undefined ? {} : parseConfigYaml(configYaml);
  return { ...config, ...params };
}
