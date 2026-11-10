// workshop 半段导出面（TDD-C-07 §3；T5-01 起——LlmGateway 先行，六环节其余组件随 T5-02+ 进入）。
export {
  createFetchSseTransport,
  createLlmGateway,
  LLM_DEFAULT_RETRIES,
  LLM_DEFAULT_TIMEOUT_MS,
  LlmGatewayError,
  redactLlmSecrets,
} from './llm-gateway';
export type {
  LlmChatMessage,
  LlmChatRequest,
  LlmChunkListener,
  LlmErrorCode,
  LlmGateway,
  LlmGatewayDeps,
  LlmJsonOptions,
  LlmProfile,
  LlmProfileProvider,
  LlmProfileTrace,
  LlmSecretReader,
  LlmSseStream,
  LlmTransport,
  LlmTransportRequest,
} from './llm-gateway';
