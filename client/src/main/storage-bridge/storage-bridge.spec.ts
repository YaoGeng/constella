// StorageService／zip:* 装配位套件（T4-20 验收=TDD-C-M1 §6.5a~d＋zip 错误面＋T1-08 补跑终态）。
//
// 断言面（§6.5）：
//   a) 白名单外 op → IPC-UNKNOWN-OP；
//   b) handler 内 throw（DAO 业务码）→ reject 恰 {code,message}（无 `Error invoking remote
//      method` 前缀泄漏——ipc-loop 按 Electron 45.2.3 实证语义摊平 reject，preload 剥前缀恢复）；
//   c) 31 op 逐域一 op 往返冒烟（对 C-06 §6 套件——真 StorageLayer/DAO，SQLITE_ENGINE）；
//   d) factoryReset → sandbox/node-types/backups 目录空＋relaunch/quit 调用断言（mock app）；
//   e) zip:export/import stub（无管线 → ZIP-WRITE-FAILED／ZIP-INVALID）＋注入位透传＋
//      四错误码 {code,message} 序列化（错误序列化归本卡，管线本体=C-08〔P5〕）；
//   f) T1-08 补跑终态：31 op 经 preload 真面全量往返（T4-14 分步一登记的终态执行——
//      createConstellaApi ↔ ipc-loop ↔ IpcGateway ↔ StorageService ↔ 真 StorageLayer/DAO）。
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '@constella/shared/ipc';
import { createConstellaApi } from '../../preload/api';
import { createStorageClient } from '../../renderer/storage/storage-client';
import { IpcGateway } from '../ipc/ipc-gateway';
import { createLoopMockElectron } from '../ipc/testing/ipc-loop';
import { SQLITE_ENGINE } from '../storage/engine/sqlite-engine';
import { makeTempDb, type TempDb } from '../storage/testing/harness';
import { FACTORY_RESET_DIR_NAMES, StorageService, type StorageServiceAppFace } from './storage-service';
import { ZipError, registerZipChannels } from './zip-channels';

/** mock app（§6.5d relaunch/quit 断言面） */
function mockApp(): StorageServiceAppFace & { relaunchCalls: number; quitCalls: number } {
  const calls = { relaunchCalls: 0, quitCalls: 0 };
  return {
    relaunch: () => {
      calls.relaunchCalls += 1;
    },
    quit: () => {
      calls.quitCalls += 1;
    },
    get relaunchCalls() {
      return calls.relaunchCalls;
    },
    get quitCalls() {
      return calls.quitCalls;
    },
  };
}

const liveTempDbs: TempDb[] = [];
afterEach(() => {
  while (liveTempDbs.length > 0) liveTempDbs.pop()?.dispose();
});

/**
 * 全链装配（被测系统组装，非 mock 桩）：preload 真面 ↔ ipc-loop（Electron 摊平语义）↔
 * IpcGateway ↔ StorageService（真 StorageLayer/DAO——SQLITE_ENGINE，TempDb 临时目录）。
 */
function bootBridge() {
  const tmp = makeTempDb();
  liveTempDbs.push(tmp);
  const app = mockApp();
  const loop = createLoopMockElectron();
  const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
  const service = new StorageService({
    engine: SQLITE_ENGINE,
    userDataDir: tmp.dir,
    registry: gateway,
    app,
  });
  service.init({ preloadExamples: () => {} });
  const api = createConstellaApi(loop.ipcRenderer);
  const client = createStorageClient({ invoke: (req) => api.storageInvoke(req) });
  return { tmp, app, loop, gateway, service, api, client, userDataDir: tmp.dir };
}

describe('§6.5a 白名单外 op → IPC-UNKNOWN-OP', () => {
  it('未知 op 经 preload 真面 → reject {code:"IPC-UNKNOWN-OP"}', async () => {
    const { api } = bootBridge();
    const rejection = await api.storageInvoke({ op: 'nope.nope' } as never).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ code: 'IPC-UNKNOWN-OP' });
  });
});

