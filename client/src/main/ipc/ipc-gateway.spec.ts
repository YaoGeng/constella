// IpcGateway 骨架用例（T4-14 / TDD-C-M1 §3 IpcGateway 行＋§1 错误序列化铁律段）。
//
// 断言面（§6.5b＋§6.6 前半）：
//   - 注册基座：21 r→m invoke 通道白名单可注册、白名单外/推送通道经 register 拒绝、重复注册拒绝；
//   - payload 校验（源型=X-01 9 域 payload；失败复用 02 §6.1 VALIDATION-FAILED）；
//   - 错误序列化铁律：handler 抛错 → reject 恰 {code,message}（裸 Error/堆栈不穿 contextBridge）；
//   - m→r 推送 sender 面（3 推送通道；fire-and-forget 无错误语义）；
//   - zip:* 装配位（handler 骨架随 T4-20、管线注入随 C-08〔P5〕——本卡仅注册面可挂＋两段式 payload 校验）。
// electron 用 mock（卡面口径；真 electron 头跑归 T4-18/T4-20）。
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '@constella/shared/ipc';
import { IpcGateway } from './ipc-gateway';
import { serializeError } from './serialize-error';
import { DomainChannelError, registerAppRuntimeChannels } from '../runtime/domain-channels';
import { AppRuntime } from '../runtime/app-runtime';
import { createMockElectron } from '../runtime/testing/mock-electron';

/** 业务错误同构形（Error+string code——DomainChannelError/StorageError 共形，C-M1 §1「业务码透传」） */
class FakeServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function makeGateway(
  webContents?: () => Pick<{ send: (channel: string, ...args: unknown[]) => void }, 'send'> | undefined,
) {
  const mock = createMockElectron();
  const gateway = new IpcGateway({
    ipcMain: mock.ipcMain,
    ...(webContents ? { webContents } : {}),
  });
  return { mock, gateway };
}

describe('IpcGateway 注册基座（24 通道冻结白名单，02 §3.4）', () => {
  it('21 r→m invoke 通道全量可注册且经 ipcMain.handle 挂载', () => {
    const { mock, gateway } = makeGateway();
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (channel === IPC_CHANNELS.runScriptEvent || channel === IPC_CHANNELS.cronFired) continue;
      if (channel === IPC_CHANNELS.appConfirmClose) continue;
      gateway.register(channel, () => ({ ok: true }));
    }
    // 21 通道（3 推送除外）恰全挂载——mock ipcMain 的 handlers 键集核对
    const invokeChannels = Object.values(IPC_CHANNELS).filter(
      (c) => c !== IPC_CHANNELS.runScriptEvent && c !== IPC_CHANNELS.cronFired && c !== IPC_CHANNELS.appConfirmClose,
    );
    expect(invokeChannels).toHaveLength(21);
    for (const c of invokeChannels) expect(mock.ipcMain.handlers.has(c)).toBe(true);
    expect(mock.ipcMain.handlers.size).toBe(21);
  });

  it('invoke 往返：注册的 handler 收到校验后 payload、结果原样回传', async () => {
    const { mock, gateway } = makeGateway();
    const seen: unknown[] = [];
    gateway.register(IPC_CHANNELS.runKillScript, (payload) => {
      seen.push(payload);
      return { ok: true };
    });
    const res = await mock.ipcMain.invoke(IPC_CHANNELS.runKillScript, { nodeRunId: 'nr-1' });
    expect(res).toEqual({ ok: true });
    expect(seen).toEqual([{ nodeRunId: 'nr-1' }]);
  });

  it('白名单外通道 register → main 侧装配错误（通道名冻结，不得新增/改名）', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.register('constella:evil:ping', () => null)).toThrow(/白名单/);
    expect(() => gateway.register('constella:app:version2' as never, () => null)).toThrow(/白名单/);
  });

  it('m→r 推送通道不得经 register 注册（方向面分离）', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.register(IPC_CHANNELS.runScriptEvent as never, () => null)).toThrow(/推送/);
    expect(() => gateway.register(IPC_CHANNELS.cronFired as never, () => null)).toThrow(/推送/);
    expect(() => gateway.register(IPC_CHANNELS.appConfirmClose as never, () => null)).toThrow(/推送/);
  });

  it('重复注册拒绝（同 ipcMain.handle 语义）', () => {
    const { gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.cronCancel, () => ({ ok: true }));
    expect(() => gateway.register(IPC_CHANNELS.cronCancel, () => ({ ok: true }))).toThrow(/重复注册/);
  });
});

