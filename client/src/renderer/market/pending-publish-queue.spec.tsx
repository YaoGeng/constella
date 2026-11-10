// @vitest-environment jsdom
// PendingPublishQueue 用例（T5-11 / TDD-C-09 §3 组件行＋§6.5 断网发布段）。
//
// 覆盖：恢复→flushPending 走**同一上传 API**（publishPackage 同形调用）成功出队
// （publish.remove 恰一次/行）；失败保留（transport 提前收段——不自动静默重试）；server 4xx
// 单行失败继续下一行；字节不可达（跨重启遗留行）failed 保留；list/remove 直通 C-06 面；
// usePendingPublish hook（jsdom probe——items/flushing/lastFlush 态位）。
import { describe, expect, it, vi } from 'vitest';
import type { PendingPublishItem, StorageInvokeReq } from '@constella/shared/ipc';
import { MarketApiError, MarketTransportError } from './market-error';
import { createPendingByteStore, createPendingPublishQueue, type PendingPublishQueueDeps } from './pending-publish-queue';

function item(id: string, name: string, checksum: string): PendingPublishItem {
  return { id, meta: { kind: 'node', name, checksum }, filePath: `market-pending:${checksum}`, createdAt: 1 };
}

interface Harness {
  queue: ReturnType<typeof createPendingPublishQueue>;
  storageCalls: StorageInvokeReq[];
  uploads: Array<{ meta: { name: string; checksum?: string }; data: Uint8Array }>;
  notify: Array<[string, string]>;
  setUpload(impl: (meta: { name: string }) => Promise<unknown>): void;
  setRows(rows: PendingPublishItem[]): void;
  byteStore: ReturnType<typeof createPendingByteStore>;
}

function makeHarness(): Harness {
  const storageCalls: StorageInvokeReq[] = [];
  const uploads: Harness['uploads'] = [];
  const notify: Array<[string, string]> = [];
  const byteStore = createPendingByteStore();
  let rows: PendingPublishItem[] = [];
  let upload: (meta: { name: string }) => Promise<unknown> = async () => ({ packageId: 'p', status: 'pending', perms: [], checksum: 'x' });
  const deps: PendingPublishQueueDeps = {
    storage: {
      invoke: async (req: StorageInvokeReq) => {
        storageCalls.push(req);
        if (req.op === 'publish.list') return { items: rows };
        return undefined;
      },
    },
    client: {
      publishPackage: async (meta, file) => {
        uploads.push({ meta: meta as { name: string }, data: file.data });
        return upload(meta as { name: string });
      },
    },
    byteStore,
    notify: (level, msg) => notify.push([level, msg]),
  };
  return {
    queue: createPendingPublishQueue(deps),
    storageCalls,
    uploads,
    notify,
    byteStore,
    setUpload: (impl) => {
      upload = impl;
    },
    setRows: (next) => {
      rows = next;
    },
  };
}

describe('PendingPublishQueue——list/remove（C-06 面）', () => {
  it('list→publish.list 直通；remove→publish.remove{id}', async () => {
    const h = makeHarness();
    h.setRows([item('p1', 'A', 'c1')]);
    expect(await h.queue.list()).toEqual({ items: [item('p1', 'A', 'c1')] });
    await h.queue.remove('p1');
    expect(h.storageCalls.map((c) => c.op)).toEqual(['publish.list', 'publish.remove']);
    expect((h.storageCalls[1] as { args?: { id: string } }).args).toEqual({ id: 'p1' });
  });
});

