// ExportOrchestrator —— renderer 导出编排面（T5-06 / TDD-C-08 §3 组件行＋§1 接口冻结形）。
//
// 编排职责：空流程拒绝（demo L2575）/dialog:saveFile 默认名 constella-<流程名>.zip（demo
// L2598）/经 zip:export 通道调 main（组装四件套＋store 档写盘在 main——§1 通道表；secret
// 剥离/nodes 剥离 id·noScript/deps 按语言同在 main 执行，payload 冻结 {flowId,savePath} /
// {types[],savePath,meta} 不携带清单）。取消=dialog in-band {path:null}（02 §3.4）→
// ExportCancelledError（非静默；装配点/header 按 cancelled 消化不弹错）。
// importArchive 归 T5-07（ImportOrchestrator 同域落位）——本文件不预留空壳。
//
// P-3：bridge=注入式 IPC 面（同 storage-client/secret-param-binder 惯例——生产装配点传
// window.constella 子集，测试传 mock）；本面零 zip 库依赖（§6.8 读写收窄 main）。
import type {
  FlowDoc,
  SaveFileReq,
  SaveFileRes,
  StorageInvokeReq,
  ZipExportReq,
  ZipExportRes,
} from '@constella/shared/ipc';
import type { ScriptRef } from '@constella/shared/manifest';

/** 导出编排 IPC 面（window.constella 子集——装配点直传 preload API） */
export interface ZipExportBridge {
  /** storage:invoke（flows.get——空流程拒绝＋默认文件名取流程名） */
  storageInvoke(req: StorageInvokeReq): Promise<unknown>;
  /** dialog:saveFile（in-band 取消 {path:null}，02 §3.4） */
  dialogSaveFile(req?: SaveFileReq): Promise<SaveFileRes>;
  /** zip:export（payload 双变体，02 v1.0b） */
  zipExport(payload: ZipExportReq): Promise<ZipExportRes>;
}

/** 用户取消导出（dialog in-band 取消——编排面向 UI 的显式信号，非错误弹窗面） */
export class ExportCancelledError extends Error {
  readonly cancelled = true;
  constructor() {
    super('已取消导出');
    this.name = 'ExportCancelledError';
  }
}

/** demo L2579 同则：非法文件名字符→_（中文名保留） */
function safeFileStem(name: string): string {
  return (name || 'export').replace(/[\\/:*?"<>|]/g, '_') || 'export';
}

export interface ExportOrchestrator {
  /** 流程导出（§1：`exportFlow(flowId)` → {file,count,scripts}） */
  exportFlow(flowId: string): Promise<{ file: string; count: number; scripts: ScriptRef[] }>;
  /** 发布打包变体（§1：勾选节点集→四件套 zip＋SHA-256——C-09 Publisher 消费） */
  exportPackage(types: readonly string[], meta: { name: string }): Promise<{ filePath: string; checksum: string }>;
  /** ✅ 02 v1.0f（T5-11）：发布打包**字节变体**——不落盘不弹对话框，multipart 免文件读回；
   * bytes/_checksum（`sha256:<hex>`）＝上传体与幂等键——C-09 Publisher 消费 */
  exportPackageBytes(
    types: readonly string[],
    meta: { name: string },
  ): Promise<ExportBytesOutcome>;
  /** ✅ 02 v1.0f（T5-11）：流程导出**字节变体**——BFS 拓扑序物化（FlowSteps 序列化语义，
   * 安装端 T5-10 已按此形冻结）——flow 发布产物上传链消费 */
  exportFlowBytes(flowId: string): Promise<ExportBytesOutcome>;
}

/** 字节变体产物（＝X-01 ZipExportBytesRes 消费面收窄） */
export interface ExportBytesOutcome {
  bytes: Uint8Array;
  count: number;
  scripts: ScriptRef[];
  /** zip 内容 SHA-256（`sha256:<hex>` 形——server 幂等键对端） */
  checksum: string;
}

export function createExportOrchestrator(
  bridge: ZipExportBridge,
  opts: { log?: (...args: unknown[]) => void } = {},
): ExportOrchestrator {
  const askSavePath = async (defaultName: string): Promise<string> => {
    const res = await bridge.dialogSaveFile({ defaultName });
    if (res.path === null) throw new ExportCancelledError();
    return res.path;
  };

  return {
    async exportFlow(flowId) {
      const flow = (await bridge.storageInvoke({ op: 'flows.get', args: { id: flowId } })) as FlowDoc;
      if (flow.nodes.length === 0) throw new Error('当前流程没有节点可导出'); // demo L2575 文案
      const savePath = await askSavePath(`constella-${safeFileStem(flow.name)}.zip`);
      const res = await bridge.zipExport({ flowId, savePath });
      if (!('file' in res)) throw new Error('zip:export 响应变体不符（流程变体应回 {file,count,scripts}）');
      opts.log?.(`[zip] 已导出「${flow.name}」：${res.count} 个节点 → ${res.file}`);
      return res;
    },

    async exportPackage(types, meta) {
      if (types.length === 0) throw new Error('未勾选任何节点类型——发布打包需至少一个类型');
      const savePath = await askSavePath(`constella-${safeFileStem(meta.name)}.zip`);
      const res = await bridge.zipExport({ types: [...types], savePath, meta: { name: meta.name } });
      // v1.0f 后 checksum 不再是盘/字节判别键（字节变体同带 checksum）——filePath 面
      if (!('filePath' in res)) throw new Error('zip:export 响应变体不符（打包变体应回 {filePath,checksum}）');
      opts.log?.(`[zip] 已打包「${meta.name}」→ ${res.filePath}（checksum=${res.checksum}）`);
      return res;
    },

    async exportPackageBytes(types, meta) {
      if (types.length === 0) throw new Error('未勾选任何节点类型——发布打包需至少一个类型');
      const res = await bridge.zipExport({ types: [...types], meta: { name: meta.name } });
      if (!('bytes' in res)) throw new Error('zip:export 响应变体不符（字节变体应回 {bytes,count,scripts,checksum}）');
      opts.log?.(`[zip] 已打包「${meta.name}」→ ${res.bytes.byteLength}B（checksum=${res.checksum}）`);
      return res;
    },

    async exportFlowBytes(flowId) {
      const res = await bridge.zipExport({ flowId });
      if (!('bytes' in res)) throw new Error('zip:export 响应变体不符（字节变体应回 {bytes,count,scripts,checksum}）');
      opts.log?.(`[zip] 流程字节产物 ${flowId} → ${res.bytes.byteLength}B（BFS 序 ${res.count} 节点）`);
      return res;
    },
  };
}
