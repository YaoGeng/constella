// NodeCard —— 192px 玻璃卡片（T3-02；C-01 §3 NodeCard/PortGroup 行；demo L1354-1387/L1761
// 行号溯源的 xyflow 语义等价移植；T4-04 接线 idle 态适配）。
//
// 按 data.type 读 C-05 定义渲染（registry 经 CanvasRegistryContext 注入——不逐 type 注册组件）：
// 图标/名称/状态徽标（五态 ⋯✓✗⊘⏸；idle=未运行不入 statuses——无徽标无状态 class，demo
// L1761 idle 语义）/「类目·类型」行（✨=custom 尾标）/参数预览首参
// 「key: value」26 字截断（value 截断，demo L1354-1358）/broken ⚠（isBroken，02 §8.2）。
// PortGroup 内嵌：按 N2 outs 动态多 Handle（出口沿卡片高度等分＋文字标签，仅多出口）；
// ins=[] 触发节点无入口 Handle（A-3.2）。
import { Handle, Position } from '@xyflow/react';
import { Fragment } from 'react';
import { cn } from '../../lib/utils';
import type { CanvasNodeData } from '../node-types';
import { useCanvasRegistry, useNodeStatus, type NodeRunStatus } from '../registry-context';

/** 状态徽标映射（demo L1761：done ✓/error ✗/skipped ⊘/waiting ⏸/running ⋯）。 */
export const STATUS_BADGE: Record<NodeRunStatus, string> = {
  waiting: '⏸',
  running: '⋯',
  done: '✓',
  error: '✗',
  skipped: '⊘',
};

/** 组件 props 最小面（xyflow NodeProps 的子集——注册面按逆变兼容直挂 nodeTypes）。 */
export interface NodeCardProps {
  id: string;
  data: CanvasNodeData;
  selected?: boolean;
}

/** 未注册/未装配 fallback（demo renderNodes def 缺省同源）。 */
const FALLBACK_DEF = {
  meta: { name: '', icon: '❓', category: '?' },
  ports: { ins: ['in'], outs: [{ id: 'out', label: 'out' }] },
  custom: false,
} as const;

export function NodeCard({ id, data, selected }: NodeCardProps) {
  const d = data as CanvasNodeData;
  const registry = useCanvasRegistry();
  const status = useNodeStatus(id);
  const def = registry?.get(d.type);
  const broken = registry?.isBroken(d.type) ?? false;
  const custom = def ? !registry?.isBuiltin(d.type) : false;

  const meta = def?.meta ?? { ...FALLBACK_DEF.meta, name: d.name ?? d.type };
  const ports = def?.ports ?? FALLBACK_DEF.ports;
  const outs = ports.outs.length > 0 ? ports.outs : [{ id: 'out', label: 'out' }];

  // 参数预览首参：按 paramsSchema 顺序取首个实例有值参数，value 截 26 字（demo L1354-1358）
  let preview = '';
  if (def) {
    const field = def.paramsSchema.find((p) => {
      const v = d.params?.[p.k];
      return v !== undefined && v !== null && String(v) !== '';
    });
    if (field) preview = `${field.k}: ${String(d.params?.[field.k]).slice(0, 26)}`;
  }

  return (
    <div
      className={cn(
        'cn-node',
        status !== undefined && `cn-node--${status}`,
        selected && 'cn-node--selected',
        broken && 'cn-node--broken',
      )}
      data-node-type={d.type}
      data-status={status ?? 'idle'}
      data-broken={broken || undefined}
    >
      <div className="cn-node__head">
        <span className="cn-node__icon">{meta.icon}</span>
        <span className="cn-node__name">{d.name ?? meta.name}</span>
        {status !== undefined && <span className={cn('cn-node__badge', `cn-node__badge--${status}`)}>{STATUS_BADGE[status]}</span>}
      </div>
      <div className="cn-node__type">
        {meta.category} · {d.type}
        {custom ? ' · ✨' : ''}
        {broken ? ' ⚠' : ''}
      </div>
      <div className="cn-node__params">{preview}</div>

      {/* 入口 Handle：ins=[] 触发节点无入口（A-3.2）；多入口按 id 区分 */}
      {ports.ins.map((p) => (
        <Handle key={`in-${p}`} className="cn-port--in" type="target" position={Position.Left} id={p} style={{ top: '50%' }} />
      ))}

      {/* 出口 Handle：沿卡片高度等分（top=(i+1)/(n+1)，demo L1379-1387）；仅多出口画文字标签 */}
      {outs.map((o, i) => {
        const topPct = `${(((i + 1) / (outs.length + 1)) * 100).toFixed(1)}%`;
        return (
          <Fragment key={o.id}>
            <Handle
              className="cn-port--out"
              type="source"
              position={Position.Right}
              id={o.id}
              style={{ top: topPct }}
            />
            {outs.length > 1 && (
              <span className="cn-portlabel" style={{ top: `calc(${topPct} - 1px)` }}>
                {o.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
