// node-registry 半段导出面（C-05；L1 数据地基层——P1 波 T1-09~T1-11）。
export { RegistryCore } from './registry-core';
export { CategoryIndex } from './category-index';
export { RegistryEvents } from './registry-events';
export type { RegistryChangeListener } from './registry-events';
export { DefinitionLoader } from './definition-loader';
export { PermDeriver } from './perm-deriver';
export { estimateMs, ESTIMATION_TABLE_MS, DEFAULT_ESTIMATION_MS } from './estimation-table';
export { createNodeRegistry } from './node-registry';
export type {
  DefinitionValidator,
  FieldError,
  LoadReport,
  NodeDefinitionStore,
  NodeRegistry,
  ValidationResult,
} from './types';