describe('§6.5b handler 内 throw → reject 恰 {code,message}（无前缀泄漏）', () => {
  it('DAO 业务码（flows.get 未命中 → FLOW-NOT-FOUND）经真面 reject 恰二键', async () => {
    const { client } = bootBridge();
    const rejection = await client.invoke('flows.get', { id: 'no-such-flow' }).catch((e: unknown) => e);
    expect(rejection).toEqual({ code: 'FLOW-NOT-FOUND', message: expect.stringContaining('no-such-flow') });
    expect(JSON.stringify(rejection)).not.toContain('Error invoking remote method');
  });

  it('per-op args 深校验失败 → VALIDATION-FAILED（明细聚合）', async () => {
    const { client } = bootBridge();
    const rejection = await client.invoke('flows.create', { name: 42 } as never).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ code: 'VALIDATION-FAILED' });
  });

  it('通道级形状（op 非 string）→ VALIDATION-FAILED（IpcGateway 通道面，T4-14 既有）', async () => {
    const { api } = bootBridge();
    const rejection = await api.storageInvoke({ op: 42 } as never).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ code: 'VALIDATION-FAILED' });
  });
});

describe('§6.5c 31 op 逐域一 op 往返冒烟（对 C-06 §6 套件——真 DAO）', () => {
  it('9 域各一 op 经 preload 真面往返（flows/versions/definitions/library/runs/logs/settings/hits/publish）', async () => {
    const { client } = bootBridge();
    // 造流程＋run（hits.list 依赖 runId；versions.list 依赖 flowId）
    const created = await client.invoke('flows.create', { name: '逐域冒烟' });
    expect(typeof created.id).toBe('string');
    const run = await client.invoke('runs.create', { flowId: created.id, name: '逐域冒烟run' });
    expect(typeof run.id).toBe('string');

    const flows = await client.invoke('flows.list', undefined);
    expect(flows.items.some((f) => f.id === created.id)).toBe(true);
    const versions = await client.invoke('versions.list', { flowId: created.id });
    expect(versions.length).toBeGreaterThanOrEqual(1); // 「初始版本」
    const defs = await client.invoke('definitions.loadAll', undefined);
    expect(defs.length).toBeGreaterThanOrEqual(12); // 种子 12 内置定义（T1-03）
    const lib = await client.invoke('library.list', undefined);
    expect(Array.isArray(lib.items)).toBe(true);
    const runs = await client.invoke('runs.list', undefined);
    expect(runs.items.some((r) => r.id === run.id)).toBe(true);
    const logs = await client.invoke('logs.list', {});
    expect(Array.isArray(logs)).toBe(true);
    const settings = await client.invoke('settings.getAll', undefined);
    expect(typeof settings).toBe('object');
    const hits = await client.invoke('hits.list', { runId: run.id });
    expect(hits.items).toEqual([]);
    const publish = await client.invoke('publish.list', undefined);
    expect(publish.items).toEqual([]);
  });
});

describe('§6.5d factoryReset → 三目录空＋relaunch 断言（mock app）', () => {
  it('settings.factoryReset 经通道 → 删库重种＋node-types/sandbox/backups 空＋relaunch/quit 各恰一次；vault.bin 不动', async () => {
    const { client, app, userDataDir } = bootBridge();
    // 三目录塞入残留物＋vault.bin（T4-15 冻结：不在清理面）
    for (const name of FACTORY_RESET_DIR_NAMES) {
      const dir = path.join(userDataDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'residue.txt'), 'x', 'utf8');
    }
    const vaultFile = path.join(userDataDir, 'vault.bin');
    fs.writeFileSync(vaultFile, '{"k":"cipher"}', 'utf8');

    await expect(client.invoke('settings.factoryReset', undefined)).resolves.toBeUndefined();

    for (const name of FACTORY_RESET_DIR_NAMES) {
      const dir = path.join(userDataDir, name);
      expect(fs.existsSync(dir), `${name} 目录仍在`).toBe(true);
      expect(fs.readdirSync(dir), `${name} 目录未清空`).toEqual([]);
    }
    expect(fs.existsSync(vaultFile)).toBe(true); // vault.bin 不随重置清理（T4-15）
    expect(app.relaunchCalls).toBe(1);
    expect(app.quitCalls).toBe(1);
    // 重种后库可用（种子回归）：flows.list 恢复种子流程（T6-18：空 preloadExamples 钩子=bare
    // 面，f1~f4 先种；本用例验桥面重种回归，不验全量种子）
    const flows = await client.invoke('flows.list', undefined);
    expect(flows.items.length).toBeGreaterThanOrEqual(4);
  });
});

