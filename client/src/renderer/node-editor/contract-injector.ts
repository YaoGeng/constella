// ContractInjector —— ts/py 同构契约模板注入（T6-08；TDD-C-13 §3 ContractInjector 行——与
// demo bundleCode 生成物同构〔prototypes/demo.html L1027-1050＝同构源〕）。
//
//   与 demo 的两处有意差异（任务卡锚定，非静默改）：
//   ① L1036 `@flowforge/sdk` 作废 → `@constella/sdk`（02 §14 SDK 契约冻结，D-10）；
//   ② 头行「[AI 生成]」尾注去除——本模块为 PATH1 手动定义入口（01 §5.3），demo 尾注属
//     AI 工坊来源语境（05 T6-08 卡头形文字即无尾注）。
//   其余逐字同构：ts=L1034-1040、py=L1042-1049（含 `import json, random` 与 py 第三行
//   ctx 简写列表——契约注释行为 demo 同构简写，完整契约形=02 §14 @constella/sdk 类型面）。
//   PARAMS 默认值参数源=N3 ParamField[].default（正式 DSL 键；demo p.ph 为占位惯例键，
//   参照非权威），转义规则逐字同 demo L1030。
import type { ParamField } from '@constella/shared/dsl';
import type { ScriptLang } from './syntax-checker';

/** PARAMS 默认值行集（demo L1029-1032 转义规则逐字：\\ 双写、'''→'\、换行→\n 字面；
 * default 缺省=空串——demo `p.ph??''` 同构） */
function defaultEntries(params: readonly ParamField[]): string {
  return params
    .map((p) => {
      const v = String(p.default ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'''/g, "'\\")
        .replace(/\n/g, '\\n');
      return `  "${p.k}": "${v}"`;
    })
    .join(',\n');
}

/**
 * 契约模板注入（C-13 §3 组件级接口：inject(lang, params): string——file 为可选扩展位，
 * 形=DSL ExecSpec.file「zip 包内相对路径」（如 scripts/xhs_search.py；demo b.file 裸名形
 * ×——生成物文本与 demo 同构，参数形对齐 DSL），缺省 scripts/main.<py|ts>；类型相关文件名
 * 随 T6-09 保存链 exec.file 定）。入口体=最小占位 return（demo 默认体同构；业务主体由
 * 用户/AI 填写）。
 */
export function inject(lang: ScriptLang, params: readonly ParamField[], file?: string): string {
  const defaults = defaultEntries(params);
  if (lang === 'ts') {
    // demo L1034-1040 同构（占位体=默认体 `  return { data: ctx.input };`）
    return (
      `// ${file ?? 'scripts/main.ts'} · 星丛 Constella 节点脚本\n` +
      `// 契约：run(ctx) → { data } 或 { branch: "<出边>" }；ctx = { params, input, browser, llm, im, vault, agent, log, sleep }\n` +
      `import type { NodeCtx, NodeOut } from "@constella/sdk";\n\n` +
      `const PARAMS = {\n${defaults}\n};\n\n` +
      `export async function run(ctx: NodeCtx): Promise<NodeOut> {\n` +
      `  const p = { ...PARAMS, ...(ctx.params || {}) };\n` +
      `  return { data: ctx.input };\n` +
      `}`
    );
  }
  // demo L1042-1049 同构（py 模板带尾随换行——demo L1049 `+\n` 原样；入口缺省 run=ExecSpec.entry 惯例）
  return (
    `# ${file ?? 'scripts/main.py'} · 星丛 Constella 节点脚本\n` +
    `# 契约：run(ctx) → {"data": ...} 或 {"branch": "<出边>"}\n` +
    `# ctx = { params, input, browser, llm, vault, log, sleep }   入口：run\n` +
    `import json, random\n\n` +
    `PARAMS = {\n${defaults}\n}\n\n` +
    `async def run(ctx):\n` +
    `    p = {**PARAMS, **(ctx.params or {})}\n` +
    `    return {"data": ctx.input}\n`
  );
}
