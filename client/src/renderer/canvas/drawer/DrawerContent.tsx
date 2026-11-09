// DrawerContent —— 抽屉内容区组合件（T4-09；C-01 §3 DrawerShell 行内容区项——T3-08 注入位收口）。
//
// 内容区四块（ParamFormRenderer〔C-02〕＋io 区〔B-13〕＋脚本预览＋inner 区〔N5/A-4.4〕）的
// 编排与编辑会话：草稿 state 自含（初值=节点 params；宿主按 node.id 作 key 重挂——节点切换
// 全量重置，含 JsonControl 非受控初值〔T4-08 移交项，宿主侧 key 收口零改控件〕）；保存编排经
// ref 暴露（requestSave=validateParams→错误定位 k 展示/通过=patchNode 写回——动作区按钮在
// DrawerShell，命令式触发）。io/inner 区=只读展示（05 T4-09 备注：不含执行逻辑）。
//
// ⚠ 留痕：json 型草稿非法时控件层拦截（onChange 不触发，T4-08 冻结面）——保存走上一合法值，
// 控件层 parse 错误展示与宿主校验错误同槽不同源（parseErrors 优先，ParamForm 内已裁决）。
// 脚本预览=exec 声明面（lang/entry/file/config，demo L2068 形态）——脚本正文加载归 C-08
// 资产域，本卡不含。
import { useImperativeHandle, useState, type Ref } from 'react';
import type { Node } from '@xyflow/react';
import type { NodeDefinition } from '@constella/shared/dsl';
import {
  InnerStepList,
  IoContractView,
  ParamForm,
  innerView,
  ioView,
  validateParams,
  type ParamFieldError,
  type ParamValues,
  type SecretParamBinder,
} from '../../definition';
import type { CanvasNodeData } from '../node-types';
import { useFlowStore } from '../stores/flow-store';

/** 保存编排命令面（DrawerShell 动作区「保存」按钮消费） */
export interface DrawerContentHandle {
  /** 保存=validateParams → 失败：errors 定位字段 k 展示＋返回 false；通过：patchNode 写回＋返回 true */
  requestSave(): boolean;
}

export interface DrawerContentProps {
  /** 编辑中节点（xyflow Node；params 草稿初值源） */
  node: Node;
  /** 节点定义（registry.get 产物） */
  def: NodeDefinition;
  /** secret 写通道绑定器（装配点注入；缺省=secret 控件只读掩码——真通道随 C-M1） */
  secretBinder?: SecretParamBinder;
  /** 命令面挂载（React 19 ref-as-prop） */
  ref?: Ref<DrawerContentHandle>;
}

export function DrawerContent({ node, def, secretBinder, ref }: DrawerContentProps) {
  const params = (node.data as CanvasNodeData).params ?? {};
  // 草稿自含：宿主 key={node.id} 重挂即重置（含 JsonControl 非受控初值——T4-08 移交项收口）
  const [draft, setDraft] = useState<ParamValues>(() => ({ ...params }));
  const [errors, setErrors] = useState<ParamFieldError[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      requestSave(): boolean {
        const errs = validateParams(def.paramsSchema, draft);
        if (errs.length > 0) {
          setErrors(errs);
          return false;
        }
        useFlowStore.getState().patchNode(node.id, { params: draft });
        return true;
      },
    }),
    [def.paramsSchema, draft, node.id],
  );

  const exec = def.exec;
  const inner = def.inner != null && def.inner.length > 0 ? innerView(def.inner) : null;
  const view = ioView(def.io, def.ports.outs);

  return (
    <div data-drawer-content className="flex flex-col gap-4">
      <ParamForm
        schema={def.paramsSchema}
        value={draft}
        onChange={(k, v) =>
          setDraft((prev) => ({ ...prev, [k]: v }))
        }
        errors={errors}
        secretBinder={secretBinder}
      />
      <IoContractView view={view} />
      {exec !== null && (
        <section
          data-exec-preview
          className="rounded-lg border border-[var(--line)] bg-[rgba(160,200,255,0.03)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--tx-2)]"
        >
          <div className="font-semibold text-[var(--tx)]">
            📜 脚本资产包 · {exec.lang === 'ts' ? 'TypeScript' : 'Python'} · 入口 {exec.entry}()
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--tx-3)]">
            {exec.file}
            {exec.config !== undefined ? ` + ${exec.config}` : ''}
            {exec.deps !== undefined ? ` + ${exec.deps}` : ''}
          </div>
        </section>
      )}
      {inner !== null && <InnerStepList view={inner} />}
    </div>
  );
}