describe('§6.5e zip:* 装配位骨架（错误序列化归本卡；管线本体=C-08〔P5〕注入位）', () => {
  it('无管线 stub：zip:export → ZIP-WRITE-FAILED／zip:import(inspect) → ZIP-INVALID（「管线未装配」）', async () => {
    const { api } = bootBridge();
    await expect(api.zipExport({ flowId: 'f1', savePath: 'C:\\a.zip' })).rejects.toMatchObject({
      code: 'ZIP-WRITE-FAILED',
    });
    await expect(api.zipImport({ path: 'C:\\a.zip', phase: 'inspect' })).rejects.toMatchObject({
      code: 'ZIP-INVALID',
    });
  });

  it('注入位透传：管线注入后 export 两变体／import 两段式原样往返', async () => {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    registerZipChannels(
      {
        // ✅ v1.0f（T5-11）：zip:export 四变体——盘双变体（savePath）＋字节双变体（无 savePath）
        export: (req) =>
          'savePath' in req && 'types' in req
            ? { filePath: `${req.meta.name}.zip`, checksum: 'sha256:x' }
            : 'savePath' in req
              ? { file: req.savePath, count: 1, scripts: [] }
              : { bytes: new Uint8Array([1]), count: 1, scripts: [], checksum: 'sha256:x' },
        import: (req) =>
          req.phase === 'inspect'
            ? { nodes: [], noScript: [], categories: [], manifest: {} as never, token: 't' }
            : { nodes: [], noScript: [] },
      },
      gateway,
    );
    const api = createConstellaApi(loop.ipcRenderer);
    await expect(api.zipExport({ flowId: 'f1', savePath: 'C:\\a.zip' })).resolves.toEqual({
      file: 'C:\\a.zip',
      count: 1,
      scripts: [],
    });
    await expect(
      api.zipExport({ types: ['a.b'], savePath: 'C:\\p.zip', meta: { name: '包' } }),
    ).resolves.toEqual({ filePath: '包.zip', checksum: 'sha256:x' });
    await expect(api.zipImport({ path: 'C:\\a.zip', phase: 'inspect' })).resolves.toMatchObject({ token: 't' });
    await expect(api.zipImport({ path: 'C:\\a.zip', phase: 'commit', token: 't' })).resolves.toEqual({
      nodes: [],
      noScript: [],
    });
  });

  it('四错误码序列化：ZIP-WRITE-FAILED／ZIP-FLOW-NOT-FOUND／ZIP-INVALID／ZIP-UNSAFE-ENTRY 恰 {code,message}', async () => {
    const loop = createLoopMockElectron();
    const gateway = new IpcGateway({ ipcMain: loop.ipcMain });
    const codes = ['ZIP-WRITE-FAILED', 'ZIP-FLOW-NOT-FOUND', 'ZIP-INVALID', 'ZIP-UNSAFE-ENTRY'] as const;
    let i = 0;
    registerZipChannels(
      {
        export: () => {
          throw new ZipError(codes[i++ % 2]!, 'export 侧错误');
        },
        import: () => {
          throw new ZipError(codes[2 + (i++ % 2)]!, 'import 侧错误');
        },
      },
      gateway,
    );
    const api = createConstellaApi(loop.ipcRenderer);
    for (const code of codes) {
      const viaExport = code === 'ZIP-WRITE-FAILED' || code === 'ZIP-FLOW-NOT-FOUND';
      const rejection = await (
        viaExport
          ? api.zipExport({ flowId: 'f1', savePath: 'x' })
          : api.zipImport({ path: 'x', phase: 'inspect' })
      ).catch((e: unknown) => e);
      expect(rejection).toMatchObject({ code });
      expect(Object.keys(rejection as object).sort()).toEqual(['code', 'message']);
    }
  });
});

