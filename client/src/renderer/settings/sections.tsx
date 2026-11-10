// 设置四节＋V1.1 占位节（T6-12；TDD-C-11 §3 InteractionSection/BackgroundSection/
// SkyFieldSection/DangerZoneSection/RouteSettingsSection 行——组件级接口：onChange→setSetting）。
//
// - 三开关/bg/视差切换即 dispatcher.setSetting 即生效（demo L2728-2731）；开关=受控 button
//   role="switch"（demo .switch on 同语义，data-set=键名）。
// - 密度滑杆：非受控 range＋oninput 只显数、原生 change（松手）才提交——dens 重建昂贵，
//   demo L2740-2745 oninput/onchange 分工同源。
// - 危险区：AlertDialog 二次确认→settingsStore.factoryReset（op 恰一次；删库/重启编排归
//   C-M1 对端）；busy 防双击双发。
// - RouteSettingsSection＝V1.1 占位（硬前置 TDD-C-19+C-18+S-11 gate，05 §0.6/P7 波）：
//   导航位在 SettingsDialog、内容 V1.0 不渲染；deps 注入位形随 C-18 §3 定形。
import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, SKY_DENS_KEYS, SKY_TOGGLE_KEYS } from './settings-store';
import type { SettingsDispatcher } from './settings-dispatcher';
import { AlertDialog } from './AlertDialog';

/** 设置节组件公共 props（dispatcher 经 SettingsDialog 下传） */
export interface SectionProps {
  dispatcher: SettingsDispatcher;
}

/** demo 设置文案表（L758-786——行标题/说明） */
const INTERACTION_META: Array<{ k: 'snap' | 'edgeAnim' | 'autoSave'; name: string; hint: string }> = [
  { k: 'snap', name: '网格吸附', hint: '拖拽节点时按 20px 对齐' },
  { k: 'edgeAnim', name: '运行连线动画', hint: '运行时连线显示流动虚线' },
  { k: 'autoSave', name: '自动保存', hint: '改动 800ms 后自动写入本地' },
];

/** 开关（受控——demo .switch on；role=switch 可达性） */
function Switch({ k, on, onToggle }: { k: string; on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      data-set={k}
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      onClick={onToggle}
      className={`h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on ? 'border-[var(--accent)] bg-[var(--accent-tint)]' : 'border-[var(--line-2)] bg-transparent'
      }`}
    >
      <span
        className={`block h-3.5 w-3.5 rounded-full transition-transform ${
          on ? 'translate-x-4.5 bg-[var(--accent)]' : 'translate-x-0.5 bg-[var(--tx-3)]'
        }`}
      />
    </button>
  );
}

/** 交互节：三开关（切换即 setSetting 即生效） */
export function InteractionSection({ dispatcher }: SectionProps) {
  const snap = useSettingsStore((s) => s.values.snap);
  const edgeAnim = useSettingsStore((s) => s.values.edgeAnim);
  const autoSave = useSettingsStore((s) => s.values.autoSave);
  const on = { snap, edgeAnim, autoSave };
  return (
    <section data-settings-section="interaction" className="flex flex-col gap-2.5">
      {INTERACTION_META.map(({ k, name, hint }) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <b className="text-sm font-medium text-[var(--tx)]">{name}</b>
            <span className="text-xs text-[var(--tx-3)]">{hint}</span>
          </div>
          <Switch k={k} on={on[k]} onToggle={() => dispatcher.setSetting(k, !on[k])} />
        </div>
      ))}
    </section>
  );
}

/** 背景与渲染节：bg 双值（星空/纯黑）＋鼠标视差 */
export function BackgroundSection({ dispatcher }: SectionProps) {
  const bg = useSettingsStore((s) => s.values.bg);
  const parallax = useSettingsStore((s) => s.values.parallax);
  return (
    <section data-settings-section="background" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <b className="text-sm font-medium text-[var(--tx)]">背景样式</b>
          <span className="text-xs text-[var(--tx-3)]">星空 / 纯黑（纯黑关闭星空渲染，更省电）</span>
        </div>
        <select
          data-bg="select"
          value={bg}
          onChange={(e) => dispatcher.setSetting('bg', e.target.value === 'black' ? 'black' : 'sky')}
          className="rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-2 py-1 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
        >
          <option value="sky">星空</option>
          <option value="black">纯黑</option>
        </select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <b className="text-sm font-medium text-[var(--tx)]">鼠标视差</b>
          <span className="text-xs text-[var(--tx-3)]">星空随鼠标轻微移动</span>
        </div>
        <Switch k="parallax" on={parallax} onToggle={() => dispatcher.setSetting('parallax', !parallax)} />
      </div>
    </section>
  );
}

/** 密度滑杆文案表（demo L780-786 行序：恒星/银道微星/亮星/星团/迷你M31/红青星云/银心暖流） */
const DENS_META: Record<string, string> = {
  dens_stars: '恒星密度',
  dens_band: '银道微星密度',
  dens_heroes: '亮星数量',
  dens_clusters: '动态星团数量',
  dens_minis: '迷你 M31 数量',
  dens_mega: '红 · 青星云密度',
  dens_gas: '银心暖流密度',
};

