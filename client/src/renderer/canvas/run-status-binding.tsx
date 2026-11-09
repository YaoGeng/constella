// RunStatusBinding —— runStore 只读订阅接线（T4-04；TDD-C-01 §2「C-03 runStore 只读
// statuses selector」＋02 §3.3；05 T3 波次区头 a 项「T4-04 接线」收口——接通后五态
// statuses 驱动画布）。
//   职责（02 §3.3 runStore 行的画布消费半段）：
//   ① runStore.lastRunOfFlow[activeFlowId].statuses → CanvasStatusContext（NodeCard 五态/
//     徽标/边流光；statuses 缺席=idle 无徽标，demo L1761/L1075 语义）；
//   ② runStore.activeRunOfFlow → flowStore.running 联动（运行中禁拖/禁 undo/redo 的数据源，
//     A-5.1——InteractionMachine/EditorKeyboard 消费该位，写入归本接线）。联动走 store 级
//     订阅（挂载即同步＋逐拍跟写，不依赖 React 渲染调度时序）。
//   真实事件源=RunEngine（onNodeStatus→runStore 同点镜像）；本组件只读订阅，P-3 方向不变。
import { useEffect, useMemo, type ReactNode } from 'react';
import { useRunStore, type RunStoreState } from '../run/run-store';
import { useFlowStore } from './stores/flow-store';
import { CanvasStatusContext } from './registry-context';

export function RunStatusBinding({ children }: { children: ReactNode }) {
  const activeFlowId = useFlowStore((s) => s.activeFlowId);
  const statuses = useRunStore((s) => (activeFlowId !== null ? s.lastRunOfFlow[activeFlowId]?.statuses : undefined));

  // 运行中位联动（active run 有无 → flowStore.running）：store 级订阅（挂载同步＋逐拍跟写）
  useEffect(() => {
    const sync = (s: RunStoreState) => {
      useFlowStore.getState().setRunning(Object.keys(s.activeRunOfFlow).length > 0);
    };
    sync(useRunStore.getState());
    return useRunStore.subscribe(sync);
  }, []);

  const statusOf = useMemo(() => (nodeId: string) => statuses?.[nodeId], [statuses]);
  return <CanvasStatusContext.Provider value={statusOf}>{children}</CanvasStatusContext.Provider>;
}
