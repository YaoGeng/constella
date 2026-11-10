// DrawerShell —— 编辑抽屉宿主（T3-08；T4-09 内容区收口；C-01 §3 DrawerShell 行；demo
// L2021-2057 openDrawer* 语义）。
//
// 三态（读 canvasStore.drawer）：create（类型网格=C-05 listByCategory＋「✨自定义」双分支入口
// PATH1——点击类型经 onCreate 注入位落图，缺省=CanvasSink.dropAtViewportCenter）/edit（动作区
// 编排＋内容区——T4-09 收口：默认渲染 DrawerContent〔C-02 ParamFormRenderer＋io 区＋脚本预览
// ＋inner 区〕；显式 children 仍优先=注入位兼容）/readonly（只读态提示——运行态编辑闸）。
// 动作区：保存（默认编排=DrawerContent.requestSave 校验＋写回→成功关抽屉＋onSave 回调——
// T3-08「保存=校验」语义内置化，onSave 保留为成功后回调注入位）/取消/删除/入库（=C-06
// library.upsert 注入位）/试跑（T5-03 B-5 面注入位）。
//
// T6-06 接线：「✨自定义」双分支（01 §5.3 PATH1）——「手动定义」=openNodeEditor 打开 C-13
// 节点编辑器（EditorShell 宿主挂本组件——open=false 渲染 null；编辑器覆盖层独立于抽屉
// 生命周期，抽屉关闭不弃草稿）；「让 AI 开发」=demo L2094-2100 冻结跳工坊行为，装配归
// 应用壳（T6-17），本组件不接线。
import { useMemo, useRef, type ReactNode } from 'react';
import { useCanvasStore } from '../canvas-store';
import { useCanvasRegistry } from '../registry-context';
import { useFlowStore } from '../stores/flow-store';
import { cn } from '../../lib/utils';
import type { SecretParamBinder } from '../../definition';
import { EditorShell, openNodeEditor } from '../../node-editor';
import { DrawerContent, type DrawerContentHandle } from './DrawerContent';

export interface DrawerShellProps {
  /** create 态选类型回调（缺省=dropAtViewportCenter 最小落图）。 */
  onCreate?: (type: string) => void;
  /** edit 态保存成功后回调（校验＋写回已由默认编排完成——产品壳可追加 markSaved 等）。 */
  onSave?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  /** 入库（C-06 library.upsert）注入位。 */
  onLibraryUpsert?: (nodeId: string) => void;
  /** 试跑位（T5-03 B-5 试跑面）注入位。 */
  onTryRun?: (nodeId: string) => void;
  /** secret 写通道绑定器（C-M1 secret:* 装配点注入；缺省=secret 控件只读掩码）。 */
  secretBinder?: SecretParamBinder;
  /** edit 态内容区覆盖注入位（缺省=DrawerContent 四块：参数表单＋io 区＋脚本预览＋inner 区）。 */
  children?: ReactNode;
}

