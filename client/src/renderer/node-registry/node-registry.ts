// createNodeRegistry —— C-05 §1 十方法装配面（T1-09/T1-10/T1-11 组合根）。
//
// 组件组合：RegistryCore（Map＋broken）× CategoryIndex（类目倒排）× RegistryEvents（变更通知）
// × DefinitionLoader（02 §8.2 启动装载序）× PermDeriver（01 A-13.1）× EstimationTable（demo DUR 同源）。
// imports 仅 X-01 纯类型与常量（§2）——store/校验器全部注入，无同层 import（P-3）。
import { CategoryIndex } from './category-index';
import { DefinitionLoader } from './definition-loader';
import { estimateMs } from './estimation-table';
import { PermDeriver } from './perm-deriver';
import { RegistryCore } from './registry-core';
import { RegistryEvents } from './registry-events';
import type { NodeRegistry } from './types';

export function createNodeRegistry(): NodeRegistry {
  const events = new RegistryEvents();
  const core = new RegistryCore(events);
  const categories = new CategoryIndex();
  const loader = new DefinitionLoader(core);
  const deriver = new PermDeriver(core);

  return {
    get: (type) => core.get(type),
    register: (doc) => core.register(doc),
    has: (type) => core.has(type),
    list: () => core.list(),
    listByCategory: () => categories.listByCategory(core.list()),
    isBroken: (type) => core.isBroken(type),
    isBuiltin: (type) => core.isBuiltin(type),
    derivePerms: (types) => deriver.derivePerms(types),
    estimateMs,
    loadAll: (store, validate) => loader.loadAll(store, validate),
    onChange: (fn) => events.onChange(fn),
  };
}
