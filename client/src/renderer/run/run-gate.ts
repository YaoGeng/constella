// RunGate —— 运行闸（TDD-C-03 §3 组件行；02 §10 #9 三条＋02 §12.4 附加拦截；T4-01）。
// 查序（demo L1792-1796）：① 脏（未保存不许跑）→ ② 同流程 active run（不同流程可并行）
// → ③ 触发节点存在（ins=[]）→ ④ broken 定义拦截（C-05 isBroken，02 §8.2）→ ⑤ noScript
// 拦截（def.custom 且 no_script，02 §12.4/A-12.3）。违例=各自 toast＋err 日志、不产生 run。
// 组件保持纯同步（脏/active 经注入回调；触发判定查注册表）——流程文档由 startRun 先取后传
// （脏闸保证已保存=库内即当前，02 §3.2 C-03 行）。
import type { FlowDoc } from '@constella/shared/ipc';
import type { GateResult, RunRegistryLike } from './types';
import { findTriggers } from './topo-planner';

export interface RunGateDeps {
  /** 脏闸注入位（true=该流程有未保存改动）；应用壳接 flowStore dirty 投影——本模块不 import 画布层 */
  guardDirty: (flowId: string) => boolean;
  /** 同流程 active run 查询（RunLedger.activeOf 注入——running/waiting 视为占用） */
  isActiveRun: (flowId: string) => boolean;
  /** 注册表注入面（broken 拦截＋触发判定） */
  registry: RunRegistryLike;
}

export class RunGate {
  constructor(private readonly deps: RunGateDeps) {}

  check(flowId: string, doc: FlowDoc): GateResult {
    if (this.deps.guardDirty(flowId)) {
      return { ok: false, reason: 'dirty', message: '有未保存改动 — 先保存再运行' };
    }
    if (this.deps.isActiveRun(flowId)) {
      return { ok: false, reason: 'duplicate', message: '该流程已有任务在运行' };
    }
    if (findTriggers(doc, this.deps.registry).length === 0) {
      return { ok: false, reason: 'no-trigger', message: '流程缺少触发节点（手动/定时）' };
    }
    const broken = doc.nodes.find((n) => this.deps.registry.isBroken(n.type));
    if (broken !== undefined) {
      return { ok: false, reason: 'broken-def', message: `节点定义校验未通过：${broken.type}` };
    }
    const noScript = doc.nodes.find((n) => {
      const d = this.deps.registry.get(n.type);
      // 强节点（custom）无脚本资产：实例 no_script 标记（A-12.3 导入标记）或定义缺 exec（02 §8.4）
      return d?.kind === 'custom' && (n.noScript === true || d.exec === null);
    });
    if (noScript !== undefined) {
      return { ok: false, reason: 'no-script', message: `强节点「${noScript.name}」缺少脚本` };
    }
    return { ok: true };
  }
}
