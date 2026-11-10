// Publisher 用例（T5-11 / TDD-C-09 §3 Publisher 行＋§6.4 发布链＋§6.5 断网段）。
//
// 覆盖：node 勾选→exportPackageBytes（v1.0f 字节变体——zip+SHA-256 幂等键）→publishPackage
// multipart→202 pending＋「已提交审核」toast；flow=exportFlowBytes（流程导出变体 zip——不上传
// 裸 steps JSON）；限额前端拦截（name≤24/summary≤40）；断网（MarketTransportError）→
// publish.queue 入队恰一行（meta 含 SHA-256）；server 4xx 不入队；UNAUTHORIZED→登录引导。
import { describe, expect, it, vi } from 'vitest';
import type { PublishAccepted } from '@constella/shared/dto';
import type { StorageInvokeReq } from '@constella/shared/ipc';
import { MarketApiError, MarketTransportError, MarketUnauthorizedError } from './market-error';
import { createPendingByteStore } from './pending-publish-queue';
import {
  createPublisher,
  derivePublishKind,
  suggestPublishName,
  validatePublishForm,
  pendingFilePathOf,
  type PublishOutcome,
  type PublisherDeps,
  type PublisherExportFace,
} from './publisher';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const CHECKSUM = `sha256:${'ab'.repeat(32)}`;

function fakeExporter(): PublisherExportFace & { pkgCalls: string[][]; flowCalls: string[] } {
  const pkgCalls: string[][] = [];
  const flowCalls: string[] = [];
  return {
    pkgCalls,
    flowCalls,
    exportPackageBytes: async (types) => {
      pkgCalls.push([...types]);
      return { bytes: BYTES, count: types.length, scripts: [], checksum: CHECKSUM };
    },
    exportFlowBytes: async (flowId) => {
      flowCalls.push(flowId);
      return { bytes: BYTES, count: 3, scripts: [], checksum: CHECKSUM };
    },
  };
}

interface Harness {
  publish: ReturnType<typeof createPublisher>['publish'];
  exporter: ReturnType<typeof fakeExporter>;
  uploadCalls: Array<{ meta: unknown; file: unknown }>;
  storageCalls: StorageInvokeReq[];
  notify: Array<[string, string]>;
  unauthorized: number;
  byteStore: ReturnType<typeof createPendingByteStore>;
}

function makeHarness(uploadImpl?: () => Promise<never>): Harness {
  const exporter = fakeExporter();
  const uploadCalls: Array<{ meta: unknown; file: unknown }> = [];
  const storageCalls: StorageInvokeReq[] = [];
  const notify: Array<[string, string]> = [];
  const byteStore = createPendingByteStore();
  const upload: () => Promise<never> =
    uploadImpl ?? (() => Promise.reject(new MarketTransportError('network', '网络错误')));
  let unauthorized = 0;
  const deps: PublisherDeps = {
    client: {
      publishPackage: (async (meta: unknown, file: unknown) => {
        uploadCalls.push({ meta, file });
        return upload();
      }) as PublisherDeps['client']['publishPackage'],
    },
    exporter,
    storageInvoke: async (req: StorageInvokeReq) => {
      storageCalls.push(req);
      if (req.op === 'publish.queue') return { id: 'pend-1' };
      return { items: [] };
    },
    byteStore,
    notify: (level, msg) => notify.push([level, msg]),
    onUnauthorized: () => {
      unauthorized++;
    },
  };
  return {
    exporter,
    uploadCalls,
    storageCalls,
    notify,
    get unauthorized() {
      return unauthorized;
    },
    byteStore,
    publish: (meta, source) => createPublisher(deps).publish(meta, source),
  };
}

describe('Publisher——§6.4 发布链（node/pack=exportPackageBytes multipart；202→已提交审核）', () => {
  it('node 勾选→字节变体产物→multipart（meta+file）→202 pending＋「已提交审核」toast', async () => {
    const accepted: PublishAccepted = { packageId: 'pkg-1', status: 'pending', perms: ['文件'], checksum: CHECKSUM };
    const exporter = fakeExporter();
    const uploadCalls: Array<{ meta: unknown; file: { data: Uint8Array; filename: string } }> = [];
    const notify: Array<[string, string]> = [];
    const publisher = createPublisher({
      client: {
        publishPackage: async (meta, file) => {
          uploadCalls.push({ meta, file });
          return accepted;
        },
      },
      exporter,
      storageInvoke: async () => {
        throw new Error('storage 不应被调（在线路径零入队）');
      },
      byteStore: createPendingByteStore(),
      notify: (level, msg) => notify.push([level, msg]),
    });

    const res: PublishOutcome = await publisher.publish(
      { kind: 'node', name: '小红书搜索', summary: '一句话说明' },
      { types: ['xhs.search'] },
    );
    expect(res).toEqual(accepted);
    expect(exporter.pkgCalls).toEqual([['xhs.search']]);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]!.meta).toEqual({ kind: 'node', name: '小红书搜索', summary: '一句话说明' });
    expect(uploadCalls[0]!.file.data).toBe(BYTES); // v1.0f：字节直入 multipart——免文件读回
    expect(uploadCalls[0]!.file.filename).toBe('constella-小红书搜索.zip');
    expect(notify).toEqual([['ok', expect.stringContaining('已提交审核')]]);
  });

  it('pack（多类型勾选）→exportPackageBytes(types[])；flow→exportFlowBytes(flowId)（流程导出变体 zip）', async () => {
    const accepted = { packageId: 'p', status: 'pending' as const, perms: [], checksum: CHECKSUM };
    const exporter = fakeExporter();
    const metas: unknown[] = [];
    const publisher = createPublisher({
      client: {
        publishPackage: async (meta) => {
          metas.push(meta);
          return accepted;
        },
      },
      exporter,
      storageInvoke: async () => ({ id: 'x' }),
      byteStore: createPendingByteStore(),
      notify: () => {},
    });
    await publisher.publish({ kind: 'pack', name: '工具集' }, { types: ['a.type', 'b.type'] });
    await publisher.publish({ kind: 'flow', name: '采集流程' }, { flowId: 'flow-9' });
    expect(exporter.pkgCalls).toEqual([['a.type', 'b.type']]);
    expect(exporter.flowCalls).toEqual(['flow-9']); // 不上传裸 steps JSON（PM 裁决 v1.0f）
    expect(metas.map((m) => (m as { kind: string }).kind)).toEqual(['pack', 'flow']);
  });
});

