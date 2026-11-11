// StepScript —— 环节 4 脚本页（T6-08；TDD-C-13 §3 StepScript 行「py|ts 切换、契约模板注入、
// 语法校验保存门＋错误行定位」＋§8②「脚本编辑区=等宽纯文本（X-8 V1）→CodeMirror 6（P2
// 扩展位）」；01 §5.3 PATH1 环节 4 之脚本页）。
//
//   lang 切换语义（冻结）：py/ts 双文本各自存续于草稿（draft.script.py/ts）——切换零拷贝
// 零丢失（=任务卡「切换保留各自文本」语义；不采纳「切换按字典序清空」备选）。UI 标签 py|ts、
// store 值域 'python'|'ts'（对齐 DSL ExecSpec.lang，见 definition-draft 头注）。
//   语法校验=实时（编辑即经 computeStepErrors→SyntaxChecker 投影，门拦沿 EditorShell 既有
// goToStep 门形）；错误列表逐条「L<行号> <message>」（message 投影形即 L 前缀——行定位直显）。
//   注入=以契约模板替换当前语言脚本文本（demo bundleCode 全文生成语义；N3 默认值块随
// paramsSchema 实时值）。config 页（两页合一环节之另一页）=./step-config。
import type { ParamField } from '@constella/shared/dsl';
import { inject } from './contract-injector';
import type { ScriptDraft, StepFieldError } from './definition-draft';

export interface StepScriptProps {
  /** 环节 4 脚本草稿（draft.script 直读——lang/py/ts） */
  script: ScriptDraft;
  /** N3 参数 schema（PARAMS 默认值块源——注入时取实时值） */
  paramsSchema: readonly ParamField[];
  /** script 环节门错误（computeStepErrors 投影——N4-syntax 语法错误行定位面） */
  errors: readonly StepFieldError[];
  onScriptChange(patch: Partial<ScriptDraft>): void;
}

const BTN_CLS = 'rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-40';

const ACTIVE_CLS = 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-hi)]';

export function StepScript({ script, paramsSchema, errors, onScriptChange }: StepScriptProps) {
  const code = script.lang === 'python' ? script.py : script.ts;
  const syntaxErrors = errors.filter((e) => e.rule === 'N4-syntax'); // 语法门错误（N4-exec 形错不属本页面）

  /** lang 切换钮（py|ts 标签；值='python'|'ts'——DSL 值域） */
  const langBtn = (lang: 'python' | 'ts', label: string) => (
    <button
      type="button"
      data-script-lang={lang}
      aria-pressed={script.lang === lang}
      onClick={() => onScriptChange({ lang })}
      className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${
        script.lang === lang ? ACTIVE_CLS : 'border-[var(--line-2)] text-[var(--tx-2)] hover:border-[var(--accent)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div data-step-form="script" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {langBtn('python', 'py')}
        {langBtn('ts', 'ts')}
        <button
          type="button"
          data-script-inject
          title="以契约模板替换当前语言脚本（PARAMS 默认值块取 N3 实时值——demo bundleCode 同构）"
          onClick={() => onScriptChange({ [script.lang === 'python' ? 'py' : 'ts']: inject(script.lang, paramsSchema) })}
          className={`ml-auto ${BTN_CLS}`}
        >
          注入契约模板
        </button>
      </div>

      {/* 等宽纯文本编辑器（X-8 V1——语法高亮=CodeMirror P2 扩展位，03 C-13 §8②） */}
      <textarea
        data-script-editor
        value={code}
        onChange={(e) => onScriptChange({ [script.lang === 'python' ? 'py' : 'ts']: e.target.value })}
        spellCheck={false}
        rows={12}
        placeholder={
          script.lang === 'python'
            ? '# python 脚本（async def run(ctx)…）——可「注入契约模板」起步'
            : '// typescript 脚本（export async function run(ctx)…）——可「注入契约模板」起步'
        }
        className="w-full resize-y rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 font-mono text-[12px] leading-relaxed text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none"
      />

      {/* 语法错误列表（§6.1d 行定位——message 投影形「L<行号> <message>」逐条直显） */}
      {syntaxErrors.length > 0 && (
        <ul data-script-errors className="flex flex-col gap-1">
          <li className="text-[11px] font-medium text-[var(--red)]">
            语法校验未过——保存门拦截（修正后可前进/保存）：
          </li>
          {syntaxErrors.map((e, i) => (
            <li key={i} data-script-error data-error-rule={e.rule} className="font-mono text-[11px] text-[var(--red)]">
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
