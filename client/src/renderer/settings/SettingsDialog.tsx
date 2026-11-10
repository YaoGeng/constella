// SettingsDialog —— 设置弹窗壳＋分区导航五节（T6-12；TDD-C-11 §3 SettingsDialog 行）。
//
// 五节＝交互/背景与渲染/星野元素/场景路由（V1.1 占位——导航位在场但禁用，内容 V1.0 不渲染，
// 硬前置 TDD-C-19+C-18+S-11 gate）/危险区。Section 组件经内部 dispatcher（deps 注入位=
// 应用壳 T6-17 装配：scheduler/toast/徽标/隐藏回调）消费 setSetting；store 订阅在 Section 内。
// ⚠ §3 表标「无 props」——open/onClose 受控为对 02 §3.3 uiStore（尚未落库，应用壳层）的最小
// 留位：navSettings 入口→uiStore→open prop，T6-17 可无缝换接。
import { useMemo, useState } from 'react';
import { createSettingsDispatcher, type SettingsDispatcherDeps } from './settings-dispatcher';
import {
  BackgroundSection,
  DangerZoneSection,
  InteractionSection,
  RouteSettingsSection,
  SkyFieldSection,
} from './sections';

export type SettingsSectionId = 'interaction' | 'background' | 'skyfield' | 'route' | 'danger';

export interface SettingsDialogProps {
  open: boolean;
  onClose(): void;
  /** dispatcher 依赖注入位（T6-17 装配；缺省仅通道下发——无 scheduler/toast/回调） */
  deps?: SettingsDispatcherDeps;
  /** V1.1 场景路由节注入位（RouteSettingsSection deps——B2 波装配，V1.0 不渲染） */
  routeDeps?: Parameters<typeof RouteSettingsSection>[0]['deps'];
}

/** 分区导航五节（demo L761/765/779 分节头＋V1.1 位＋危险区） */
const NAV_ITEMS: Array<{ id: SettingsSectionId; label: string; v11?: boolean }> = [
  { id: 'interaction', label: '交互' },
  { id: 'background', label: '背景与渲染' },
  { id: 'skyfield', label: '星野元素' },
  { id: 'route', label: '场景路由', v11: true },
  { id: 'danger', label: '危险区' },
];

export function SettingsDialog({ open, onClose, deps, routeDeps }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSectionId>('interaction');
  const dispatcher = useMemo(() => createSettingsDispatcher(deps ?? {}), [deps]);

  if (!open) return null;

  return (
    <div
      data-settings="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="系统设置"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,6,16,0.72)]"
    >
      <div className="flex h-[420px] w-[620px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <b className="text-sm font-semibold text-[var(--tx)]">系统设置</b>
          <button
            type="button"
            data-settings="close"
            title="关闭"
            className="rounded px-2 py-0.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav data-settings="nav" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-[var(--line)] p-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-settings-nav={item.id}
                disabled={item.v11 === true}
                aria-current={section === item.id ? 'true' : undefined}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                  section === item.id
                    ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]'
                    : 'text-[var(--tx-2)] hover:bg-[var(--accent-tint)]'
                } ${item.v11 === true ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
                onClick={() => setSection(item.id)}
              >
                <span>{item.label}</span>
                {item.v11 === true && <span className="text-[10px] text-[var(--tx-3)]">V1.1</span>}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {section === 'interaction' && <InteractionSection dispatcher={dispatcher} />}
            {section === 'background' && <BackgroundSection dispatcher={dispatcher} />}
            {section === 'skyfield' && <SkyFieldSection dispatcher={dispatcher} />}
            {/* toast=deps.toast 下传（危险区失败面——T6-17 batch-1 转交③：装配链 deps→dialog→section） */}
            {section === 'danger' && <DangerZoneSection dispatcher={dispatcher} toast={deps?.toast} />}
            {/* V1.1 注入位（硬前置 C-19+C-18+S-11 gate——导航项禁用使本分支 V1.0 不可达不渲染；
                RouteSettingsSection 现返回 null，B2 波随 C-18 定形实装） */}
            {section === 'route' && <RouteSettingsSection deps={routeDeps} />}
          </div>
        </div>
      </div>
    </div>
  );
}