describe('非 cdp 真径（T4-20 评审 blocker 收口：nodeRunStart 无 lanes 前置直插——DAO ensureLane 占位兜底）', () => {
  it('纯数据流流程 runs.nodeRunStart 经 preload 真面直插不撞 FK；lanes 落占位行（cdpPort=null、label=laneId）', async () => {
    const { client, service } = bootBridge();
    const flow = await client.invoke('flows.create', { name: '非cdp真径' });
    await client.invoke('flows.save', {
      id: flow.id,
      name: '非cdp真径',
      nodes: [{ id: 't1', type: 'trigger.manual', name: '手动', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      label: '手动保存',
    });
    const run = await client.invoke('runs.create', { flowId: flow.id, name: '纯数据流' });
    // 无任何 lanes 前置（renderer RunLoop 'main' lane 场景）——直插成功
    await expect(
      client.invoke('runs.nodeRunStart', { nodeRunId: `${run.id}:t1`, runId: run.id, laneId: 'main', nodeId: 't1' }),
    ).resolves.toBeUndefined();
    // lanes 落占位行：id=laneId、label=laneId、cdp 三字段 NULL（CdpSessionManager 后续 upsert 覆盖真值）
    const lane = service.layer.dao.lanes.get('main');
    expect(lane).toMatchObject({
      id: 'main',
      runId: run.id,
      label: 'main',
      cdpPort: null,
      partition: null,
      lastUrl: null,
    });
    // cdp 会话后到 upsert 覆盖占位行（时序：nodeRunStart 先于 cdp 节点 ensureSession 无冲突）
    service.layer.dao.lanes.upsert({
      id: 'main',
      runId: run.id,
      label: '主',
      cdpPort: 9221,
      partition: 'persist:f1·主',
      lastUrl: 'https://a.example/',
      status: 'open',
    });
    expect(service.layer.dao.lanes.get('main')).toMatchObject({ cdpPort: 9221, label: '主' });
    // 幂等：同 lane 再 nodeRunStart（N6 重试同 id 场景换 nodeRunId）——占位行不覆写已覆盖真值
    await expect(
      client.invoke('runs.nodeRunStart', { nodeRunId: `${run.id}:t1b`, runId: run.id, laneId: 'main', nodeId: 't1' }),
    ).resolves.toBeUndefined();
    expect(service.layer.dao.lanes.get('main')).toMatchObject({ cdpPort: 9221, label: '主' });
  });
});

describe('T1-08 补跑终态：31 op 经 preload 真面全量往返（T4-14 分步一登记的终态）', () => {
  it('31 op 全量依序往返（真 StorageLayer/DAO＋mock app；factoryReset 收尾）', async () => {
    const { client, app } = bootBridge();
    // flows（7）——T6-18：空 preloadExamples 钩子=bare 面（f1~f4 先种）
    const listed = await client.invoke('flows.list', undefined);
    expect(listed.items.length).toBeGreaterThanOrEqual(4);
    const created = await client.invoke('flows.create', { name: 'T420 终态' });
    const flowId = created.id;
    const doc0 = await client.invoke('flows.get', { id: flowId });
    expect(doc0.nodes).toEqual([]);
    const saved = await client.invoke('flows.save', {
      id: flowId,
      name: 'T420 终态',
      nodes: [
        {
          id: 't1',
          type: 'trigger.cron',
          name: '定时',
          position: { x: 0, y: 0 },
          params: { cron: '0 20 * * *' },
        },
        { id: 'a', type: 'data.transform', name: '加工', position: { x: 1, y: 1 }, params: { expr: 'x' } },
      ],
      edges: [{ id: 't1--a', from: ['t1', 'out'], to: ['a', 'in'] }],
      label: '手动保存',
    });
    expect(typeof saved.versionId).toBe('string');
    await expect(client.invoke('flows.rename', { id: flowId, name: '终态改名' })).resolves.toBeUndefined();
    await expect(
      client.invoke('flows.reorder', { ids: [flowId, ...listed.items.map((f) => f.id)] }),
    ).resolves.toBeUndefined();
    // versions（2）
    const versions = await client.invoke('versions.list', { flowId });
    expect(versions.length).toBeGreaterThanOrEqual(2); // 初始版本＋手动保存
    const restored = await client.invoke('versions.restore', { flowId, versionId: saved.versionId });
    expect(restored.nodes.map((n) => n.id)).toEqual(['t1', 'a']);
    // definitions（2）
    await expect(
      client.invoke('definitions.upsert', {
        doc: {
          type: 't420.custom',
          kind: 'custom',
          meta: { name: '终态节点', icon: 'x', category: '数据' },
          ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
          paramsSchema: [],
          exec: { lang: 'ts', file: 'scripts/main.ts', entry: 'run' },
          version: '1.0.0',
          packageVersion: '1.0.0',
        },
      }),
    ).resolves.toBeUndefined();
    const defs = await client.invoke('definitions.loadAll', undefined);
    expect(defs.some((d) => d.type === 't420.custom')).toBe(true);
    // library（3）
    await expect(
      client.invoke('library.upsert', {
        entry: {
          id: 'lib-t420',
          name: '终态库项',
          type: 't420.custom',
          params: {},
          scriptMeta: { lang: 'ts', file: 'scripts/main.ts' },
          updatedAt: 1,
        },
      }),
    ).resolves.toBeUndefined();
    expect((await client.invoke('library.list', undefined)).items.some((e) => e.id === 'lib-t420')).toBe(true);
    await expect(client.invoke('library.delete', { id: 'lib-t420' })).resolves.toBeUndefined();
    // runs（6）——非 cdp 真径（T4-20 评审 blocker 收口）：nodeRunStart 无 lanes 前置直插
    // （DAO 内 ensureLane 占位兜底——renderer RunLoop 'main' lane 纯数据流不再撞 FK）
    const run = await client.invoke('runs.create', { flowId, name: '终态run' });
    const runId = run.id;
    const detail = await client.invoke('runs.get', { runId });
    expect(detail.nodeRuns).toEqual([]);
    const nodeRunId = `${runId}:t1`;
    await expect(
      client.invoke('runs.nodeRunStart', { nodeRunId, runId, laneId: 'main', nodeId: 't1' }),
    ).resolves.toBeUndefined();
    await expect(
      client.invoke('runs.nodeRunFinish', { nodeRunId, status: 'done', output: { data: { ok: 1 } } }),
    ).resolves.toBeUndefined();
    await expect(
      client.invoke('runs.finish', { runId, status: 'done', total: 1, skips: [] }),
    ).resolves.toBeUndefined();
    expect((await client.invoke('runs.list', undefined)).items.some((r) => r.id === runId)).toBe(true);
    // logs（2）
    await expect(client.invoke('logs.append', { level: 'info', msg: 'T4-20 终态留痕' })).resolves.toBeUndefined();
    expect((await client.invoke('logs.list', {})).some((l) => l.msg === 'T4-20 终态留痕')).toBe(true);
    // settings（2＋factoryReset 收尾＝第 3 个）
    await expect(client.invoke('settings.set', { key: 'snap', value: false })).resolves.toBeUndefined();
    expect(await client.invoke('settings.getAll', undefined)).toMatchObject({ snap: false });
    // hits（3）
    const hit = await client.invoke('hits.create', {
      runId,
      nodeId: 't1',
      question: '继续？',
      options: ['是', '否'],
      dataSnapshot: { upstream: 1 },
    });
    expect((await client.invoke('hits.list', { runId })).items.length).toBe(1);
    await expect(
      client.invoke('hits.resolve', { id: hit.id, status: 'resolved', payload: { pick: '是' } }),
    ).resolves.toBeUndefined();
    // publish（3）
    const queued = await client.invoke('publish.queue', {
      meta: { kind: 'node', name: '终态包', checksum: 'sha256:t420' },
      filePath: 'C:\\tmp\\t420.zip',
    });
    expect((await client.invoke('publish.list', undefined)).items.length).toBe(1);
    await expect(client.invoke('publish.remove', { id: queued.id })).resolves.toBeUndefined();
    // flows.softDelete（flows 域第 7 op——补齐）
    await expect(client.invoke('flows.softDelete', { id: flowId })).resolves.toBeUndefined();
    // settings.factoryReset（第 31 op；目录清空＋relaunch 断言面=§6.5d）
    await expect(client.invoke('settings.factoryReset', undefined)).resolves.toBeUndefined();
    expect(app.relaunchCalls).toBe(1);
    // 重种回归：种子流程恢复（T6-18：空钩子=bare 面 f1~f4）
    expect((await client.invoke('flows.list', undefined)).items.length).toBeGreaterThanOrEqual(4);
  });
});

// 通道挂载面（21 通道冻结之子集——本服务三通道恰注册一次；IPC_CHANNELS 字面量对齐）
describe('通道挂载', () => {
  it('init 恰注册 storage:invoke＋zip:export＋zip:import 三通道（IpcGateway 白名单内）', () => {
    const tmp = makeTempDb();
    liveTempDbs.push(tmp);
    const loop = createLoopMockElectron();
    const registered: string[] = [];
    const gateway = new IpcGateway({
      ipcMain: {
        handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void => {
          registered.push(channel);
          loop.ipcMain.handle(channel, listener);
        },
      },
    });
    const service = new StorageService({
      engine: SQLITE_ENGINE,
      userDataDir: tmp.dir,
      registry: gateway,
      app: mockApp(),
    });
    service.init({ preloadExamples: () => {} });
    expect(registered.sort()).toEqual(
      [IPC_CHANNELS.storageInvoke, IPC_CHANNELS.zipExport, IPC_CHANNELS.zipImport].sort(),
    );
    // 重复 init 拒绝：StorageLayer 单连接守卫先于 IpcGateway 重复注册守卫触发（双守卫任一即拒）
    expect(() => service.init({ preloadExamples: () => {} })).toThrow(/已 open|重复注册/);
    service.close();
  });
});
