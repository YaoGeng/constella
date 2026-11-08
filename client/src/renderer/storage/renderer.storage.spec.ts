// renderer 四件套件（T1-08 验收；C-06 §6.2；vitest + fake timers）。
// 断言面：storageClient 薄封装（req 组装/结果透传）；IpcDefinitionStore 委托；
// SaveOrchestrator doSave 成功 → onSaved 恰一次（label 映射/首存建流程/失败不回调）；
// AutoSaveScheduler：markDirty 两次间隔 300ms → 保存恰 1 次（800ms 防抖合并）；
// autoSave=false → 0 次；flush 冲刷恰一次不双触发。
// 通道 handler 归 C-M1（P4）——本套件以注入式 bridge mock 验收（区头 ⚠①）。
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { StorageInvokeReq, FlowDoc } from '@constella/shared/ipc';
import { createStorageClient, type StorageBridge } from './storage-client';
import { IpcDefinitionStore } from './ipc-definition-store';
import { createSaveOrchestrator } from './save-orchestrator';
import { AutoSaveScheduler } from './auto-save-scheduler';

function mockBridge() {
  const calls: StorageInvokeReq[] = [];
  const handlers = new Map<string, (req: StorageInvokeReq) => unknown>();
  const bridge: StorageBridge = {
    invoke: async (req) => {
      calls.push(req);
      const h = handlers.get(req.op);
      if (h === undefined) throw new Error(`mock bridge 未注册 op：${req.op}`);
      return h(req);
    },
  };
  return { calls, on: (op: string, h: (req: StorageInvokeReq) => unknown) => handlers.set(op, h), bridge };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('renderer storageClient（薄封装）', () => {
  it('无参 op：req={op}；有参 op：req={op,args}；结果原样透传', async () => {
    const { calls, on, bridge } = mockBridge();
    on('flows.list', () => ({ items: [{ id: 'f1', name: '一', orderIdx: 1, createdAt: 1, updatedAt: 1 }] }));
    on('flows.get', () => ({ id: 'f1', name: '一', nodes: [], edges: [] }));
    const client = createStorageClient(bridge);

    const list = await client.invoke('flows.list', undefined);
    expect(list.items[0]?.name).toBe('一');
    const doc = await client.invoke('flows.get', { id: 'f1' });
    expect(doc.id).toBe('f1');
    expect(calls).toEqual([
      { op: 'flows.list' },
      { op: 'flows.get', args: { id: 'f1' } },
    ]);
  });

  it('bridge 抛错 → invoke reject（错误面由 C-M1 统一序列化，本层不吞）', async () => {
    const { on, bridge } = mockBridge();
    on('settings.getAll', () => {
      throw new Error('VALIDATION-FAILED: 坏参');
    });
    const client = createStorageClient(bridge);
    await expect(client.invoke('settings.getAll', undefined)).rejects.toThrow(/VALIDATION-FAILED/);
  });
});

describe('renderer IpcDefinitionStore（async 定稿）', () => {
  it('loadAllDefinitions/upsertDefinition 委托 definitions 域 op', async () => {
    const { calls, on, bridge } = mockBridge();
    on('definitions.loadAll', () => [{ type: 'delay', kind: 'builtin' }]);
    on('definitions.upsert', () => undefined);
    const store = new IpcDefinitionStore(createStorageClient(bridge));
    const all = await store.loadAllDefinitions();
    expect(all).toEqual([{ type: 'delay', kind: 'builtin' }]);
    await store.upsertDefinition({
      type: 'custom.x',
      kind: 'custom',
      meta: { name: 'X', icon: 'x', category: '数据' },
      ports: { ins: [], outs: [{ id: 'out', label: '出' }] },
      paramsSchema: [],
      exec: null,
      version: '1.0.0',
      packageVersion: '1.0.0',
    });
    expect(calls[1]?.op).toBe('definitions.upsert');
  });
});

describe('renderer SaveOrchestrator', () => {
  const docOf = (id?: string): FlowDoc => ({
    id,
    name: '流程',
    nodes: [{ id: 'n1', type: 'delay', name: '等', position: { x: 0, y: 0 }, params: {} }],
    edges: [],
  });

  it('doSave 成功 → onSaved 恰一次（携 versionId）；silent=false → 手动保存', async () => {
    const { on, bridge } = mockBridge();
    const saves: Array<{ label: string; id: string }> = [];
    on('flows.save', (req) => {
      const a = (req as { args: { label: string; id: string } }).args;
      saves.push({ label: a.label, id: a.id });
      return { versionId: 'v-9' };
    });
    const orch = createSaveOrchestrator(createStorageClient(bridge));
    const onSaved = vi.fn();
    await orch.doSave(false, { serialize: () => docOf('f1'), onSaved });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('v-9');
    expect(saves).toEqual([{ label: '手动保存', id: 'f1' }]);
  });

  it('silent=true → 自动保存；无 id 画布首存 → 先 flows.create 再 save（create 的 id 入参）', async () => {
    const { calls, on, bridge } = mockBridge();
    on('flows.create', () => ({ id: 'brand-new' }));
    on('flows.save', (req) => {
      const a = (req as { args: { label: string; id: string } }).args;
      return { versionId: `v-for-${a.id}` };
    });
    const orch = createSaveOrchestrator(createStorageClient(bridge));
    const onSaved = vi.fn();
    await orch.doSave(true, { serialize: () => docOf(undefined), onSaved });
    expect(onSaved).toHaveBeenCalledWith('v-for-brand-new');
    expect(calls.map((c) => c.op)).toEqual(['flows.create', 'flows.save']);
    expect((calls[1] as { args: { label: string } }).args.label).toBe('自动保存');
    expect((calls[1] as { args: { id: string } }).args.id).toBe('brand-new');
  });

  it('save 失败 → onSaved 不触发、错误上抛（基线不动）', async () => {
    const { on, bridge } = mockBridge();
    on('flows.save', () => {
      throw new Error('FLOW-NOT-FOUND');
    });
    const orch = createSaveOrchestrator(createStorageClient(bridge));
    const onSaved = vi.fn();
    await expect(orch.doSave(false, { serialize: () => docOf('gone'), onSaved })).rejects.toThrow(
      /FLOW-NOT-FOUND/,
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('renderer AutoSaveScheduler（800ms 防抖＋门控＋flush）', () => {
  it('markDirty 两次间隔 300ms → 保存恰 1 次（防抖合并；demo L1311）', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const sched = new AutoSaveScheduler({ isEnabled: () => true, onSave });
    sched.schedule(); // t=0 markDirty
    vi.advanceTimersByTime(300);
    sched.schedule(); // t=300 markDirty（重置防抖窗）
    expect(sched.isPending).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500); // t=800（第二次标记后 500ms，未满新窗）
    expect(onSave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300); // t=1100 ≥ 300+800 → 触发一次
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(sched.isPending).toBe(false);
  });

  it('autoSave=false → schedule 拒排程、0 次保存；pending 期关门同样不保存', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const sched = new AutoSaveScheduler({ isEnabled: () => false, onSave });
    sched.schedule();
    vi.advanceTimersByTime(5000);
    expect(onSave).not.toHaveBeenCalled();
    expect(sched.isPending).toBe(false);
  });

  it('门控中途关闭：pending 定时器触发时二次核验 → 不保存', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    let enabled = true;
    const sched = new AutoSaveScheduler({ isEnabled: () => enabled, onSave });
    sched.schedule();
    enabled = false; // 排程后设置被关掉
    vi.advanceTimersByTime(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flush：pending 即刻保存恰一次（不双触发）；无 pending 无动作；错误上抛', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const sched = new AutoSaveScheduler({ isEnabled: () => true, onSave });
    sched.schedule();
    await sched.flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000); // 原定时器已取消——不再触发
    expect(onSave).toHaveBeenCalledTimes(1);
    await sched.flush(); // 无 pending
    expect(onSave).toHaveBeenCalledTimes(1);

    const boom = new AutoSaveScheduler({
      isEnabled: () => true,
      onSave: () => {
        throw new Error('保存炸了');
      },
    });
    boom.schedule();
    await expect(boom.flush()).rejects.toThrow(/保存炸了/);
  });

  it('cancel：取消 pending 不保存', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const sched = new AutoSaveScheduler({ isEnabled: () => true, onSave });
    sched.schedule();
    sched.cancel();
    vi.advanceTimersByTime(5000);
    expect(onSave).not.toHaveBeenCalled();
  });
});
