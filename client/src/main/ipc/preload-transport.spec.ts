// preload 真面传输径用例（T4-14 / TDD-C-M1 §1 preload 面＋§1 错误序列化铁律段）。
//
// 断言面：
//   - preload 暴露键白名单 ≡ IPC_CHANNELS（24 通道＝21 invoke＋3 推送；§6.6 三方一致性之运行时半段，
//     静态半段=scripts/check-ipc-surface.mjs）；
//   - invoke 键 → ipcRenderer.invoke(通道全名, payload)；推送键 → ipcRenderer.on(通道全名)＋退订；
//   - 错误序列化恢复：Electron invoke reject 的 `Error invoking remote method '<ch>': ` 前缀消息
//     （45.2.3 实证：reject 值经 String 摊平——网关端已编码 JSON，preload 剥前缀+解析）→
//     renderer 收恰 {code,message}，前缀不泄漏（§6.5b）；
//   - →补跑 T1-08 分步一（C-06 §6.2 传输径/错误序列化——bridge mock→preload 真面）：
//     storageClient 经真 preload 面过通道层用例；storage:invoke 31 op 全量往返随 T4-20 handler
//     挂载收口（05 T4-14 卡验收行分步留痕）。
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS, IPC_PUSH_CHANNELS } from '@constella/shared/ipc';
import {
  createConstellaApi,
  normalizeIpcRejection,
  type IpcRendererLike,
} from '../../preload/api';
import { createStorageClient } from '../../renderer/storage/storage-client';
import { IpcGateway } from './ipc-gateway';
import { registerAppRuntimeChannels } from '../runtime/domain-channels';
import { createLoopMockElectron } from './testing/ipc-loop';

// ————————————————————————————————————————————
// 暴露键白名单（≡ IPC_CHANNELS）
// ————————————————————————————————————————————

/** 记录型 ipcRenderer 面（不接 main——只断言 preload 侧发出的通道名/载荷） */
function recordingIpcRenderer() {
  const invoked: Array<{ channel: string; payload: unknown }> = [];
  const listened: string[] = [];
  const removed: string[] = [];
  const ipcRenderer: IpcRendererLike = {
    invoke: async (channel, payload) => {
      invoked.push({ channel, payload });
      return undefined;
    },
    send: () => {},
    on: (channel) => {
      listened.push(channel);
    },
    removeListener: (channel) => {
      removed.push(channel);
    },
  };
  return { ipcRenderer, invoked, listened, removed };
}

describe('preload 暴露键白名单（≡ IPC_CHANNELS ≡ 02 §3.4 全集 24 通道）', () => {
  it('Object.keys(window.constella) ≡ Object.keys(IPC_CHANNELS)（24，无多无缺）', () => {
    const { ipcRenderer } = recordingIpcRenderer();
    const api = createConstellaApi(ipcRenderer);
    expect(Object.keys(api).sort()).toEqual(Object.keys(IPC_CHANNELS).sort());
    expect(Object.keys(api)).toHaveLength(24);
  });

  it('21 r→m invoke 键逐一发 ipcRenderer.invoke(通道全名, payload)', async () => {
    const { ipcRenderer, invoked } = recordingIpcRenderer();
    const api = createConstellaApi(ipcRenderer);
    await api.appVersion();
    await api.envSystemInfo();
    await api.envCdpProbe();
    await api.shellOpenExternal({ url: 'https://example.com/' });
    await api.dialogOpenFile({});
    await api.dialogSaveFile({ defaultName: 'a.zip' });
    await api.storageInvoke({ op: 'flows.list' });
    await api.secretSet({ key: 'ai.apiKey' });
    await api.secretGet({ key: 'ai.apiKey' });
    await api.secretDel({ key: 'ai.apiKey' });
    await api.runSpawnScript({
      nodeRunId: 'nr-1',
      lang: 'ts',
      scriptPath: 'node-types/x/main.ts',
      entry: 'run',
      params: {},
      input: null,
      timeoutMs: 0,
      retries: 0,
    });
    await api.runKillScript({ nodeRunId: 'nr-1' });
    await api.cdpCreateSession({ runId: 'r1', laneKey: 'f1·lane-主', label: '主', startUrl: 'https://a.example/' });
    await api.cdpNavigate({ runId: 'r1', laneKey: 'f1·lane-主', url: 'https://a.example/' });
    await api.cdpListSessions({ runId: 'r1' });
    await api.cdpOpenViewer({ runId: 'r1', laneKey: 'f1·lane-主' });
    await api.cdpDestroyRun({ runId: 'r1' });
    await api.cronUpsert({ flowId: 'f1', cron: '0 20 * * *' });
    await api.cronCancel({ flowId: 'f1' });
    await api.zipExport({ flowId: 'f1', savePath: 'C:\\a.zip' });
    await api.zipImport({ path: 'C:\\a.zip', phase: 'inspect' });
    expect(invoked.map((c) => c.channel).sort()).toEqual([...IPC_INVOKE_CHANNELS].sort());
  });

  it('3 m→r 推送键订阅 ipcRenderer.on(通道全名)；退订 removeListener', () => {
    const { ipcRenderer, listened, removed } = recordingIpcRenderer();
    const api = createConstellaApi(ipcRenderer);
    const off1 = api.runScriptEvent(() => {});
    const off2 = api.cronFired(() => {});
    const off3 = api.appConfirmClose(() => ({ dirty: false }));
    expect(listened.sort()).toEqual([...IPC_PUSH_CHANNELS].sort());
    off1();
    off2();
    off3();
    expect(removed.sort()).toEqual([...IPC_PUSH_CHANNELS].sort());
  });
});