describe('payload 校验（源型=X-01 9 域 payload；失败=VALIDATION-FAILED）', () => {
  it('空 payload 通道：undefined 与 {} 均合法；未知字段拒绝', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.appVersion, () => ({ app: 'x' }));
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.appVersion, {})).resolves.toEqual({ app: 'x' });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.appVersion, undefined)).resolves.toEqual({ app: 'x' });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.appVersion, { junk: 1 })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
  });

  it('shell:openExternal 缺 url → reject 恰 {code:"VALIDATION-FAILED", message 含通道与原因}（恰二键，无堆栈）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.shellOpenExternal, () => undefined);
    const rejection = await mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, {}).catch((e: unknown) => e);
    expect(rejection).toEqual({
      code: 'VALIDATION-FAILED',
      message: expect.stringMatching(/constella:shell:openExternal.*url/),
    });
    expect(Object.keys(rejection as object).sort()).toEqual(['code', 'message']);
  });

  it('dialog:saveFile 未知字段 → VALIDATION-FAILED（严格未知键拒绝——IPC 边界防字段漂移）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.dialogSaveFile, () => ({ path: null }));
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.dialogSaveFile, { defaultName: 'a.zip', extra: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION-FAILED' });
  });

  it('run:spawnScript：完整 SpawnScriptReq 过；lang 非 string 拒（lang 枚举语义 RUN-INVALID-LANG 归 handler/T4-16——本层只形状）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.runSpawnScript, () => ({ ok: true, pid: 1 }));
    const good = {
      nodeRunId: 'nr-1',
      lang: 'ts',
      scriptPath: 'node-types/x/main.ts',
      entry: 'run',
      params: { a: 1 },
      input: null,
      timeoutMs: 0,
      retries: 0,
    };
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.runSpawnScript, good)).resolves.toEqual({ ok: true, pid: 1 });
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.runSpawnScript, { ...good, timeoutMs: '1s' }),
    ).rejects.toMatchObject({ code: 'VALIDATION-FAILED' });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.runSpawnScript, { ...good, lang: 3 })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
  });

  it('storage:invoke 通道级形状：op 非 string／args 非对象 → VALIDATION-FAILED（31-op 白名单与 per-op 深校验归 T4-20，不与 §6.5a 重叠）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.storageInvoke, () => null);
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.storageInvoke, { op: 'flows.list' })).resolves.toBeNull();
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.storageInvoke, { op: 42 })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.storageInvoke, { op: 'flows.list', args: [1] })).rejects.toMatchObject(
      { code: 'VALIDATION-FAILED' },
    );
  });
});

describe('错误序列化铁律（§1：一切 handler 抛错 → reject 恰 {code,message}）', () => {
  it('handler 抛 DomainChannelError → reject 恰 {code,message}（无堆栈、无 Error 名）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.shellOpenExternal, () => {
      throw new DomainChannelError(IPC_ERROR_CODES.SHELL_INVALID_URL, '拒绝打开非 http/https 链接');
    });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url: 'https://ok.example/' })).rejects.toEqual({
      code: IPC_ERROR_CODES.SHELL_INVALID_URL,
      message: '拒绝打开非 http/https 链接',
    });
  });

  it('handler 抛业务错误（Error+code 同构形——StorageError/T4-20 透传面）→ {code,message} 透传', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.storageInvoke, () => {
      throw new FakeServiceError('FLOW-NOT-FOUND', '流程不存在：f1');
    });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.storageInvoke, { op: 'flows.get' })).rejects.toEqual({
      code: 'FLOW-NOT-FOUND',
      message: '流程不存在：f1',
    });
  });

  it('handler 抛裸 Error → {code:"INTERNAL", message}（02 §6.1 通用码；堆栈不穿）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.storageInvoke, () => {
      throw new Error('炸了');
    });
    const rejection = await mock.ipcMain.invoke(IPC_CHANNELS.storageInvoke, { op: 'flows.list' }).catch(
      (e: unknown) => e,
    );
    expect(rejection).toEqual({ code: 'INTERNAL', message: '炸了' });
    expect(Object.keys(rejection as object).sort()).toEqual(['code', 'message']);
  });

  it('handler 抛 {code,message} 普通对象 → 归一透传（恰二键，其余属性丢弃）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.cronCancel, () => {
      throw { code: 'CRON-INVALID-EXPR', message: '表达式非法', stack: 'boom', extra: 1 };
    });
    const rejection = await mock.ipcMain.invoke(IPC_CHANNELS.cronCancel, { flowId: 'f1' }).catch((e: unknown) => e);
    expect(rejection).toEqual({ code: 'CRON-INVALID-EXPR', message: '表达式非法' });
    expect(Object.keys(rejection as object).sort()).toEqual(['code', 'message']);
  });

  it('reject 值 String()=JSON{code,message}（Electron 传输编码——45.2.3 实证 reject 值经 String 摊平进前缀消息）', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.shellOpenExternal, () => {
      throw new DomainChannelError(IPC_ERROR_CODES.SHELL_INVALID_URL, '拒绝打开非 http/https 链接');
    });
    const rejection = await mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url: 'https://ok.example/' }).catch(
      (e: unknown) => e,
    );
    expect(JSON.parse(String(rejection))).toEqual({
      code: IPC_ERROR_CODES.SHELL_INVALID_URL,
      message: '拒绝打开非 http/https 链接',
    });
  });

  it('serializeError 纯函数：非错误值 → INTERNAL + String', () => {
    expect(serializeError('裸字符串')).toEqual({ code: 'INTERNAL', message: '裸字符串' });
    expect(serializeError(undefined)).toEqual({ code: 'INTERNAL', message: 'undefined' });
  });
});

