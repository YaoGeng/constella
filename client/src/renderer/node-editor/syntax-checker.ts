// SyntaxChecker —— 脚本语法校验（T6-08；TDD-C-13 §3 SyntaxChecker 行「ts=typescript 包
// parser（纯 JS renderer 可跑，S-1 锁 5.9.3）；py 实现=§8①」＋§6.1d 保存门拦截+错误行定位）。
//
//   §8① 冻结口径（T0-04 决策卡，2026-11-09）：py=@lezer/python@1.1.19 纯 JS parser 路径
// （MIT 全树；error node 偏移→行号定位、message 自合成「Syntax error」+行号）；ts=typescript
// 5.9.3 parser（S-1 锁，静态 import——勿做懒加载复杂化）。两语言错误形统一 SyntaxError[]
// （line 恒 1-based）。
//   语义边界：只做语法（parse）校验——类型检查/resolve 不在本卡面（保存门=语法门，
// §6.1d「ts 语法错误→保存拒绝并回指 StepScript 行号」）；空文本零诊断（无脚本=noScript
// 判定输入，02 §8.4——是否拦归 T6-09 保存链）。
import { parser } from '@lezer/python';
import ts from 'typescript';

/**
 * 脚本语言值域（对齐 DSL ExecSpec.lang 'python' | 'ts'——02 §8.1 规则#4；UI 侧显示 py|ts
 * 双标签。任务卡「py|ts」字面的等价确定形：以 DSL 值域为准，避免草稿→exec 落库时二次转换）。
 */
export type ScriptLang = 'python' | 'ts';

/**
 * 语法错误契约形（C-13 §3 check 返回 SyntaxError[]；非全局 SyntaxError——本模块契约形）：
 * line=1-based 行号（错误行定位），message=ts 用 parser 原生诊断文本 / py 自合成
 * 「Syntax error」（§8① 冻结——lezer 不产诊断文本为已知妥协，03 §4 S-9 行）。
 */
export interface SyntaxError {
  line: number;
  message: string;
}

/** ts 侧：createSourceFile parse 诊断（公共 d.ts 未声明 parseDiagnostics=TS 内部 API，
 * 运行时稳定存在〔typescript-eslint 同源用法〕——正规过桥，升级 5.x 线内安全） */
function checkTs(code: string): SyntaxError[] {
  const sf = ts.createSourceFile('step-script.ts', code, ts.ScriptTarget.ES2022);
  const parseDiagnostics = (
    sf as unknown as {
      parseDiagnostics?: readonly { start?: number; messageText: string | ts.DiagnosticMessageChain }[];
    }
  ).parseDiagnostics;
  return (parseDiagnostics ?? []).map((d) => ({
    line: sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, // 0-based → 1-based
    message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
  }));
}

/** py 侧：lezer parse → error node 偏移换行号＋message 自合成（§8①）。
 * 同行多 error node 去重为一条（错误行定位粒度=行级——「Syntax error」+行号冻结口径，
 * 行级去重为设计值：bad((( 三括号=三 error node，逐条重复无增量信息）；输出按行升序。 */
function checkPy(code: string): SyntaxError[] {
  const tree = parser.parse(code);
  const seenLines = new Set<number>();
  const out: SyntaxError[] = [];
  tree.cursor().iterate((node) => {
    if (node.type?.isError) {
      const line = code.slice(0, node.from).split('\n').length; // 偏移前换行数+1=1-based 行号
      if (!seenLines.has(line)) {
        seenLines.add(line);
        out.push({ line, message: 'Syntax error' });
      }
    }
  });
  return out.sort((a, b) => a.line - b.line);
}

/** C-13 §3 组件级接口：check(lang, code) → SyntaxError[]（零诊断=[]） */
export function check(lang: ScriptLang, code: string): SyntaxError[] {
  return lang === 'ts' ? checkTs(code) : checkPy(code);
}
