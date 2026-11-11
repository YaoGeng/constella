// StepConfig —— 环节 4 config 页（T6-08；TDD-C-13 §3 ConfigYamlEditor 行「config/*.yaml 默认值
// 编辑+与 N3 参数键一致性校验」＋§6.1e「config 键与 schema 键不一致→警告」；01 §5.3 PATH1
// 环节 4 之 config 页——两页合一环节的另一半）。
//
//   页头固定提示覆盖顺序（02 §14 冻结）：脚本 PARAMS ← config/*.yaml ← 节点实例 params
// （抽屉）。键一致性=diffConfigKeys（./config-yaml-editor 自产自析纯函数层）——失配仅警告
// 不拦截（§6.1e 警告语义：警告不入 computeStepErrors、不影响环节门）。编辑产物=草稿
// script.configYaml（内存——保存链组装 zip 四件套随 T6-09）。
import { useMemo } from 'react';
import type { ParamField } from '@constella/shared/dsl';
import { configFromSchema, diffConfigKeys } from './config-yaml-editor';

export interface StepConfigProps {
  /** 节点 type（node: 行与 config/<type>.yaml 头——生成默认配置用） */
  type: string;
  /** config/*.yaml 草稿文本（draft.script.configYaml 直读） */
  configYaml: string;
  /** N3 参数 schema（键一致性比对基准） */
  paramsSchema: readonly ParamField[];
  onConfigChange(yaml: string): void;
}

const BTN_CLS = 'rounded-md border border-[var(--line-2)] px-2 py-1 text-[11px] text-[var(--tx-2)] hover:border-[var(--accent)] disabled:opacity-40';

export function StepConfig({ type, configYaml, paramsSchema, onConfigChange }: StepConfigProps) {
  const diff = useMemo(() => diffConfigKeys(configYaml, paramsSchema), [configYaml, paramsSchema]);
  // M1（batch-3 转交 3）空态抑制：configYaml 纯空白（从未编辑/未生成）＝「未配置」而非「形不符」
  // ——不显琥珀警告（可选资产：不配置不构成失配）；编辑后仍按 diff 逐条警示（§6.1e 不变）。
  const untouched = configYaml.trim() === '';
  const mismatched = !untouched && (diff.malformed || diff.missing.length > 0 || diff.extra.length > 0);

  return (
    <div data-step-form="config" className="flex flex-col gap-3">
      {/* 覆盖顺序页头（02 §14 冻结——固定提示不随编辑变化） */}
      <div
        data-testid="ne-config-overlay-order"
        className="rounded-md border border-[var(--line-2)] bg-[rgba(160,200,255,0.03)] px-3 py-1.5 text-[11px] text-[var(--tx-2)]"
      >
        参数覆盖顺序：脚本 PARAMS ← config/*.yaml ← 节点实例 params（抽屉）——02 §14 冻结
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--tx-3)]">config/{type || '<type>'}.yaml</span>
        <button
          type="button"
          data-config-generate
          title="按当前 type＋N3 schema 生成默认 yaml（替换编辑器内容——demo configYaml 同构）"
          onClick={() => onConfigChange(configFromSchema(type, paramsSchema))}
          className={`ml-auto ${BTN_CLS}`}
        >
          按 N3 生成默认配置
        </button>
      </div>

      <textarea
        data-config-editor
        value={configYaml}
        onChange={(e) => onConfigChange(e.target.value)}
        spellCheck={false}
        rows={10}
        placeholder={'# config/<type>.yaml · 节点默认配置（抽屉参数可覆盖）\nnode: <type>\nparams:\n  k: v'}
        className="w-full resize-y rounded-md border border-[var(--line-2)] bg-transparent px-2 py-1.5 font-mono text-[12px] leading-relaxed text-[var(--tx)] placeholder:text-[var(--tx-3)] focus:border-[var(--accent)] focus:outline-none"
      />

      {/* M1 空态提示（未配置≠失配——config 为可选资产；可选「按 N3 生成」或直接留空保存） */}
      {untouched && (
        <div data-config-empty-hint className="text-[11px] text-[var(--tx-3)]">
          config 未配置（可选）——留空保存即无 config 条目；可「按 N3 生成默认配置」起步。
        </div>
      )}

      {/* §6.1e 键一致性警告（琥珀=警告级——不拦截环节门/保存；空态抑制见上 M1） */}
      {mismatched && (
        <div data-config-warn className="rounded-md border border-[var(--amber)] bg-[rgba(240,179,94,0.06)] px-3 py-2 text-[11px] leading-relaxed text-[var(--amber)]">
          {diff.malformed && <div>config yaml 形不符（缺 params: 段）——N3 已定义键均未配置。</div>}
          {diff.missing.length > 0 && <div>缺少键（N3 已定义、config 未配置）：{diff.missing.join('、')}</div>}
          {diff.extra.length > 0 && <div>多余键（config 有、N3 未定义）：{diff.extra.join('、')}</div>}
          <div>与 N3 参数键不一致仅警告、不拦截保存（§6.1e）。</div>
        </div>
      )}
    </div>
  );
}