describe('PendingPublishQueue——§6.5 flushPending（同一 API 补交/失败保留/无自动重试）', () => {
  it('联网恢复→逐条同一上传 API 成功出队（publish.remove 恰一次/行）', async () => {
    const h = makeHarness();
    h.setRows([item('p1', 'A', 'c1'), item('p2', 'B', 'c2')]);
    h.byteStore.put('c1', new Uint8Array([1]));
    h.byteStore.put('c2', new Uint8Array([2]));
    const res = await h.queue.flushPending();
    expect(res).toEqual({ submitted: 2, failed: 0 });
    expect(h.uploads).toHaveLength(2); // 同一上传 API（X-21）——零旁路
    expect(h.uploads[0]!.meta.name).toBe('A');
    expect(h.uploads[0]!.data).toEqual(new Uint8Array([1]));
    const removes = h.storageCalls.filter((c) => c.op === 'publish.remove');
    expect(removes).toHaveLength(2); // 成功出队
    expect(h.notify[0]).toEqual(['ok', expect.stringContaining('已补交 2')]);
  });

  it('仍断网（transport 失败）→失败保留＋提前收段（后续行不外发；无自动重试）', async () => {
    const h = makeHarness();
    h.setRows([item('p1', 'A', 'c1'), item('p2', 'B', 'c2')]);
    h.byteStore.put('c1', new Uint8Array([1]));
    h.byteStore.put('c2', new Uint8Array([2]));
    h.setUpload(() => Promise.reject(new MarketTransportError('network', '网络错误')));
    const res = await h.queue.flushPending();
    expect(res).toEqual({ submitted: 0, failed: 1 });
    expect(h.uploads).toHaveLength(1); // 第一行即断网——第二行不外发
    expect(h.storageCalls.filter((c) => c.op === 'publish.remove')).toHaveLength(0); // 零出队
    expect(h.notify.some(([level]) => level === 'warn')).toBe(true); // 提示可再补交——非自动重试
  });

  it('server 4xx 单行失败→该行保留、继续下一行（不牵连）', async () => {
    const h = makeHarness();
    h.setRows([item('p1', 'A', 'c1'), item('p2', 'B', 'c2')]);
    h.byteStore.put('c1', new Uint8Array([1]));
    h.byteStore.put('c2', new Uint8Array([2]));
    h.setUpload((meta) =>
      meta.name === 'A'
        ? Promise.reject(new MarketApiError('MARKET-FILE-INVALID', '包体非法', 400))
        : Promise.resolve({ ok: true }),
    );
    const res = await h.queue.flushPending();
    expect(res).toEqual({ submitted: 1, failed: 1 });
    expect(h.uploads).toHaveLength(2); // 两行都试过
    const removes = h.storageCalls.filter((c) => c.op === 'publish.remove');
    expect(removes).toHaveLength(1);
    expect(removes[0]!.args).toEqual({ id: 'p2' }); // 仅成功行出队
  });

  it('字节不可达（跨重启遗留行——会话仓 miss）→failed 保留＋提示重发布', async () => {
    const h = makeHarness();
    h.setRows([item('p1', 'A', 'gone-checksum')]); // byteStore 未 put——miss
    const res = await h.queue.flushPending();
    expect(res).toEqual({ submitted: 0, failed: 1 });
    expect(h.uploads).toHaveLength(0); // 零外发
    expect(h.storageCalls.filter((c) => c.op === 'publish.remove')).toHaveLength(0); // 保留
    expect(h.notify.some(([, msg]) => msg.includes('字节不可达'))).toBe(true);
  });
});

describe('PendingByteStore（会话内存仓——⚠ 卡内冻结）', () => {
  it('put/take/size：checksum 键存取', () => {
    const store = createPendingByteStore();
    expect(store.take('c')).toBeUndefined();
    const bytes = new Uint8Array([9]);
    store.put('c', bytes);
    expect(store.take('c')).toBe(bytes);
    expect(store.size()).toBe(1);
  });
});

describe('usePendingPublish（hook 态位）', () => {
  it('items 装载/flush 结果与 flushing 位（jsdom probe——无 testing-library 红线）', async () => {
    const { usePendingPublish } = await import('./pending-publish-queue');
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const rows = [item('p1', 'A', 'c1')];
    const byteStore = createPendingByteStore();
    byteStore.put('c1', new Uint8Array([1]));
    const queue = createPendingPublishQueue({
      storage: { invoke: async (req: StorageInvokeReq) => (req.op === 'publish.list' ? { items: rows } : undefined) },
      client: { publishPackage: async () => ({ ok: true }) },
      byteStore,
    });
    let value: ReturnType<typeof usePendingPublish> = undefined as unknown as ReturnType<typeof usePendingPublish>;
    const Probe = (): null => {
      value = usePendingPublish(queue);
      return null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(value.items).toEqual(rows);
    expect(value.loading).toBe(false);
    let flushDone: Promise<unknown> = Promise.resolve();
    await act(async () => {
      flushDone = Promise.resolve(value.flush());
    });
    await act(async () => {
      await flushDone;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(value.lastFlush).toEqual({ submitted: 1, failed: 0 });
    expect(value.flushing).toBe(false);
    await act(async () => {
      root.unmount();
      container.remove();
    });
  });
});
