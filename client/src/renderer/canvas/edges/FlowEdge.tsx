// FlowEdge —— 双层 path 流光自定义边（T3-03；C-01 §3 FlowEdge 行；demo L1405-1431/L1769-1776
// 行号溯源的 xyflow 语义等价移植）。
//
// 双层：透明加粗 hit 层（点击易命中——编辑态点击删除）＋可见层（流光动画挂它）。
// 多出口贝塞尔＝xyflow getBezierPath 内建（节点拖动仅重渲染相邻边=xyflow 局部重算语义）。
// 流光：入边目标节点 running → stroke-dashoffset 动画（edgeAnim 门控注入，默认开）。
// 删除编辑闸：canvasStore.editMode 且非 running 才删；违例 toast 提示（demo 文案逐字）。
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '../canvas-store';
import { useFlowStore } from '../stores/flow-store';
import { useCanvasToast } from '../toast';
import { useEdgeAnim, useNodeStatus } from '../registry-context';

export const EDGE_DELETE_HINT = '编辑模式下点击连线可删除';
export const EDGE_DELETED = '连线已删除';

export function FlowEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const toast = useCanvasToast();
  const edgeAnim = useEdgeAnim();
  const targetStatus = useNodeStatus(target);

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const flowing = edgeAnim && targetStatus === 'running';
  const skipped = targetStatus === 'skipped';

  const onClick = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    const { editMode } = useCanvasStore.getState();
    const { running, edges } = useFlowStore.getState();
    if (running || !editMode) {
      toast(EDGE_DELETE_HINT);
      return;
    }
    // 单历史项（zundo 捕捉 edges 变更）＋脏标记
    useFlowStore.getState().setEdges(edges.filter((e) => e.id !== id));
    toast(EDGE_DELETED);
  };

  return (
    <>
      {/* hit 层：透明加粗，指针命中（title 提示同 demo） */}
      <BaseEdge
        id={`${id}-hit`}
        path={path}
        className="cn-edge cn-edge--hit"
        interactionWidth={0}
        onClick={onClick}
      />
      {/* 可见层：流光/跳过态样式挂载点 */}
      <BaseEdge
        id={`${id}-vis`}
        path={path}
        className={flowing ? 'cn-edge cn-edge--vis cn-edge--flowing' : skipped ? 'cn-edge cn-edge--vis cn-edge--skipped' : 'cn-edge cn-edge--vis'}
        interactionWidth={0}
      />
    </>
  );
}
