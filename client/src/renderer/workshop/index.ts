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

// T5-04：计划校验六查（§3 PlanValidator 行＋§1 六环节 4 段；02 §9.1 冻结序权威）
export {
  createPlanValidator,
  DEFAULT_PLAN_EXIT,
  DEFAULT_PLAN_PORT,
  resolvePlanEdges,
} from './plan-validator';
export type {
  PlanCheckId,
  PlanIssue,
  PlanValidator,
  PlanValidatorDeps,
} from './plan-validator';

// T5-04：确认闸卡片状态机（§3 ConfirmGate 行＋§1 六环节 5 段；01 A-10.2 冻结）
export { ConfirmGateError, createConfirmGate } from './confirm-gate';
export type {
  ConfirmCard,
  ConfirmCardKind,
  ConfirmGate,
  ConfirmGateDeps,
  ConfirmGateErrorCode,
  ConfirmOutcome,
  ConfirmStatus,
  DiffCard,
  DiffFieldChange,
  StagedCard,
} from './confirm-gate';

// T5-04：「一键生成」确认后编排（§3 FlowMaterializer 行＋§1 六环节 6 段；01 A-10.3）
export { createFlowMaterializer, WORKSHOP_FLOW_LABEL } from './flow-materializer';
export type {
  DefinitionLookup,
  FlowMaterializer,
  FlowMaterializerDeps,
  MaterializeFailureCode,
  MaterializeResult,
  PlanLayoutFn,
} from './flow-materializer';

// T5-03：store 档组装器（03 L1101 v1.0e 对齐注——零三方 zip 库依赖；demo buildZip L2502-2517 同构）
export { assembleNodePackage, buildStoreZip, DRAFT_ZIP_EPOCH } from './draft-zip-builder';
export type {
  AssembledNodePackage,
  DraftZipFile,
  NodePackageFileEntry,
  NodePackageParts,
  NodePackageScript,
} from './draft-zip-builder';

// T5-03：现场开发（§3 NodeDevAgent 行＋§1 六环节 3 段——N1~N8＋scripts＋config＋deps→zip→
// importArchiveBytes「开发即沉淀」；adoptDraft=确认后「加入画布」；B-5 试跑=adopted 资产直调）
export { createNodeDevAgent, NodeDevAgentError } from './node-dev-agent';
export type {
  AdoptDraftResult,
  DevelopSpec,
  DraftDefinitionValidator,
  DraftImportFace,
  NodeDevAgent,
  NodeDevAgentDeps,
  NodeDevAgentErrorCode,
  NodeDraft,
  NodeTrialMeta,
  TrialRunHandle,
  TrialRunOpts,
} from './node-dev-agent';

// T5-05：断点交互卡（§3 HitCardView 行——C-03 推送宿主；T5-11 评审转交 barrel 补全，清单按 T5-05 报告）
export { HitCardView, resolveHitCard, HIT_MERGE_CANONICAL_KEYS } from './hit-card-view';
export type {
  HitCardData,
  HitCardViewProps,
  HitResolveAction,
  HitResolveOutcome,
  HitResolver,
  HitResolverDeps,
  HitResumeDecision,
} from './hit-card-view';
