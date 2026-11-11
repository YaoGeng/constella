// EditorShell —— 六环节 stepper 编排（T6-06；TDD-C-13 §3 EditorShell 行「六环节 stepper 编排
// ＋环节间校验门＋草稿路由（create/edit）」，组件级接口 openNodeEditor(seed)——入口函数在
// ./definition-draft，本组件为宿主渲染面：open=false 渲染 null）。
//
//   编排：环节导航（回退自由/前进受门）/当前环节表单（环节 1=StepMeta、2=StepPorts、
// 3=StepSchema〔T6-07〕、4=StepScript＋StepConfig 两页子 tab〔T6-08——01 §5.3 PATH1 环节
// 4/5 两页合一环节〕、5~6=StepPlaceholder 随 T6-09 替换）/实时校验回显
// （computeStepErrors——validateDefinition 单一来源投影＋环节 4 语法门，错误定位到环节+字段）/
// 上一步-下一步（未过门 next 禁用并标 data-gate-blocked）。
//   预览：环节 1/2 右侧 NodeCardPreview（§3 复用处）——端口布局/✨/参数预览实时反映；
// 环节 3 右侧 ParamFormPreview（§3 复用处=StepSchema——C-02 ParamFormRenderer 同源渲染，X-8）。
//   dirty 位：未保存标「未保存」（草稿内存态——未保存不落盘，保存动作随 T6-09 StepSave）。
import { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import type { EditorStepKey } from './definition-draft';
import {
  EDITOR_STEPS,
  STEP_LABELS,
  computeStepErrors,
  isDirty,
  useDefinitionDraftStore,
} from './definition-draft';
import { NodeCardPreview } from './node-card-preview';
import { ParamFormPreview } from './param-form-preview';
import { StepConfig } from './step-config';
import { StepMeta } from './step-meta';
import { StepPlaceholder } from './step-placeholder';
import { StepPorts } from './step-ports';
import { StepSchema } from './step-schema';
import { StepScript } from './step-script';

const STEP_INDEX: Record<EditorStepKey, number> = {
  meta: 0,
  ports: 1,
  schema: 2,
  script: 3,
  inner: 4,
  save: 5,
};

/** 前进可达判定（与 store.goToStep 同语义——导航按钮禁用态用；判定本体单一来源在 store） */
function reachable(from: EditorStepKey, to: EditorStepKey, errors: ReturnType<typeof computeStepErrors>): boolean {
  if (STEP_INDEX[to] <= STEP_INDEX[from]) return true;
  for (let i = STEP_INDEX[from]; i < STEP_INDEX[to]; i++) {
    const key = EDITOR_STEPS[i];
    if (key !== undefined && (errors[key]?.length ?? 0) > 0) return false;
  }
  return true;
}

export function EditorShell() {
  const open = useDefinitionDraftStore((s) => s.open);
  const mode = useDefinitionDraftStore((s) => s.mode);
  const step = useDefinitionDraftStore((s) => s.step);
  const draft = useDefinitionDraftStore((s) => s.draft);
  const script = useDefinitionDraftStore((s) => s.script);
  const seedError = useDefinitionDraftStore((s) => s.seedError);
  const deps = useDefinitionDraftStore((s) => s.deps);
  const dirty = useDefinitionDraftStore(isDirty);
  const { goToStep, nextStep, prevStep, patchMeta, setType, setPorts, setParamsSchema, setPolicy, setIo, patchScript, closeEditor } =
    useDefinitionDraftStore.getState();
  /** 环节 4 两页子 tab（01 §5.3 PATH1 环节 4/5=脚本/config 两页合一环节——UI 临时态不入 store） */
  const [scriptPage, setScriptPage] = useState<'script' | 'config'>('script');

  const errors = useMemo(
    () => computeStepErrors(draft, deps ?? undefined, mode === 'edit' ? draft.type : undefined, script),
    [draft, deps, mode, script],
  );

  if (!open) return null;

  const currentErrors = errors[step] ?? [];
  const gateBlocked = currentErrors.length > 0;
  const isLast = step === 'save';

  return (
    <div
      data-testid="node-editor-shell"
      data-mode={mode}
      data-step={step}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[88vh] w-[760px] flex-col gap-3 rounded-xl border border-[var(--line-2)] bg-[var(--glass)] p-4 shadow-2xl">
        {/* 头：路由标题＋type＋dirty 位＋关闭 */}
        <div className="flex items-center gap-2">
          <b className="text-[13px] text-[var(--tx)]">
            {mode === 'create' ? '✨ 自定义节点 · 手动定义' : `✨ 自定义节点 · 再编辑`}
          </b>
          <span className="font-mono text-[11px] text-[var(--tx-3)]">{draft.type || '（未定类型）'}</span>
          {dirty && (
            <span data-testid="ne-dirty" className="rounded-full border border-[var(--amber)] px-2 py-0.5 text-[10px] text-[var(--amber)]">
              未保存
            </span>
          )}
          <button
            type="button"
            data-testid="ne-close"
            aria-label="关闭编辑器"
            onClick={closeEditor}
            className="ml-auto rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        {seedError !== null ? (
          // edit 载入失败面（miss/builtin 拒）——不静默降级 create
          <div
            data-testid="node-editor-seed-error"
            className="rounded-md border border-[var(--red-line)] bg-[var(--red-tint)] px-3 py-2 text-[12px] text-[var(--red)]"
          >
            {seedError}
          </div>
        ) : (
          <>
            {/* 六环节 stepper 导航（回退自由；前进受门——禁用态同 store 判定） */}
            <nav className="flex items-center gap-1" data-step-nav-bar>
              {EDITOR_STEPS.map((key) => {
                const active = key === step;
                const ok = reachable(step, key, errors);
                return (
                  <button
                    key={key}
                    type="button"
                    data-step-nav={key}
                    disabled={!ok}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => goToStep(key)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11px]',
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-hi)]'
                        : 'border-[var(--line-2)] text-[var(--tx-2)] hover:border-[var(--accent)]',
                      !ok && 'cursor-not-allowed opacity-40 hover:border-[var(--line-2)]',
                    )}
                  >
                    {STEP_LABELS[key]}
                    {(errors[key]?.length ?? 0) > 0 && <span className="ml-1 text-[var(--red)]">!</span>}
                  </button>
                );
              })}
            </nav>

            {/* 当前环节表单＋预览（环节 1/2 挂 NodeCardPreview——§3 复用处） */}
            <div className="flex min-h-[240px] gap-4 overflow-y-auto">
              <div className="min-w-0 flex-1">
                {step === 'meta' && (
                  <StepMeta
                    type={draft.type}
                    meta={draft.meta}
                    typeEditable={mode === 'create'}
                    errors={errors.meta ?? []}
                    onTypeChange={setType}
                    onMetaChange={patchMeta}
                  />
                )}
                {step === 'ports' && (
                  <StepPorts ports={draft.ports} errors={errors.ports ?? []} onChange={setPorts} />
                )}
                {step === 'schema' && (
                  <StepSchema
                    paramsSchema={draft.paramsSchema}
                    policy={draft.policy ?? null}
                    io={draft.io ?? null}
                    exitIds={draft.ports.outs.map((o) => o.id)}
                    errors={errors.schema ?? []}
                    onSchemaChange={setParamsSchema}
                    onPolicyChange={setPolicy}
                    onIoChange={setIo}
                  />
                )}
                {step === 'script' && (
                  <div className="flex flex-col gap-2">
                    {/* 环节 4 两页子 tab（脚本/config——PATH1 环节 4/5 合一） */}
                    <div className="flex items-center gap-1">
                      {(['script', 'config'] as const).map((page) => (
                        <button
                          key={page}
                          type="button"
                          data-script-page-tab={page}
                          aria-pressed={scriptPage === page}
                          onClick={() => setScriptPage(page)}
                          className={cn(
                            'rounded-md border px-2.5 py-1 text-[11px]',
                            scriptPage === page
                              ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-hi)]'
                              : 'border-[var(--line-2)] text-[var(--tx-2)] hover:border-[var(--accent)]',
                          )}
                        >
                          {page === 'script' ? '脚本' : '配置'}
                        </button>
                      ))}
                    </div>
                    {scriptPage === 'script' ? (
                      <StepScript
                        script={script}
                        paramsSchema={draft.paramsSchema}
                        errors={errors.script ?? []}
                        onScriptChange={patchScript}
                      />
                    ) : (
                      <StepConfig
                        type={draft.type}
                        configYaml={script.configYaml}
                        paramsSchema={draft.paramsSchema}
                        onConfigChange={(yaml) => patchScript({ configYaml: yaml })}
                      />
                    )}
                  </div>
                )}
                {(step === 'inner' || step === 'save') && (
                  <StepPlaceholder step={step} />
                )}
              </div>
              {(step === 'meta' || step === 'ports') && (
                <div className="flex w-[220px] shrink-0 flex-col items-center gap-2 pt-2">
                  <NodeCardPreview def={draft} />
                  <span className="text-[10px] text-[var(--tx-3)]">卡片预览（实时反映）</span>
                </div>
              )}
              {step === 'schema' && (
                <div className="flex w-[264px] shrink-0 flex-col gap-2 pt-2">
                  <span className="text-[10px] text-[var(--tx-3)]">表单预览（=未来抽屉表单渲染结果，X-8）</span>
                  <div className="max-h-[54vh] overflow-y-auto pr-1">
                    <ParamFormPreview schema={draft.paramsSchema} />
                  </div>
                </div>
              )}
            </div>

            {/* 当前环节错误回显（定位到环节+字段——SaveReport stepErrors 语义先行局部态） */}
            {gateBlocked && (
              <ul data-step-errors className="flex flex-col gap-1">
                {currentErrors.map((e, i) => (
                  <li
                    key={i}
                    data-step-error
                    data-error-field={e.field}
                    data-error-rule={e.rule}
                    className="text-[11px] text-[var(--red)]"
                  >
                    {e.field}：{e.message}
                  </li>
                ))}
              </ul>
            )}

            {/* 上一步/下一步（未过门不得前进——next 禁用＋门标） */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="ne-prev"
                disabled={step === 'meta'}
                onClick={prevStep}
                className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-[12px] text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                上一步
              </button>
              <button
                type="button"
                data-testid="ne-next"
                disabled={isLast || gateBlocked}
                data-gate-blocked={gateBlocked ? step : undefined}
                title={isLast ? '保存链随 T6-09 StepSave 落位' : gateBlocked ? '本环节校验未过——不得前进' : undefined}
                onClick={nextStep}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-on-accent)] disabled:opacity-50"
              >
                下一步
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
