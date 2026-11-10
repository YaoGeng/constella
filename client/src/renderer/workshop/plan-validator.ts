// PlanValidator —— 计划校验六查（T5-04；TDD-C-07 §3 PlanValidator 行＋§1 六环节 4 段；
// 02 §9.1 六查冻结序权威；01a §2 S5 溯源）。替换 demo L2311 假校验文案。
//   冻结序：①结构连通（触发节点 BFS 可达全部、无孤儿＋edge 索引越界拦截——T5-02 转交项）
//   ②参数 schema（C-02 validateParams——错误定位步骤 k）③触发节点（恰 ≥1 ins=[] 步骤）
//   ④端口匹配（from 出口 ∈ 上游 N2 outs / to 端口 ∈ 下游 ins——C-05 定义面）
//   ⑤IO 契约（C-02 checkIoCompat：下游引用字段在上游出口交付目录可寻——N7 用途③）
//   ⑥强节点脚本齐备（noScript 计划卡阶段即预拦截警告，不等运行闸——X-10 第⑥查）。
//   失败**逐条列出**（不全有全无）供「重新规划」；issues 序=冻结序 ①→⑥。
//   ✨new 未注册步骤（getDefinition 未命中）跳过定义面四查 ②④⑤⑥——其自检归 T5-03
//   NodeDevAgent 草稿链（C-02 定义级校验单一来源——词面规避 §6.5 grep 面）；拓扑面 ①③
//   照查（可达性不依赖定义）。
// P-3：C-05 get／⑥资产预检＝注入位（单测 stub/装配点绑注册表）；②⑤缺省绑 C-02 真源
// （definition/ T4-08/09 单一来源——L3→L2 向下依赖，TDD-C-07 §2 imports ↓ C-02 行），
// 亦留注入位（装配 seam）。纯同步（§3 `validate(plan): Issue[]` 签名冻结）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { ParamField } from '@constella/shared/dsl';
import { checkIoCompat, validateParams } from '../definition';
import type { PlanCard } from './flow-planner';

/** 六查定位码（02 §9.1 冻结序①~⑥；消费方按码列计划卡） */
export type PlanCheckId = 'structure' | 'params' | 'trigger' | 'ports' | 'io' | 'noScript';

/** 单条校验问题（逐条列计划卡供「重新规划」——02 §9.1 末句） */
export interface PlanIssue {
  /** 命中的查（①~⑥ 定位码） */
  check: PlanCheckId;
  /** 定位步骤（缺省=流程级问题，如③无触发节点） */
  stepIndex?: number;
  /** 人读说明（列卡直显） */
  message: string;
}

export interface PlanValidatorDeps {
  /** C-05 get 注入位（P-3——装配点绑 registry.get；单测 stub） */
  getDefinition(type: string): NodeDefinition | undefined;
  /** ②查注入位（缺省=C-02 真源 validateParams——T4-08 单一来源） */
  validateParams?: typeof validateParams;
  /** ⑤查注入位（缺省=C-02 真源 checkIoCompat——T4-09 单一来源） */
  checkIoCompat?: typeof checkIoCompat;
  /** ⑥查脚本资产在场预检注入位（装配点绑资产面；缺省=信任在场——仅 ✨/导入链可证缺失） */
  hasScriptAssets?: (type: string) => boolean;
}

export interface PlanValidator {
  /** §3 组件级接口：六查冻结序 ①→⑥，失败逐条返回（合法计划=空数组） */
  validate(plan: PlanCard): PlanIssue[];
}

/** 缺省边出口/端口（B-13：出口 'out'/入口 'in'——demo L2298 缺省线性串联形） */
export const DEFAULT_PLAN_EXIT = 'out';
export const DEFAULT_PLAN_PORT = 'in';

/**
 * 计划边解析：显式 edges 优先；缺省线性串联 [i,'out',i+1,'in']（demo L2298 同位——T5-02
 * 转交本卡）。①④⑤查与 FlowMaterializer 落图共用本口径（单一来源，不两处各推）。
 */
export function resolvePlanEdges(plan: PlanCard): [number, string, number, string][] {
  if (plan.edges !== undefined) return plan.edges;
  const out: [number, string, number, string][] = [];
  for (let i = 0; i + 1 < plan.steps.length; i++) {
    out.push([i, DEFAULT_PLAN_EXIT, i + 1, DEFAULT_PLAN_PORT]);
  }
  return out;
}

const inBounds = (i: number, n: number): boolean => Number.isInteger(i) && i >= 0 && i < n;

/** 触发步骤序号集（ins=[]——③查判定输入；未注册类型不可判，不入场） */
function triggerIndices(plan: PlanCard, getDefinition: PlanValidatorDeps['getDefinition']): number[] {
  const out: number[] = [];
  plan.steps.forEach((s, i) => {
    const def = getDefinition(s.type);
    if (def !== undefined && def.ports.ins.length === 0) out.push(i);
  });
  return out;
}