// ————————————————————————————————————————————
// 错误序列化恢复（无 `Error invoking remote method` 前缀泄漏）
// ————————————————————————————————————————————

describe('错误序列化恢复（§1 铁律 renderer 半段——前缀不泄漏）', () => {
  it('结构化透传径：{code,message} 普通对象 reject → 原样（恰二键）', () => {
    expect(normalizeIpcRejection({ code: 'ZIP-INVALID', message: 'zip 无效' })).toEqual({
      code: 'ZIP-INVALID',
      message: 'zip 无效',
    });
  });

  it('Electron 前缀径：前缀消息内嵌 JSON → 剥前缀+解析 → 恰 {code,message}', () => {
    const json = JSON.stringify({ code: 'FLOW-NOT-FOUND', message: '流程不存在：f1' });
    expect(
      normalizeIpcRejection(
        new Error(`Error invoking remote method 'constella:storage:invoke': ${json}`),
      ),
    ).toEqual({ code: 'FLOW-NOT-FOUND', message: '流程不存在：f1' });
  });

  it('Electron 原生错误（无 JSON——如 No handler registered）→ {code:"INTERNAL", message=剥前缀原文}', () => {
    expect(
      normalizeIpcRejection(new Error("Error invoking remote method 'constella:secret:get': No handler registered for 'constella:secret:get'")),
    ).toEqual({
      code: 'INTERNAL',
      message: "No handler registered for 'constella:secret:get'",
    });
  });
});

// ————————————————————————————————————————————
// 全链传输环（ipcRenderer ↔ ipcMain，Electron 实证语义：reject 值经 String 摊平进前缀消息）
// ————————————————————————————————————————————

describe('全链真面（preload api ↔ IpcGateway ↔ handler；ipc-loop 按 Electron 实证语义摊平 reject）', () => {
  it('成功径：appVersion 经真 preload 面 → AppRuntime handler 结果原样回传', async () => {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    registerAppRuntimeChannels(
      { app: loop.app, dialog: loop.dialog, shell: loop.shell, ownerWindow: () => undefined, laneMemory: () => [] },
      gateway,
    );
    const api = createConstellaApi(loop.ipcRenderer);
    const res = await api.appVersion();
    expect(res).toEqual({
      app: '0.0.0-mock',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    });
  });

  it('错误径：handler 抛业务错误 → renderer 收恰 {code,message}（无前缀泄漏——摊平径上恢复）', async () => {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    gateway.register(IPC_CHANNELS.storageInvoke, () => {
      const e = new Error('流程不存在：f1');
      (e as { code?: string }).code = 'FLOW-NOT-FOUND';
      throw e;
    });
    const api = createConstellaApi(loop.ipcRenderer);
    const rejection = await api.storageInvoke({ op: 'flows.get', args: { id: 'f1' } }).catch((e: unknown) => e);
    expect(rejection).toEqual({ code: 'FLOW-NOT-FOUND', message: '流程不存在：f1' });
    expect(JSON.stringify(rejection)).not.toContain('Error invoking remote method');
  });

  it('校验径：坏 payload 经真面 → {code:"VALIDATION-FAILED"}', async () => {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    gateway.register(IPC_CHANNELS.dialogSaveFile, () => ({ path: null }));
    const api = createConstellaApi(loop.ipcRenderer);
    await expect(api.dialogSaveFile({ defaultName: 42 } as never)).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
  });
});

