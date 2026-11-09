// CanvasRegistry / 运行态 statuses 注入面（T3-02；C-01 §2 imports↓ C-05 行＋区头 a 项；
// T4-04 接线：真实事件源=RunStatusBinding→runStore）。
//
// - CanvasRegistryContext：NodeCard 按 data.type 读 C-05 定义渲染——registry 由产品装配
//   （T1-10 装载序）经 Provider 注入；组件测试以 fake registry 驱动（不建 SQLite）。
//   null＝未装配（画布仍可渲染 fallback 卡）。
// - CanvasStatusContext：运行态五态订阅（02 §3.3 runStore 只读 statuses selector 形；
//   T4-04 起真实事件源经 RunStatusBinding 注入——未装配/未运行节点 undefined=idle 无徽标，
//   demo L1761 语义）。
import { createContext, useContext } from 'react';
import type { NodeRegistry } from '../node-registry';

/** 五态（C-01 §0：running/done/error/skipped/waiting；徽标 ⋯✓✗⊘⏸，demo L1761）。 */
export type NodeRunStatus = 'waiting' | 'running' | 'done' | 'error' | 'skipped';

export const CanvasRegistryContext = createContext<NodeRegistry | null>(null);

/** statuses 只读 selector 注入形（(nodeId) => status | undefined；undefined=idle 未运行不入 statuses，demo L1075）。 */
export const CanvasStatusContext = createContext<(nodeId: string) => NodeRunStatus | undefined>(() => undefined);

/** 流光动画开关（edgeAnim 门控——settingsStore 装配随 P6 C-11，区头 b 项：默认开）。 */
export const CanvasEdgeAnimContext = createContext<boolean>(true);

/** 20px 网格吸附开关（snap 门控——同上注入位，demo settings.snap 默认 true）。 */
export const CanvasSnapContext = createContext<boolean>(true);

export function useCanvasRegistry(): NodeRegistry | null {
  return useContext(CanvasRegistryContext);
}

/** 节点运行态（五态；undefined=idle 未运行不入 statuses——demo L1075/L1761） */
export function useNodeStatus(nodeId: string): NodeRunStatus | undefined {
  return useContext(CanvasStatusContext)(nodeId);
}

export function useEdgeAnim(): boolean {
  return useContext(CanvasEdgeAnimContext);
}

export function useSnap(): boolean {
  return useContext(CanvasSnapContext);
}
