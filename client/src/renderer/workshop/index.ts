// workshop 半段导出面（TDD-C-07 §3；T5-01 起——LlmGateway 先行；T5-02＝IntentRouter/
// FlowPlanner/workshopStore；六环节其余组件随 T5-03+ 进入）。
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

// T5-02：意图识别（§3 IntentRouter 行；02 §9.2 五意图＋兜底链）
export { createIntentRouter, guessIntent } from './intent-router';
export type {
  Intent,
  IntentClassification,
  IntentKind,
  IntentRouter,
  IntentRouterDeps,
  IntentSource,
  RouteContext,
} from './intent-router';

// T5-02：三来源降级＋计划卡（§3 FlowPlanner 行；02 §9.1；§4 PlanCard 形）
export { createFlowPlanner, FlowPlannerError } from './flow-planner';
export type {
  DraftStepSource,
  FlowPlanner,
  FlowPlannerDeps,
  FlowPlannerErrorCode,
  LibLister,
  PlanCard,
  PlanDraft,
  PlanDraftStep,
  PlanStep,
  PlanStepSource,
  PlazaNodeHit,
  PlazaQuery,
  PlazaTransportFailureKind,
} from './flow-planner';

// T5-02：双工坊会话态（02 §3.3 workshopStore——不持久化）＋转交流程工坊（01 A-10.2）
export { FLOW_HANDOFF_MESSAGE, handoffToFlowWorkshop, useWorkshopStore } from './workshop-store';
export type {
  FlowHandoffDeps,
  RailActivity,
  RailState,
  RailTab,
  WorkshopCard,
  WorkshopMessage,
  WorkshopStoreState,
} from './workshop-store';
