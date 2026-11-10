// flow-switcher.ts —— createAndSwitch **真接线**（T5-10 ⚠⑥→T5-11 硬接线 2：库 id 消费——
// 否则 flow 安装无持久化）。T3-08 createFlowSwitcher 为 mock 语义（自生成 flowId＋内存 loadFlow，
// C-01 冻结文件不动）；本装配提供真实现：FlowInstaller 的 storageInvoke 桥**捕获** flows.create
// 返回的库 id，createAndSwitch 消费该 id（loadFlow 切换到真流程）——同一流程不重复建行。
//
// 持久化口径（⚠ 卡内冻结）：安装内容经 markDirty 进入标准保存链（800ms 防抖自动保存/手动
// 保存打版本——02 §3.3），不另发明版本 label（五值枚举外无「市场安装」位）；关窗前冲刷=
// AutoSaveScheduler.flush（C-06 §3）。切换后画布 dirty=true 属预期（安装即未保存变更）。
import type { FlowDoc, StorageInvokeReq } from '@constella/shared/ipc';
import { useFlowStore } from '../canvas/stores/flow-store';

/** C-06 storage 面（flows.create/flows.save/其余 op 透传） */
export interface AssemblyStorageFace {
  invoke(req: StorageInvokeReq): Promise<unknown>;
}

/** FlowSwitcher 注入面（flow-installer FlowSwitcherFace 同构——T3-08 导出面签名） */
export interface AssemblyFlowSwitcherFace {
  createAndSwitch(name: string, doc: FlowDoc): Promise<string>;
}

export interface RealFlowSwitcherWiring {
  /** FlowInstaller 的 storageInvoke 桥（flows.create 结果捕获——其余 op 直通） */
  installStorage: AssemblyStorageFace;
  /** FlowSwitcher 真实现（消费捕获库 id——装配注入 FlowInstallerDeps.flowSwitcher） */
  switcher: AssemblyFlowSwitcherFace;
}

interface CapturedCreate {
  name: string;
  id: string;
  consumed: boolean;
}

/**
 * 真接线装配：捕获-消费配对（installStorage↔switcher 同闭包共享）。
 * 并发注记：V1 安装为用户串行动作——同名并发安装的捕获错配不在防御面（消费按 LIFO＋同名匹配）。
 */
export function wireRealFlowSwitcher(storage: AssemblyStorageFace): RealFlowSwitcherWiring {
  const captured: CapturedCreate[] = [];

  const installStorage: AssemblyStorageFace = {
    async invoke(req) {
      const res = await storage.invoke(req);
      if (req.op === 'flows.create' && res !== null && typeof res === 'object' && typeof (res as { id?: unknown }).id === 'string') {
        captured.push({ name: (req.args as { name: string }).name, id: (res as { id: string }).id, consumed: false });
      }
      return res;
    },
  };

  const switcher: AssemblyFlowSwitcherFace = {
    async createAndSwitch(name, doc) {
      // 库 id 消费（LIFO＋同名匹配）：FlowInstaller 片刻前 flows.create 的行——切到真流程
      for (let i = captured.length - 1; i >= 0; i--) {
        const c = captured[i]!;
        if (!c.consumed && c.name === name) {
          c.consumed = true;
          useFlowStore.getState().loadFlow(c.id, { ...doc, name });
          useFlowStore.getState().markDirty(); // 安装内容未打版本——标准保存链持久化（⚠ 卡内冻结）
          return c.id;
        }
      }
      // 防御路径（无捕获——直接消费 switcher 的装配错配）：补建库行后切换
      const created = (await storage.invoke({ op: 'flows.create', args: { name } })) as { id: string };
      useFlowStore.getState().loadFlow(created.id, { ...doc, name });
      useFlowStore.getState().markDirty();
      return created.id;
    },
  };

  return { installStorage, switcher };
}
