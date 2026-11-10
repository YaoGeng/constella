// node-editor 半段导出面（C-13；T6-06 交付=骨架四组件＋草稿 store——EditorShell/DefinitionDraft/
// StepMeta/StepPorts/NodeCardPreview；T6-07 交付=环节 3——StepSchema/ParamFormPreview；
// 环节 4~6 实体随 T6-08/09 进入）。
//   消费方向（03 §2 ↑被依赖）：DrawerShell「✨自定义·手动定义」分支（C-01 编排接入——
// openNodeEditor＋EditorShell 宿主）；节点库「＋节点」入口（应用壳 T6-17）。
//   P-3：本模块禁止 import canvas/workshop/sky/run（§6.4 grep 验收）；被 C-01 drawer 调用=合法方向。
export { EditorShell } from './editor-shell';
export {
  EDITOR_STEPS,
  STEP_LABELS,
  computeStepErrors,
  isDirty,
  openNodeEditor,
  useDefinitionDraftStore,
} from './definition-draft';
export type {
  DefinitionDraftState,
  EditorEntryDeps,
  EditorSeed,
  EditorStepKey,
  StepErrorRule,
  StepErrors,
  StepFieldError,
} from './definition-draft';
export { NodeCardPreview } from './node-card-preview';
export type { NodeCardPreviewProps } from './node-card-preview';
export { ParamFormPreview } from './param-form-preview';
export type { ParamFormPreviewProps } from './param-form-preview';
export { StepMeta } from './step-meta';
export type { StepMetaProps } from './step-meta';
export { StepPorts } from './step-ports';
export type { StepPortsProps } from './step-ports';
export { StepSchema } from './step-schema';
export type { StepSchemaProps } from './step-schema';
export { StepPlaceholder } from './step-placeholder';
export type { StepPlaceholderProps } from './step-placeholder';
