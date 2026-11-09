// definition 表单半段导出面（C-02；T4-08 交付=ParamFormRenderer/ParamValidator/
// SecretParamBinder——§1 NodeDefinitionRuntime 接口随 T4-09 InnerExpander/IoContractKit 齐）。
export { validateParams, type ParamFieldError, type ParamRule } from './param-validator';
export {
  createSecretParamBinder,
  SECRET_MASK,
  type SecretBridge,
  type SecretParamBinder,
  type SecretParamBinderOptions,
} from './secret-param-binder';
export {
  registerParamControl,
  renderParamForm,
  type FormControlKind,
  type ParamFieldModel,
  type ParamFormGroup,
  type ParamFormModel,
  type ParamValues,
} from './param-form-model';
export { ParamForm, type ParamFormProps } from './ParamForm';
