// FlowInstaller —— flow 安装编排（T5-10 / TDD-C-09 §3 FlowInstaller 行）。
//
// 序（03 §3 行原文）：脏闸前置（demo L3066）→FlowSteps 回放（steps→nodes+显式 edges，01 A-13.2
// ——BFS 拓扑序线性链，demo genFlow L2177 同构）→WaterfallPlacer（C-08 复用）→flows.create（C-06
// 落库）＋落节点（createAndSwitch doc 承载）→createAndSwitch 流程切换（注入 seam——T3-08 冻结签名）
// ＋「已安装到我的流程」toast（demo L3064-3069）。
//
// 注入件签名=T3-08 导出面（03 L1955 冻结）：canvasSink.guardDirty／flowSwitcher.createAndSwitch；
// flows.create 经 storageInvoke（C-06 面）。known 偏差（报告留痕 ⚠）：T3-08 createAndSwitch 为
// mock 语义（自生成 flowId）——真落盘接线（createAndSwitch 消费 flows.create 库 id）归应用壳装配
// （T3-08 区头 d 项「随 P5 C-09 接线」）；本卡 InstallResult.flowId=flows.create 库 id。
import type { FlowDoc, FlowEdge, FlowNode, StorageInvokeReq } from '@constella/shared/ipc';
import type { FlowSteps } from '@constella/shared/manifest';
import { createWaterfallPlacer } from '../zip/waterfall-placer';

/** 脏闸拒绝（demo L3066「有未保存改动 — 先保存或取消」——Installer catch 面透传/装配位提示） */
export class FlowDirtyRefusedError extends Error {
  readonly refused = true;
  constructor() {
    super('有未保存改动 — 先保存或取消（02 §3.3 脏闸）');
    this.name = 'FlowDirtyRefusedError';
  }
}

/** CanvasSink 注入面（T3-08 导出面结构子集——脏闸） */
export interface FlowCanvasSinkFace {
  guardDirty(action: string): boolean;
}

/** FlowSwitcher 注入面（T3-08 导出面结构子集——03 L1955 冻结签名） */
export interface FlowSwitcherFace {
  createAndSwitch(name: string, doc: FlowDoc): Promise<string>;
}

export interface FlowInstallerDeps {
  canvasSink: FlowCanvasSinkFace;
  flowSwitcher: FlowSwitcherFace;
  /** C-06 面（flows.create——flow 安装落库，03 §2 imports） */
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
  /** 视口中心（WaterfallPlacer 基准——应用壳注入，与 CanvasSink.viewportCenter 同源） */
  viewportCenter(): { x: number; y: number };
  /** toast/日志面（「已安装到我的流程」——demo L3064-3069） */
  notify?(level: 'info' | 'ok' | 'warn' | 'err', msg: string): void;
  log?: (...args: unknown[]) => void;
}

export interface FlowInstallResult {
  /** flows.create 库 id（C-06 落库——真通道；store 切换 id 归 createAndSwitch seam） */
  flowId: string;
  nodeCount: number;
  edgeCount: number;
}

export interface FlowInstaller {
  /** §3 冻结组件级接口：installFlow(steps, name)——脏闸→回放→瀑布→flows.create→切换 */
  installFlow(steps: FlowSteps, name: string): Promise<FlowInstallResult>;
}

let nodeSeq = 0;
function newFlowNodeId(type: string): string {
  return `fn-${type.replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}-${(nodeSeq++).toString(36)}`;
}
let edgeSeq = 0;
function newFlowEdgeId(): string {
  return `fe-${Date.now().toString(36)}-${(edgeSeq++).toString(36)}`;
}

export function createFlowInstaller(deps: FlowInstallerDeps): FlowInstaller {
  const placer = createWaterfallPlacer({ viewportCenter: deps.viewportCenter });
  return {
    async installFlow(steps, name) {
      // ———— ① 脏闸前置（demo L3066：dirty→先保存或取消）————
      if (!deps.canvasSink.guardDirty('market:installFlow')) {
        deps.notify?.('err', '有未保存改动 — 先保存或取消');
        deps.log?.('[market] flow 安装被脏闸拒绝（02 §3.3）');
        throw new FlowDirtyRefusedError();
      }
      if (steps.length === 0) {
        // 空流程拒绝（zip:export 空流程同源语义——不落库不切换）
        deps.notify?.('err', '空流程不可安装（steps 为空）');
        throw new Error('空流程不可安装（steps 为空）');
      }

      // ———— ② FlowSteps 回放：steps→nodes＋显式 edges（BFS 拓扑序线性链 i→i+1，
      //     端口 out/in——demo genFlow L2185 同构）＋WaterfallPlacer 坐标 ————
      const positions = placer.positions(steps.length);
      const nodes: FlowNode[] = steps.map((s, i) => ({
        id: newFlowNodeId(s[0]),
        type: s[0],
        name: s[1],
        position: positions[i]!,
        params: { ...s[2] },
      }));
      const edges: FlowEdge[] = [];
      for (let i = 1; i < nodes.length; i++) {
        edges.push({
          id: newFlowEdgeId(),
          from: [nodes[i - 1]!.id, 'out'],
          to: [nodes[i]!.id, 'in'],
        });
      }

      // ———— ③ flows.create（C-06 落库——真通道面）＋④ 落节点＋createAndSwitch 切换
      //     （doc 承载 nodes/edges——T3-08 冻结签名，注入 seam）————
      const created = (await deps.storageInvoke({ op: 'flows.create', args: { name } })) as { id?: string };
      if (created === null || typeof created !== 'object' || typeof created.id !== 'string') {
        throw new Error('flows.create 响应形不符（应回 {id}——C-06 面）');
      }
      const switchId = await deps.flowSwitcher.createAndSwitch(name, { name, nodes, edges });

      // ———— ⑤ toast（demo L3064-3069：流程「name」已安装到我的流程）————
      deps.notify?.('ok', `流程「${name}」已安装到我的流程`);
      deps.log?.(`[market] flow 安装 ${name}（${nodes.length} 节点/${edges.length} 边）→ flowId=${created.id}（switch=${switchId}）`);
      return { flowId: created.id, nodeCount: nodes.length, edgeCount: edges.length };
    },
  };
}
