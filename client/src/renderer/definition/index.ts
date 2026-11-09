// definition 半段导出面（C-02；T4-07 交付=校验器四组件——validateDefinition 八条单一来源）。
// T4-08（ParamFormRenderer/ParamValidator/SecretParamBinder，./form）与 T4-09（InnerExpander/
// IoContractKit＋两渲染件）已并入——§1 NodeDefinitionRuntime 接口齐备。
export { validateDefinition, PARAM_TYPE_WHITELIST } from './definition-validator';
export { checkNamespace } from './namespace-guard';
export { checkExec } from './exec-ref-checker';
export { checkSemver } from './version-field';
export type { DefRule, FieldError, ValidateContext, ValidationResult } from './types';
// T4-09：InnerExpander（N5——expand 执行数据件＋innerView 展示模型＋InnerStepList 渲染件）
export { expand, innerView } from './inner-expander';
export type { ExpandedInnerStep, InnerStepView } from './inner-expander';
export { InnerStepList } from './InnerStepList';
export type { InnerStepListProps } from './InnerStepList';
// T4-09：IoContractKit（N7——ioView/checkIoCompat＋IoContractView 渲染件）
export { checkIoCompat, ioView, IO_INPUT_FALLBACK_TEXT } from './io-contract-kit';
export type { IoExitColumn, IoInputView, IoIssue, IoView } from './io-contract-kit';
export { IoContractView } from './IoContractView';
export type { IoContractViewProps } from './IoContractView';
export * from './form';
