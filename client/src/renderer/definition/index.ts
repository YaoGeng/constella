// definition 半段导出面（C-02；T4-07 交付=校验器四组件——validateDefinition 八条单一来源）。
// T4-08（ParamFormRenderer/ParamValidator/SecretParamBinder）、T4-09（InnerExpander/IoContractKit）
// 届时并入本面；§1 NodeDefinitionRuntime 完整接口随两卡齐备。
export { validateDefinition, PARAM_TYPE_WHITELIST } from './definition-validator';
export { checkNamespace } from './namespace-guard';
export { checkExec } from './exec-ref-checker';
export { checkSemver } from './version-field';
export type { DefRule, FieldError, ValidateContext, ValidationResult } from './types';
