// StepSave —— 环节 6 入库保存表单（T6-09；TDD-C-13 §1「StepSave（N8 version/packageVersion
// ＋完整性校验汇总＋source='manual'＋保存）」＋§3 StepSave 行；01 §5.3 PATH1 环节 6）。
//
//   N8 双 semver（version=节点语义版本／packageVersion=zip 包版本——D-11 ⚠ 注）；完整性校验
// 汇总=六环节门错误汇总（computeStepErrors 全投影按环节分组——错误行可跳转定位环节）；
// source='manual' 语义位展示（02 §8.2 upsert 四入口之手动编辑器——写入归 DefinitionDraft/
// SavePipeline，UI 只读）；保存按钮触发注入的 SavePipeline（assets 经 assetsFromScriptDraft
// 适配——M5 只打包当前 lang；成功→markSaved 复位 dirty；被拒→stepErrors 汇总定位；异常→
// 错误面）。保存链实例经入口 deps 注入（P-3——生产接线随 T6-16 应用壳）。
import type { EditorStepKey, StepErrors } from './definition-draft';
import { EDITOR_STEPS, STEP_LABELS } from './definition-draft';

export interface StepSaveProps {
  version: string;
  packageVersion: string;
  /** 六环节门错误全投影（完整性校验汇总数据源——computeStepErrors 直传） */
  errors: StepErrors;
  /** 保存链装配位（false=未注入——生产接线随 T6-16；钮 disabled＋说明） */
  canSave: boolean;
  saving: boolean;
  /** 保存被拒面（SaveReport ok=false——stepErrors 已在 errors 汇总反映，此处提示语义） */
  rejected: boolean;
  /** 保存链异常 message（上抛面——null=无） */
  saveError: string | null;
  /** 保存成功提示在场（ok=true 后） */
  saved: boolean;
  onVersionChange(version: string): void;
  onPackageVersionChange(packageVersion: string): void;
  onSave(): void;
  /** 汇总行跳转（错误定位环节） */
  onGoStep(step: EditorStepKey): void;
}

const INPUT_CLS =
  'w-full rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 font-mono text-[12px] text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none';

export function StepSave({
  version,
  packageVersion,
  errors,
  canSave,
  saving,
  rejected,
  saveError,
  saved,
  onVersionChange,
  onPackageVersionChange,
  onSave,
  onGoStep,
}: StepSaveProps) {
  const hasErrors = Object.values(errors).some((list) => (list?.length ?? 0) > 0);
  const saveDisabled = !canSave || saving || hasErrors;

  return (
    <div data-step-form="save" className="flex flex-col gap-3">
      {/* N8 双 semver（version=节点语义版本／packageVersion=zip 包版本——D-11） */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          版本 version（节点 semver）
          <input
            data-save-field="version"
            value={version}
            placeholder="1.0.0"
            onChange={(e) => onVersionChange(e.target.value)}
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          包版本 packageVersion（zip 包 semver）
          <input
            data-save-field="packageVersion"
            value={packageVersion}
            placeholder="1.0.0"
            onChange={(e) => onPackageVersionChange(e.target.value)}
            className={INPUT_CLS}
          />
        </label>
      </div>

      {/* source 语义位（02 §8.2 upsert 四入口之手动编辑器——只读展示，写入归保存链） */}
      <div
        data-save-source="manual"
        className="rounded-md border border-[var(--line-2)] bg-[rgba(160,200,255,0.03)] px-3 py-1.5 text-[11px] text-[var(--tx-2)]"
      >
        入库来源 source=manual（手动编辑器——02 §8.2 upsert 四入口之一；保存链写入 N1 定义元信息）
      </div>

      {/* 完整性校验汇总（六环节门错误汇总——✓/!＋计数＋跳转定位） */}
      <div data-save-summary className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--tx-2)]">完整性校验汇总（六环节）</span>
        {EDITOR_STEPS.map((key) => {
          const list = errors[key] ?? [];
          const ok = list.length === 0;
          return (
            <button
              key={key}
              type="button"
              data-save-summary-step={key}
              data-ok={ok}
              data-save-goto={key}
              onClick={() => onGoStep(key)}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-left text-[11px] ${
                ok
                  ? 'border-[var(--line-2)] text-[var(--tx-3)] hover:border-[var(--accent)]'
                  : 'border-[var(--red-line)] bg-[var(--red-tint)] text-[var(--red)]'
              }`}
            >
              <span>{ok ? '✓' : '!'}</span>
              <span>{STEP_LABELS[key]}</span>
              {!ok && <span data-save-summary-count>{list.length} 项待修正</span>}
              {!ok && (
                <span data-save-summary-goto className="ml-auto underline underline-offset-2">
                  去修正
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 保存结果面 */}
      {saved && (
        <div data-save-ok className="rounded-md border border-[var(--accent)] bg-[var(--accent-tint)] px-3 py-1.5 text-[11px] text-[var(--accent-hi)]">
          已入库（注册表/定义持久化/节点库/资产包同链落盘——同名同型覆盖，A-11.1）
        </div>
      )}
      {rejected && !saved && (
        <div data-save-rejected className="rounded-md border border-[var(--red-line)] bg-[var(--red-tint)] px-3 py-1.5 text-[11px] text-[var(--red)]">
          保存被拒——校验未过（见上方汇总「!」环节，点「去修正」定位）
        </div>
      )}
      {saveError !== null && (
        <div data-save-error className="rounded-md border border-[var(--red-line)] bg-[var(--red-tint)] px-3 py-1.5 text-[11px] text-[var(--red)]">
          保存失败：{saveError}
        </div>
      )}

      <button
        type="button"
        data-testid="ne-save"
        disabled={saveDisabled}
        data-save-unwired={!canSave ? true : undefined}
        title={
          !canSave
            ? '保存链未装配（应用壳接线随 T6-16）'
            : hasErrors
              ? '校验未过——先修正汇总「!」环节'
              : saving
                ? '保存中…'
                : undefined
        }
        onClick={onSave}
        className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-[var(--ink-on-accent)] disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存入库'}
      </button>
    </div>
  );
}