export function createPlanValidator(deps: PlanValidatorDeps): PlanValidator {
  const validateParamsFn = deps.validateParams ?? validateParams;
  const checkIoCompatFn = deps.checkIoCompat ?? checkIoCompat;
  const hasScriptAssets = deps.hasScriptAssets ?? (() => true); // 缺省信任在场（装配点接资产面）

  return {
    validate: (plan) => {
      const issues: PlanIssue[] = [];
      const steps = plan.steps;
      const edges = resolvePlanEdges(plan);
      const defOf = (i: number): NodeDefinition | undefined => deps.getDefinition(steps[i]!.type);

      // ①结构连通：edge 索引越界拦截＋触发节点 BFS 可达全部、无孤儿（02 §9.1①）
      for (const [fi, , ti] of edges) {
        if (!inBounds(fi, steps.length)) {
          issues.push({ check: 'structure', stepIndex: fi, message: `边起点索引 ${fi} 越界（步骤数 ${steps.length}）` });
        }
        if (!inBounds(ti, steps.length)) {
          issues.push({ check: 'structure', stepIndex: ti, message: `边终点索引 ${ti} 越界（步骤数 ${steps.length}）` });
        }
      }
      const starts = triggerIndices(plan, deps.getDefinition);
      if (starts.length > 0) {
        const reached = new Set<number>(starts);
        const queue = [...starts];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          for (const [fi, , ti] of edges) {
            if (fi === cur && !reached.has(ti)) {
              reached.add(ti);
              queue.push(ti);
            }
          }
        }
        for (let i = 0; i < steps.length; i++) {
          if (!reached.has(i)) {
            issues.push({
              check: 'structure',
              stepIndex: i,
              message: `步骤 ${i}「${steps[i]!.name}」（${steps[i]!.type}）从触发节点不可达——孤儿步骤`,
            });
          }
        }
      }

      // ②参数 schema：每步骤过 C-02 validateParams（错误定位步骤 k——01 A-17.8）
      steps.forEach((s, i) => {
        const def = deps.getDefinition(s.type);
        if (def === undefined) return; // ✨new 未注册——自检归 T5-03
        for (const err of validateParamsFn(def.paramsSchema as ParamField[], s.params ?? {})) {
          issues.push({ check: 'params', stepIndex: i, message: `步骤 ${i}「${s.name}」：${err.message}` });
        }
      });

      // ③触发节点：恰 ≥1 个 ins=[] 步骤（运行入口——C-03 RunGate 三查之一）
      if (triggerIndices(plan, deps.getDefinition).length === 0) {
        issues.push({
          check: 'trigger',
          message: '计划内无可确认的触发节点（ins=[]）——至少需要一个触发节点作运行入口',
        });
      }

      // ④端口匹配：from 出口 ∈ 上游 N2 outs / to 端口 ∈ 下游 ins（02 §9.1④）
      for (const [fi, exitId, ti, portId] of edges) {
        if (!inBounds(fi, steps.length) || !inBounds(ti, steps.length)) continue; // 越界归①
        const up = defOf(fi);
        const down = defOf(ti);
        if (up !== undefined && !up.ports.outs.some((o) => o.id === exitId)) {
          issues.push({
            check: 'ports',
            stepIndex: ti,
            message: `边 [${fi},"${exitId}",${ti},"${portId}"]：出口「${exitId}」不在上游步骤 ${fi}（${steps[fi]!.type}）的 outs 声明 [${up.ports.outs.map((o) => o.id).join('、')}] 中`,
          });
        }
        if (down !== undefined && !down.ports.ins.includes(portId)) {
          issues.push({
            check: 'ports',
            stepIndex: ti,
            message: `边 [${fi},"${exitId}",${ti},"${portId}"]：端口「${portId}」不在下游步骤 ${ti}（${steps[ti]!.type}）的 ins 声明 [${down.ports.ins.join('、') || '（触发节点 ins=[]）'}] 中`,
          });
        }
      }

      // ⑤IO 契约：下游引用字段在上游出口交付目录可寻（C-02 checkIoCompat——N7 用途③）
      for (const [fi, exitId, ti] of edges) {
        if (!inBounds(fi, steps.length) || !inBounds(ti, steps.length)) continue;
        const up = defOf(fi);
        const down = defOf(ti);
        if (up === undefined || down === undefined) continue;
        for (const io of checkIoCompatFn(up.io, exitId, down.io)) {
          issues.push({ check: 'io', stepIndex: ti, message: `边 [${fi},"${exitId}",${ti},…]：${io.message}` });
        }
      }

      // ⑥强节点脚本齐备：noScript 计划卡阶段预拦截警告（不等导入/运行闸——X-10 第⑥查）
      steps.forEach((s, i) => {
        const def = deps.getDefinition(s.type);
        if (def === undefined || def.exec === null) return; // 未注册/弱节点不适用
        if (!hasScriptAssets(s.type)) {
          issues.push({
            check: 'noScript',
            stepIndex: i,
            message: `步骤 ${i}「${s.name}」（${s.type}）为强节点但脚本资产缺失——noScript 运行闸会拦截，请重新规划或补齐 scripts`,
          });
        }
      });

      return issues;
    },
  };
}