describe('m→r 推送 sender 面（3 推送通道；fire-and-forget 无错误语义）', () => {
  it('send(推送通道, payload) → webContents.send 同通道同 payload', () => {
    const send = vi.fn();
    const { gateway } = makeGateway(() => ({ send }));
    gateway.send(IPC_CHANNELS.runScriptEvent, { nodeRunId: 'nr-1', kind: 'stdout', chunk: 'hi' });
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.runScriptEvent, {
      nodeRunId: 'nr-1',
      kind: 'stdout',
      chunk: 'hi',
    });
    gateway.send(IPC_CHANNELS.cronFired, { flowId: 'f1' });
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.cronFired, { flowId: 'f1' });
  });

  it('send 白名单外通道 → main 侧装配错误（推送面冻结 3 通道）', () => {
    const { gateway } = makeGateway(() => ({ send: () => {} }));
    expect(() => gateway.send(IPC_CHANNELS.appVersion, {})).toThrow(/推送/);
    expect(() => gateway.send('constella:evil:push', {})).toThrow(/推送/);
  });

  it('推送目标未就绪（主窗未建）→ 静默丢弃（fire-and-forget 无错误语义）', () => {
    const { gateway } = makeGateway(() => undefined);
    expect(() => gateway.send(IPC_CHANNELS.runScriptEvent, { nodeRunId: 'nr-1', kind: 'exit', code: 0 })).not.toThrow();
  });
});

describe('zip:* 装配位预留（handler 骨架随 T4-20、管线注入随 C-08〔P5〕）', () => {
  it('zip:export/zip:import 可经白名单注册，两段式/双变体 payload 校验生效', async () => {
    const { mock, gateway } = makeGateway();
    gateway.register(IPC_CHANNELS.zipExport, () => ({ file: 'a.zip', count: 1, scripts: [] }));
    gateway.register(IPC_CHANNELS.zipImport, () => ({ nodes: [], noScript: [] }));

    // zip:export 双变体（流程导出 / 发布打包，02 v1.0b）
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.zipExport, { flowId: 'f1', savePath: 'C:\\a.zip' })).resolves.toEqual({
      file: 'a.zip',
      count: 1,
      scripts: [],
    });
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.zipExport, { types: ['a.b'], savePath: 'C:\\a.zip', meta: { name: 'N' } }),
    ).resolves.toEqual({ file: 'a.zip', count: 1, scripts: [] });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.zipExport, { savePath: 'C:\\a.zip' })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });

    // zip:import 两段式（inspect / commit，02 v1.0b）
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.zipImport, { path: 'C:\\a.zip', phase: 'inspect' }),
    ).resolves.toEqual({ nodes: [], noScript: [] });
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.zipImport, { path: 'C:\\a.zip', phase: 'commit', token: 'sha256' }),
    ).resolves.toEqual({ nodes: [], noScript: [] });
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.zipImport, { path: 'C:\\a.zip' })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
  });
});

describe('AppRuntime 接管（T4-13 invokeRegistry 缺省=IpcGateway——payload 校验/错误序列化归一）', () => {
  it('AppRuntime 域通道经网关注册：坏 payload → VALIDATION-FAILED（接管前该载荷透传返回 {path:null}）', async () => {
    const mock = createMockElectron();
    const runtime = new AppRuntime({
      electron: mock.api,
      rendererDir: 'C:\\mock-app\\dist\\renderer',
      preloadPath: 'C:\\mock-app\\dist\\preload\\index.js',
    });
    await runtime.startup();
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.dialogSaveFile, { defaultName: 42 })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
    // 合法载荷仍走通（取消 in-band {path:null}）
    await expect(mock.ipcMain.invoke(IPC_CHANNELS.dialogSaveFile, { defaultName: 'a.zip' })).resolves.toEqual({
      path: null,
    });
  });

  it('registerAppRuntimeChannels(deps, gateway) 直挂：非法 url → SHELL-INVALID-URL（业务码不被 VALIDATION-FAILED 抢占）', async () => {
    const mock = createMockElectron();
    const gateway = new IpcGateway({ ipcMain: mock.ipcMain });
    registerAppRuntimeChannels(
      {
        app: mock.app,
        dialog: mock.dialog,
        shell: mock.shell,
        ownerWindow: () => undefined,
        laneMemory: () => [],
      },
      gateway,
    );
    await expect(
      mock.ipcMain.invoke(IPC_CHANNELS.shellOpenExternal, { url: 'file:///C:/Windows/system.ini' }),
    ).rejects.toEqual({ code: IPC_ERROR_CODES.SHELL_INVALID_URL, message: expect.any(String) });
  });
});