describe('Publisher——§6.5 断网入队（不自动静默重试）', () => {
  it('fetch 网络错误→publish.queue 恰一行（meta 含 SHA-256 幂等键）＋返回 {queued:true}', async () => {
    const h = makeHarness(); // 缺省 upload=MarketTransportError('network')
    const res = await h.publish({ kind: 'node', name: '离线包', summary: 's' }, { types: ['t1'] });
    expect(res).toEqual({ queued: true });
    expect(h.uploadCalls).toHaveLength(1);
    const queueCalls = h.storageCalls.filter((c) => c.op === 'publish.queue');
    expect(queueCalls).toHaveLength(1); // pending_publish 恰一行
    expect(queueCalls[0]!.args).toEqual({
      meta: { kind: 'node', name: '离线包', summary: 's', checksum: CHECKSUM },
      filePath: `market-pending:${CHECKSUM}`,
    });
    expect(h.byteStore.take(CHECKSUM)).toBe(BYTES); // 字节入会话仓（flushPending 消费）
    expect(h.notify[0]![0]).toBe('warn');
  });

  it('超时（timeout）同样入队；server 4xx 不入队（rethrow——用户修正后重发）', async () => {
    const hTimeout = makeHarness(() => Promise.reject(new MarketTransportError('timeout', '请求超时')));
    expect(await hTimeout.publish({ kind: 'node', name: 'T' }, { types: ['t'] })).toEqual({ queued: true });

    const h400 = makeHarness(() => Promise.reject(new MarketApiError('VALIDATION-FAILED', '名称超限', 400)));
    await expect(h400.publish({ kind: 'node', name: 'X' }, { types: ['t'] })).rejects.toMatchObject({
      code: 'VALIDATION-FAILED',
    });
    expect(h400.storageCalls).toHaveLength(0);
  });

  it('UNAUTHORIZED→登录引导（onUnauthorized）且不入队', async () => {
    const h = makeHarness(() => Promise.reject(new MarketUnauthorizedError()));
    await expect(h.publish({ kind: 'node', name: 'U' }, { types: ['t'] })).rejects.toBeInstanceOf(
      MarketUnauthorizedError,
    );
    expect(h.unauthorized).toBe(1);
    expect(h.storageCalls).toHaveLength(0);
  });
});

describe('Publisher——表单纯逻辑（§6.4 前端拦截/名称建议/kind 推导）', () => {
  it('validatePublishForm：空名/超 24/超 40/空勾选拦截（demo L826-841 限额）', () => {
    expect(validatePublishForm('', '', 1, 'node')).toBe('名称不能为空');
    expect(validatePublishForm('x'.repeat(25), '', 1, 'node')).toBe('名称不能超过 24 字');
    expect(validatePublishForm('名', 'y'.repeat(41), 1, 'node')).toBe('简介不能超过 40 字');
    expect(validatePublishForm('名', '', 0, 'node')).toBe('先勾选要发布的节点类型');
    expect(validatePublishForm('名', 's', 0, 'flow')).toBe(null); // flow 不查类型勾选
    expect(validatePublishForm('名', 's', 2, 'pack')).toBe(null);
  });

  it('derivePublishKind：单类型=node、多类型=pack、flow 显式（X-01 manifest kind 同源）', () => {
    expect(derivePublishKind('node', ['a'])).toBe('node');
    expect(derivePublishKind('node', ['a', 'b'])).toBe('pack');
    expect(derivePublishKind('flow', [])).toBe('flow');
  });

  it('suggestPublishName：流程→流程名/单勾选→类型名/多勾选→N 个精选节点（demo L2902-2913 值面）', () => {
    expect(suggestPublishName('flow', [], '采集流程', () => '')).toBe('采集流程');
    expect(suggestPublishName('node', ['xhs.search'], null, (t) => (t === 'xhs.search' ? '小红书搜索' : t))).toBe(
      '小红书搜索',
    );
    expect(suggestPublishName('node', ['a', 'b', 'c'], null, (t) => t)).toBe('3 个精选节点');
    expect(suggestPublishName('node', [], null, (t) => t)).toBe('');
  });

  it('pendingFilePathOf：列值=market-pending:<checksum> 标记（⚠ 卡内冻结——非文件路径）', () => {
    expect(pendingFilePathOf('sha256:abc')).toBe('market-pending:sha256:abc');
  });
});
