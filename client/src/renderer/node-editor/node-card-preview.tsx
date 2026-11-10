// NodeCardPreview —— 只读卡片预览（T6-06；TDD-C-13 §3 NodeCardPreview 行：{def: NodeDefinition}，
// 复用处=StepMeta/StepPorts）。
//
//   自持红线（§3「不 import C-01（P-3 同层禁）」）：本文件零 canvas import、零
// @xyflow/react（替换点①收窄面）——视觉规格同源=直接复用全局 .cn-node* 样式类
// （styles/tailwind.css C-01 移植面——类名是全局 CSS，非模块依赖）＋自绘端口点
// （demo L1360-1387：ins 左侧 top 50%、outs 右侧沿卡片高度等分 top=(i+1)/(n+1)、
// 仅多出口画文字标签 L1385-1387；✨=kind custom L1377；参数预览首参 26 字截断 L1354-1358）。
//   参数预览取值口径：编辑期无实例 params 层——取 paramsSchema 首个有 default 的字段
// （「参数预览实时反映」=schema 变更即反映；实例层覆盖序 PARAMS←config←params 归抽屉/运行面）。
import { Fragment } from 'react';
import type { NodeDefinition } from '@constella/shared/dsl';

export interface NodeCardPreviewProps {
  /** 预览对象（草稿即所见——未保存定义不入注册表） */
  def: NodeDefinition;
}

export function NodeCardPreview({ def }: NodeCardPreviewProps) {
  const meta = def.meta;
  const outs = def.ports.outs;
  const firstParam = def.paramsSchema.find(
    (p) => p.default !== undefined && p.default !== null && String(p.default) !== '',
  );
  const preview = firstParam !== undefined ? `${firstParam.k}: ${String(firstParam.default).slice(0, 26)}` : '';

  return (
    <div data-preview="card" data-node-type={def.type} className="cn-node relative w-[192px]">
      <div className="cn-node__head">
        <span data-preview="icon" className="cn-node__icon">
          {meta.icon || '✨'}
        </span>
        <span data-preview="name" className="cn-node__name">
          {meta.name || '（未命名）'}
        </span>
      </div>
      <div data-preview="type-line" className="cn-node__type">
        {meta.category || '未分类'} · {def.type || '（未定类型）'}
        {def.kind === 'custom' ? ' · ✨' : ''}
      </div>
      <div data-preview="params" className="cn-node__params">
        {preview}
      </div>

      {/* 入口点：左缘 top 50%（demo L1381；ins=[] 触发节点无入口） */}
      {def.ports.ins.map((p) => (
        <span
          key={p}
          data-preview-port-in={p}
          className="absolute left-[-7px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 rounded-full border-2 border-[var(--line-2)] bg-[#0b0d09]"
        />
      ))}

      {/* 出口点：右缘沿卡片高度等分（demo L1382-1384）；仅多出口画文字标签（L1385-1387） */}
      {outs.map((o, i) => {
        const topPct = `${(((i + 1) / (outs.length + 1)) * 100).toFixed(1)}%`;
        return (
          <Fragment key={`${o.id}-${i}`}>
            <span
              data-preview-port-out={o.id}
              style={{ top: topPct }}
              className="absolute right-[-7px] h-[13px] w-[13px] -translate-y-1/2 rounded-full border-2 border-[var(--line-2)] bg-[#0b0d09]"
            />
            {outs.length > 1 && (
              <span
                data-preview-portlabel={o.id}
                style={{ top: `calc(${topPct} - 1px)` }}
                className="absolute right-3 -translate-y-1/2 font-mono text-[9px] leading-none text-[var(--tx-3)]"
              >
                {o.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
