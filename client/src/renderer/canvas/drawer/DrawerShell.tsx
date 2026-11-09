// DrawerShell —— 编辑抽屉宿主（T3-08；C-01 §3 DrawerShell 行；demo L2021-2057 openDrawer* 语义）。
//
// 三态（读 canvasStore.drawer）：create（类型网格=C-05 listByCategory＋「✨自定义」双分支入口
// PATH1——点击类型经 onCreate 注入位落图，缺省=CanvasSink.dropAtViewportCenter）/edit（动作区
// 编排＋内容区 children 注入位——ParamFormRenderer C-02 随 G3 接线，区头 c 项）/readonly
// （只读态提示——运行态编辑闸）。动作区：保存/取消/删除/入库/试跑位（编排=注入回调，
// 入库=C-06 library.upsert、试跑=T5-03 B-5 面——本波注入位先行）。
import { useMemo, type ReactNode } from 'react';
import { useCanvasStore } from '../canvas-store';
import { useCanvasRegistry } from '../registry-context';
import { useFlowStore } from '../stores/flow-store';
import { cn } from '../../lib/utils';

export interface DrawerShellProps {
  /** create 态选类型回调（缺省=dropAtViewportCenter 最小落图）。 */
  onCreate?: (type: string) => void;
  /** edit 态动作区编排注入位（产品壳：保存=校验+markDirty 清/markSaved）。 */
  onSave?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  /** 入库（C-06 library.upsert）注入位。 */
  onLibraryUpsert?: (nodeId: string) => void;
  /** 试跑位（T5-03 B-5 试跑面）注入位。 */
  onTryRun?: (nodeId: string) => void;
  /** edit 态内容区（C-02 ParamFormRenderer＋io 区＋脚本预览——注入位先行）。 */
  children?: ReactNode;
}

export function DrawerShell({ onCreate, onSave, onDelete, onLibraryUpsert, onTryRun, children }: DrawerShellProps) {
  const drawer = useCanvasStore((s) => s.drawer);
  const registry = useCanvasRegistry();
  const nodes = useFlowStore((s) => s.nodes);
  const running = useFlowStore((s) => s.running);
  const closeDrawer = useCanvasStore((s) => s.closeDrawer);
  const removeNodeCascade = useFlowStore((s) => s.removeNodeCascade);

  const categories = useMemo(() => registry?.listByCategory() ?? {}, [registry]);
  const node = drawer?.nodeId ? nodes.find((n) => n.id === drawer.nodeId) : undefined;

  if (!drawer) return null;

  const isReadonly = drawer.mode === 'readonly' || running;

  return (
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
            {/* PATH1 双分支入口：✨自定义（AI 现场开发/手动——C-02/C-07 随 P5 接线） */}
            <div className="cn-drawer__group">
              <div className="cn-drawer__group-title">自定义</div>
              <button type="button" className="cn-drawer__type cn-drawer__type--custom" data-testid="drawer-custom-entry">
                <span className="cn-drawer__type-icon">✨</span>
                <span>自定义节点</span>
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
                <div className="cn-drawer__content">{children}</div>
                <div className="cn-drawer__actions">
                  <button type="button" className="cn-btn cn-btn--primary" data-testid="drawer-save" onClick={() => onSave?.(node.id)}>
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
  );
}