export function DrawerShell({
  onCreate,
  onSave,
  onDelete,
  onLibraryUpsert,
  onTryRun,
  secretBinder,
  children,
}: DrawerShellProps) {
  const drawer = useCanvasStore((s) => s.drawer);
  const registry = useCanvasRegistry();
  const nodes = useFlowStore((s) => s.nodes);
  const running = useFlowStore((s) => s.running);
  const closeDrawer = useCanvasStore((s) => s.closeDrawer);
  const removeNodeCascade = useFlowStore((s) => s.removeNodeCascade);
  const contentRef = useRef<DrawerContentHandle>(null);

  const categories = useMemo(() => registry?.listByCategory() ?? {}, [registry]);
  const node = drawer?.nodeId ? nodes.find((n) => n.id === drawer.nodeId) : undefined;
  const def = node ? registry?.get(String((node.data as { type?: string }).type ?? '')) : undefined;

  // 无 drawer 态只挂编辑器宿主（open=false 渲染 null——编辑器生命周期独立于抽屉）
  if (!drawer) return <EditorShell />;

  const isReadonly = drawer.mode === 'readonly' || running;

  /** 保存动作（默认编排：校验失败=留在抽屉展示字段级错误；通过/无校验面=关抽屉＋onSave） */
  const handleSave = (): void => {
    if (contentRef.current?.requestSave() === false) return;
    closeDrawer();
    if (node !== undefined) onSave?.(node.id);
  };

  return (
    <>
      {/* C-13 节点编辑器宿主（「手动定义」入口对面——open=false 渲染 null；抽屉关不弃草稿） */}
      <EditorShell />
      <aside className={cn('cn-drawer', drawer && 'cn-drawer--open')} data-drawer-mode={drawer.mode}>
      <div className="cn-drawer__inner">
        <button type="button" className="cn-drawer__x" aria-label="关闭抽屉" onClick={closeDrawer}>
          ✕
        </button>

        {drawer.mode === 'create' && !isReadonly && (
          <div className="cn-drawer__create">
            <h3 className="cn-drawer__title">新建节点</h3>
            {Object.entries(categories).map(([cat, defs]) => (
              <div key={cat} className="cn-drawer__group">
                <div className="cn-drawer__group-title">{cat}</div>
                <div className="cn-drawer__grid">
                  {defs.map((def) => (
                    <button
                      key={def.type}
                      type="button"
                      className="cn-drawer__type"
                      data-node-type={def.type}
                      onClick={() => onCreate?.(def.type)}
                    >
                      <span className="cn-drawer__type-icon">{def.meta.icon}</span>
                      <span>{def.meta.name}</span>
                      {def.kind === 'custom' && <span className="cn-drawer__type-spark">✨</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {/* PATH1 双分支入口（01 §5.3）：✨「让 AI 开发」=demo 冻结跳工坊行为（装配归应用壳
                T6-17，本组件不接线）；「手动定义」打开 C-13 节点编辑器（T6-06 接线） */}
            <div className="cn-drawer__group">
              <div className="cn-drawer__group-title">自定义</div>
              <button type="button" className="cn-drawer__type cn-drawer__type--custom" data-testid="drawer-custom-entry">
                <span className="cn-drawer__type-icon">✨</span>
                <span>让 AI 开发</span>
              </button>
              <button
                type="button"
                className="cn-drawer__type cn-drawer__type--custom"
                data-testid="drawer-custom-manual"
                onClick={() => openNodeEditor()}
              >
                <span className="cn-drawer__type-icon">🛠️</span>
                <span>手动定义</span>
              </button>
            </div>
          </div>
        )}

        {drawer.mode === 'edit' && node && (
          <div className="cn-drawer__edit">
            <h3 className="cn-drawer__title">{String((node.data as { name?: string }).name ?? '')}</h3>
            <div className="cn-drawer__meta">{String((node.data as { type?: string }).type ?? '')}</div>
            {isReadonly ? (
              <div className="cn-drawer__readonly">运行中：节点只读</div>
            ) : (
              <>
                <div className="cn-drawer__content">
                  {children ??
                    (def !== undefined && node !== undefined ? (
                      // key=node.id：节点切换整块重挂——草稿与 JsonControl 非受控初值全量重置
                      //（T4-08 移交项收口：宿主侧 key 重挂，零改控件）
                      <DrawerContent key={node.id} ref={contentRef} node={node} def={def} secretBinder={secretBinder} />
                    ) : (
                      <div
                        data-drawer-missing-def
                        className="rounded-lg border border-dashed border-[var(--line-2)] px-3 py-3 text-[11px] text-[var(--tx-3)]"
                      >
                        节点定义不可用（类型未注册或校验失败）——参数与契约区无展示面
                      </div>
                    ))}
                </div>
                <div className="cn-drawer__actions">
                  <button type="button" className="cn-btn cn-btn--primary" data-testid="drawer-save" onClick={handleSave}>
                    保存
                  </button>
                  <button type="button" className="cn-btn" data-testid="drawer-cancel" onClick={closeDrawer}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="cn-btn cn-btn--danger"
                    data-testid="drawer-delete"
                    onClick={() => {
                      removeNodeCascade(node.id);
                      closeDrawer();
                      onDelete?.(node.id);
                    }}
                  >
                    删除
                  </button>
                  <button type="button" className="cn-btn" data-testid="drawer-lib" onClick={() => onLibraryUpsert?.(node.id)}>
                    入库
                  </button>
                  <button type="button" className="cn-btn" data-testid="drawer-tryrun" onClick={() => onTryRun?.(node.id)}>
                    试跑
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {drawer.mode === 'readonly' && !node && <div className="cn-drawer__readonly">只读模式</div>}
      </div>
    </aside>
    </>
  );
}