/** 密度滑杆行（非受控 range：oninput 显数、原生 change 提交——demo L2740-2745 分工） */
function DensSlider({ dispatcher, k }: { dispatcher: SettingsDispatcher; k: (typeof SKY_DENS_KEYS)[number] }) {
  const value = useSettingsStore((s) => s.values[k]);
  const [display, setDisplay] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  // 原生 change（松手/键盘提交）→ setSetting（dens 重建+toast+落盘）；React onChange=input 事件
  // 每步触发，故用 ref+addEventListener 挂原生 change（demo onchange 语义）
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onNativeChange = (): void => {
      dispatcher.setSetting(k, Number(el.value));
    };
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, [dispatcher, k]);
  return (
    <div className="flex items-center justify-between gap-3">
      <b className="text-sm font-medium text-[var(--tx)]">{DENS_META[k] ?? k}</b>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          data-dens={k}
          type="range"
          min={10}
          max={100}
          step={10}
          defaultValue={String(value)}
          onInput={(e) => setDisplay(e.currentTarget.value)}
          className="w-40 accent-[var(--accent)]"
        />
        <span data-dens-value={k} className="w-10 text-right font-mono text-[10px] text-[var(--tx-3)]">
          {display}%
        </span>
      </div>
    </div>
  );
}

/** 星野开关文案表（demo L766-777 行序） */
const SKY_TOGGLE_META: Record<string, string> = {
  meteor: '流星',
  sat: '卫星',
  disk: 'M31 星系（大 / 小）',
  minis: '迷你 M31 星系',
  mega: '红 · 青 星云',
  gas: '银心暖流（黄）',
  heroes: '亮星与星芒',
  stars: '恒星',
  band: '银道微星',
  clusters: '动态星团',
  pulse: '星河辉光',
};

/** 星野元素节：11 开关＋7 密度滑杆（变更即 dens 重建＋「星野重建中」toast） */
export function SkyFieldSection({ dispatcher }: SectionProps) {
  const layers = useSettingsStore((s) => s.values);
  return (
    <section data-settings-section="skyfield" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {SKY_TOGGLE_KEYS.map((k) => (
          <label key={k} className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--tx-2)]">{SKY_TOGGLE_META[k] ?? k}</span>
            <Switch k={k} on={layers[k] as boolean} onToggle={() => dispatcher.setSetting(k, !(layers[k] as boolean))} />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-[var(--line)] pt-2">
        {SKY_DENS_KEYS.map((k) => (
          <DensSlider key={k} dispatcher={dispatcher} k={k} />
        ))}
      </div>
    </section>
  );
}

/** 危险区节：恢复出厂（二次确认→settings.factoryReset op 恰一次；编排链归 C-06/C-M1） */
export function DangerZoneSection(_props: SectionProps) {
  const factoryReset = useSettingsStore((s) => s.factoryReset);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const onAction = (): void => {
    if (busy) return;
    setBusy(true);
    void factoryReset()
      .catch((err: unknown) => console.error('[DangerZone] factoryReset 失败：', err))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };
  return (
    <section data-settings-section="danger" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(255,90,120,0.28)] bg-[rgba(120,20,40,0.14)] p-3">
        <div className="flex flex-col">
          <b className="text-sm font-medium text-[var(--tx)]">恢复出厂</b>
          <span className="text-xs text-[var(--tx-3)]">清空本地全部数据（流程/版本/设置）并重启，回到初始状态</span>
        </div>
        <button
          type="button"
          data-danger="open"
          onClick={() => setConfirming(true)}
          className="shrink-0 rounded-md bg-[rgba(160,30,50,0.9)] px-3 py-1.5 text-sm font-semibold text-[#ffd7de] hover:brightness-110"
        >
          重置
        </button>
      </div>
      <AlertDialog
        open={confirming}
        destructive
        busy={busy}
        title="确认恢复出厂？"
        description="将删除本地全部流程、版本、节点与设置数据并重启应用——此操作不可撤销。"
        cancelText="取消"
        actionText="确认重置"
        onCancel={() => {
          if (busy) return;
          setConfirming(false);
        }}
        onAction={onAction}
      />
    </section>
  );
}

/** C-18 §3 接口注入位（V1.1 定形——B2 前随 TDD-C-18 落库；本卡仅占位形） */
export interface RouteSettingsDeps {
  /** SceneRegistry：scenes()/describe(scene)（C-18 §3） */
  sceneRegistry?: unknown;
  /** RouteTable：getBinding/setBinding/listProfiles/getDefault（C-18 §3） */
  routeTable?: unknown;
  /** FallbackSignal 订阅（回退/降级提示呈现——不静默换模型，00a 卡4） */
  fallbackSignal?: unknown;
  /** secret:* 通道面（apiKey 输入→preload secret:set 存明文，settings 只存 apiKeyRef，02 §12.3） */
  secret?: unknown;
}

/** 场景路由节（V1.1 占位——硬前置 TDD-C-19+C-18+S-11 gate〔05 §0.6〕；V1.0 不渲染） */
export function RouteSettingsSection(_props: { deps?: RouteSettingsDeps }) {
  return null;
}
