// ExportOrchestrator（renderer 导出编排面；T5-06 / TDD-C-08 §3 组件行＋§1 接口）——
// `vitest run zip-pipeline` 过滤面随行。编排语义：空流程拒绝（demo L2575）/dialog:saveFile
// 默认名 constella-<流程名>.zip（demo L2598）/取消=in-band {path:null}（02 §3.4）→
// 经 zip:export 通道（payload 双变体——02 v1.0b）调 main 组装写盘。
import { describe, expect, it, vi } from 'vitest';
import type { FlowDoc, SaveFileRes, ZipExportReq, ZipExportRes } from '@constella/shared/ipc';
import { createExportOrchestrator, ExportCancelledError, type ZipExportBridge } from './export-orchestrator';

function makeBridge(opts: {
  flow?: FlowDoc;
  saveRes?: SaveFileRes;
  exportRes?: ZipExportRes;
} = {}): ZipExportBridge & { saveFileCalls: unknown[]; exportCalls: ZipExportReq[] } {
  const saveFileCalls: unknown[] = [];
  const exportCalls: ZipExportReq[] = [];
  return {
    saveFileCalls,
    exportCalls,
    storageInvoke: vi.fn(async (req: { op: string }) => {
      if (req.op === 'flows.get') return opts.flow;
      throw new Error(`unexpected op ${req.op}`);
    }),
    dialogSaveFile: vi.fn(async (req?: { defaultName?: string }) => {
      saveFileCalls.push(req);
      return opts.saveRes ?? { path: 'C:\\out\\pkg.zip' };
    }),
    zipExport: vi.fn(async (payload: ZipExportReq) => {
      exportCalls.push(payload);
      return opts.exportRes ?? { file: 'C:\\out\\pkg.zip', count: 3, scripts: [] };
    }),
  };
}

const flowOf = (nodes: FlowDoc['nodes']): FlowDoc => ({ id: 'f1', name: '小红书采集', nodes, edges: [] });

describe('ExportOrchestrator——exportFlow（§1 接口冻结形）', () => {
  it('空流程拒绝（demo L2575 文案）——不弹保存对话框、不调通道', async () => {
    const bridge = makeBridge({ flow: flowOf([]) });
    const orch = createExportOrchestrator(bridge);
    await expect(orch.exportFlow('f1')).rejects.toThrow('当前流程没有节点可导出');
    expect(bridge.saveFileCalls).toHaveLength(0);
    expect(bridge.exportCalls).toHaveLength(0);
  });

  it('dialog:saveFile 默认名 constella-<流程名>.zip（非法字符→_）；payload={flowId,savePath}', async () => {
    const bridge = makeBridge({ flow: { ...flowOf([{ id: 'n1', type: 'trigger.manual', name: '手动', position: { x: 0, y: 0 }, params: {} }]), name: '采集/夜间"批"' } });
    const orch = createExportOrchestrator(bridge);
    const res = await orch.exportFlow('f1');
    expect(bridge.saveFileCalls).toEqual([{ defaultName: 'constella-采集_夜间_批_.zip' }]);
    expect(bridge.exportCalls).toEqual([{ flowId: 'f1', savePath: 'C:\\out\\pkg.zip' }]);
    expect(res).toEqual({ file: 'C:\\out\\pkg.zip', count: 3, scripts: [] });
  });

  it('用户取消（{path:null} in-band）→ExportCancelledError', async () => {
    const bridge = makeBridge({
      flow: flowOf([{ id: 'n1', type: 'trigger.manual', name: '手动', position: { x: 0, y: 0 }, params: {} }]),
      saveRes: { path: null },
    });
    const orch = createExportOrchestrator(bridge);
    const err = await orch.exportFlow('f1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportCancelledError);
    expect((err as ExportCancelledError).cancelled).toBe(true);
    expect(bridge.exportCalls).toHaveLength(0);
  });
});

describe('ExportOrchestrator——exportPackage（发布打包变体，C-09 Publisher 消费）', () => {
  it('空勾选拒绝；默认名 constella-<meta.name>.zip；payload={types[],savePath,meta}', async () => {
    const bridge = makeBridge({ exportRes: { filePath: 'C:\\out\\pkg.zip', checksum: 'a'.repeat(64) } });
    const orch = createExportOrchestrator(bridge);
    await expect(orch.exportPackage([], { name: '空' })).rejects.toThrow('未勾选任何节点类型');
    expect(bridge.saveFileCalls).toHaveLength(0);

    const res = await orch.exportPackage(['xhs.search', 'ai.summarize'], { name: '社媒工具包' });
    expect(bridge.saveFileCalls).toEqual([{ defaultName: 'constella-社媒工具包.zip' }]);
    expect(bridge.exportCalls).toEqual([
      { types: ['xhs.search', 'ai.summarize'], savePath: 'C:\\out\\pkg.zip', meta: { name: '社媒工具包' } },
    ]);
    expect(res).toEqual({ filePath: 'C:\\out\\pkg.zip', checksum: 'a'.repeat(64) });
  });

  it('取消→ExportCancelledError；readonly types 原样展开传通道', async () => {
    const bridge = makeBridge({ saveRes: { path: null } });
    const orch = createExportOrchestrator(bridge);
    await expect(orch.exportPackage(['x'], { name: 'X' })).rejects.toBeInstanceOf(ExportCancelledError);
    expect(bridge.exportCalls).toHaveLength(0);
  });
});

describe('ExportOrchestrator——变体响应防串（通道联合面）', () => {
  it('流程变体收到打包响应形→ INTERNAL 防串错（通道双变体联合的编排侧收窄）', async () => {
    const bridge = makeBridge({
      flow: flowOf([{ id: 'n1', type: 'trigger.manual', name: '手动', position: { x: 0, y: 0 }, params: {} }]),
      exportRes: { filePath: 'x', checksum: 'y' }, // 错形：main 按变体回——编排侧仍防御
    });
    const orch = createExportOrchestrator(bridge);
    await expect(orch.exportFlow('f1')).rejects.toThrow(/zip:export 响应变体不符/);
  });
});