// ————————————————————————————————————————————
// →补跑 T1-08 分步一（C-06 §6.2 传输径/错误序列化：bridge mock → preload 真面）
// ————————————————————————————————————————————

describe('T1-08 补跑·分步一：storageClient 经 preload 真面（31 op 全量往返随 T4-20 handler 挂载收口）', () => {
  /** T4-20 StorageService handler 的分步替身：按 op 回 canned 结果（通道层全真——preload 面+网关校验） */
  function bootRealFaceStorage(handlerImpl: (req: { op: string; args?: unknown }) => unknown) {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    gateway.register(IPC_CHANNELS.storageInvoke, (payload) => handlerImpl(payload as { op: string; args?: unknown }));
    const api = createConstellaApi(loop.ipcRenderer);
    // renderer 真面 bridge：window.constella.storage.invoke ↔ StorageBridge（生产装配点一行接线，本套内联）
    const client = createStorageClient({ invoke: (req) => api.storageInvoke(req) });
    return { client };
  }

  it('传输径：无参 op req={op}／有参 op req={op,args}——req 形与结果透传（C-06 §6.2 口径）', async () => {
    const seen: unknown[] = [];
    const { client } = bootRealFaceStorage((req) => {
      seen.push(req);
      if (req.op === 'flows.list') return { items: [{ id: 'f1', name: '一', orderIdx: 1, createdAt: 1, updatedAt: 1 }] };
      return { id: 'f1', name: '一', nodes: [], edges: [] };
    });
    const list = await client.invoke('flows.list', undefined);
    expect(list.items[0]?.name).toBe('一');
    const doc = await client.invoke('flows.get', { id: 'f1' });
    expect(doc.id).toBe('f1');
    expect(seen).toEqual([{ op: 'flows.list' }, { op: 'flows.get', args: { id: 'f1' } }]);
  });

  it('错误序列化：handler 抛 DAO 业务码 → invoke reject 恰 {code,message}（错误面由 C-M1 统一序列化——mock 时代断言的 toThrow 升格为 {code,message}）', async () => {
    const { client } = bootRealFaceStorage(() => {
      const e = new Error('流程不存在：gone');
      (e as { code?: string }).code = 'FLOW-NOT-FOUND';
      throw e;
    });
    const rejection = await client.invoke('flows.get', { id: 'gone' }).catch((e: unknown) => e);
    expect(rejection).toEqual({ code: 'FLOW-NOT-FOUND', message: '流程不存在：gone' });
    expect(JSON.stringify(rejection)).not.toContain('Error invoking remote method');
  });

  it('错误序列化：VALIDATION-FAILED 经真面（op 非 string——通道级形状校验）', async () => {
    const { client } = bootRealFaceStorage(() => null);
    await expect(client.invoke('flows.list' as never, undefined as never)).resolves.toBeNull();
    const rejection = await (client as unknown as {
      invoke: (op: unknown, args: unknown) => Promise<unknown>;
    }).invoke(42, undefined).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ code: 'VALIDATION-FAILED' });
  });

  it('分步边界注记：storage:invoke 31 op 全量往返不在本步——handler 本体归 T4-20（StorageService 桥接）', () => {
    // 留痕用例：本卡业务 handler 不实装（卡面边界）——T4-20 挂载真 StorageOpsRegistry 后全量复跑。
    expect(IPC_CHANNELS.storageInvoke).toBe('constella:storage:invoke');
  });
});
