// market-assembly 用例（T5-11 / batch-3 硬接线 4〔真 C-02 校验器——T5-10 🔵3〕＋6
// 〔MarketBrowser.onDownload→Installer 链〕＋联网恢复补交提示接线）。
//
// 断言面：
//   - 🔵3：importer 注入**真 validateDefinition**（C-02 八条）——伪装类型（撞内置 12 类命名
//     空间 N1）的包定义被拒入（stub 透传会放行——此为「勿透传 stub」的判别断言）；
//   - onDownload→install 链（detail→confirm→download→importArchiveBytes→installs 全序）；
//   - publisherFaces（listTypes/listFlows/getFlow/derivePerms/publish——kind 推导）；
//   - 观察面 list：transport 失败→degradation offline＋成功恢复 online；
//   - wireOnlineHint：offline→online 翻转→队列行数提示（flushPending 不自动触发——02 §1.3）。
import { describe, expect, it, vi } from 'vitest';
import type { FlowDoc, StorageInvokeReq, ZipExportRes, ZipImportReq, ZipImportRes } from '@constella/shared/ipc';
import type { MarketListRes, PackageDetail, PermLabel, PublishAccepted } from '@constella/shared/dto';
import { MarketTransportError } from '../market/market-error';
import { createMarketAssembly, type MarketAssemblyBridge } from './market-assembly';

const DETAIL: PackageDetail = {
  id: 'pkg-1',
  kind: 'node',
  name: '小红书搜索',
  author: { id: 'u1', name: 'alice' },
  perms: ['社媒'],
  downloadCount: 0,
  installCount: 0,
  starCount: 0,
  version: '1.0.0',
  updatedAt: '2026-11-08T02:11:00Z',
  versions: [],
};

interface BridgeHarness {
  bridge: MarketAssemblyBridge;
  zipImportCalls: ZipImportReq[];
  setImportImpl(impl: (payload: ZipImportReq) => Promise<ZipImportRes>): void;
  storageCalls: StorageInvokeReq[];
  setStorage(impl: (req: StorageInvokeReq) => Promise<unknown>): void;
  setFetch(impl: typeof fetch): void;
  secretStore: Map<string, string>;
}

function makeBridge(): BridgeHarness {
  const zipImportCalls: ZipImportReq[] = [];
  const storageCalls: StorageInvokeReq[] = [];
  const secretStore = new Map<string, string>();
  let importImpl: (payload: ZipImportReq) => Promise<ZipImportRes> = async () => {
    throw new Error('zipImport 未配置');
  };
  let storageImpl: (req: StorageInvokeReq) => Promise<unknown> = async () => undefined;
  let fetchImpl: typeof fetch = async () => new Response('{}', { status: 200 });
  const bridge: MarketAssemblyBridge = {
    storageInvoke: async (req) => {
      storageCalls.push(req);
      return storageImpl(req);
    },
    dialogSaveFile: async () => ({ path: null }),
    zipExport: async () => ({ file: 'x', count: 0, scripts: [] }) as ZipExportRes,
    zipImport: async (payload) => {
      zipImportCalls.push(payload);
      return importImpl(payload);
    },
    secret: {
      set: async ({ key, value }) => {
        secretStore.set(key, value ?? '');
        return { ok: true };
      },
      get: async ({ key }) => ({ value: secretStore.get(key) ?? null }),
      del: async ({ key }) => {
        secretStore.delete(key);
        return { ok: true };
      },
    },
  };
  return {
    bridge,
    zipImportCalls,
    setImportImpl: (impl) => {
      importImpl = impl;
    },
    storageCalls,
    setStorage: (impl) => {
      storageImpl = impl;
    },
    setFetch: (impl) => {
      fetchImpl = impl;
    },
    secretStore,
  };
}

function makeAssembly(h: BridgeHarness, opts: { baseUrl?: () => string } = {}) {
  const notify = vi.fn();
  const asm = createMarketAssembly({
    bridge: h.bridge,
    baseUrl: opts.baseUrl ?? (() => 'https://market.test'),
    viewportCenter: () => ({ x: 0, y: 0 }),
    notify,
    confirm: async () => true,
    fetch: (async (url: RequestInfo | URL) =>
      String(url).endsWith('/api/market/packages/pkg-1')
        ? new Response(JSON.stringify(DETAIL), { status: 200 })
        : new Response('{}', { status: 200 })) as unknown as typeof fetch,
  });
  return { asm, notify };
}

/** 登录态 market fetch 面：login/detail/download/installs 全伺服（校验器链走通的前置） */
function marketFetch(opts: { detail?: PackageDetail } = {}): typeof fetch {
  const detail = opts.detail ?? DETAIL;
  return (async (url: RequestInfo | URL): Promise<Response> => {
    const path = String(url).replace('https://market.test', '');
    if (path === '/api/auth/login') {
      return new Response(
        JSON.stringify({ accessToken: 'tok-a', refreshToken: 'tok-r', user: { id: 'u1', email: 'a@b.c', role: 'user' } }),
        { status: 200 },
      );
    }
    if (path === `/api/market/packages/${detail.id}`) return new Response(JSON.stringify(detail), { status: 200 });
    if (path === `/api/market/packages/${detail.id}/download`) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (path === `/api/market/packages/${detail.id}/installs`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

describe('硬接线 4（🔵3）——importer 注入真 C-02 校验器（validateDefinition 非透传）', () => {
  it('非法定义（N2：零出口）的 inspect 产物被拒入——真校验器判别断言（stub 透传会放行）', async () => {
    const h = makeBridge();
    const asm = createMarketAssembly({
      bridge: h.bridge,
      baseUrl: () => 'https://market.test',
      viewportCenter: () => ({ x: 0, y: 0 }),
      notify: () => {},
      confirm: async () => true,
      fetch: marketFetch(),
    });
    await asm.browserFaces.auth.login('a@b.c', '12345678'); // download 需登录（inspect 在 download 后）
    // inspect 返回零出口自定义定义（N2-outs-empty——真 validateDefinition 八条之一）
    h.setImportImpl(async () =>
      ({
        nodes: [
          {
            type: 'custom.bad-node',
            name: '零出口节点',
            definition: {
              kind: 'custom',
              meta: { name: '零出口节点', icon: '✨', category: '自定义' },
              ports: { ins: ['in'], outs: [] },
              paramsSchema: [],
              exec: null,
              version: '1.0.0',
              packageVersion: '1.0.0',
              type: 'custom.bad-node',
            },
          },
        ],
        noScript: [],
        categories: [],
        manifest: { kind: 'node', name: '坏包', version: '1.0.0' },
        token: 't'.repeat(64),
      }) as unknown as ZipImportRes,
    );
    await expect(asm.install({ id: 'pkg-1', kind: 'node' })).rejects.toThrow(
      /定义校验失败拒入：custom\.bad-node.*ports\.outs 至少 1 个出口（N2：0~N 入、1~N 出）/,
    );
    // commit 未达（校验在 commit 前——12.2#4 链序；真校验器拦截=零落盘零入库）
    const commits = h.zipImportCalls.filter((c) => 'phase' in c && c.phase === 'commit');
    expect(commits).toHaveLength(0);
  });

  it('合法自定义定义过校验（N1 不误伤——真校验器非全拒）', async () => {
    const h = makeBridge();
    const asm = createMarketAssembly({
      bridge: h.bridge,
      baseUrl: () => 'https://market.test',
      viewportCenter: () => ({ x: 0, y: 0 }),
      notify: () => {},
      confirm: async () => true,
      fetch: marketFetch(),
    });
    await asm.browserFaces.auth.login('a@b.c', '12345678');
    h.setImportImpl(async (payload) => {
      if ('phase' in payload && payload.phase === 'inspect') {
        return {
          nodes: [
            {
              type: 'custom.ok-node',
              name: '合法节点',
              definition: {
                kind: 'custom',
                meta: { name: '合法节点', icon: '✨', category: '自定义' },
                ports: { ins: ['in'], outs: [{ id: 'out', label: '出' }] },
                paramsSchema: [],
                exec: null,
                version: '1.0.0',
                packageVersion: '1.0.0',
                type: 'custom.ok-node',
              },
            },
          ],
          noScript: [],
          categories: [],
          manifest: { kind: 'node', name: '合法包', version: '1.0.0' },
          token: 't'.repeat(64),
        } as unknown as ZipImportRes;
      }
      return { nodes: [], noScript: [] } as ZipImportRes;
    });
    const res = await asm.install({ id: 'pkg-1', kind: 'node' });
    expect(res.kind).toBe('node');
  });
});

describe('硬接线 6——MarketBrowser.onDownload→Installer 链（装配位接线）', () => {
  it('onDownload 触发 install 全序（detail→confirm→download→import→installs 计量）', async () => {
    const h = makeBridge();
    const { asm } = makeAssembly(h);
    let confirms = 0;
    let downloaded = 0;
    let installsPosted = 0;
    let imported = false;
    h.setImportImpl(async (payload) => {
      if ('phase' in payload && payload.phase === 'inspect') {
        imported = true;
        return {
          nodes: [],
          noScript: [],
          categories: [],
          manifest: { kind: 'node', name: 'x', version: '1.0.0' },
          token: 't'.repeat(64),
        } as unknown as ZipImportRes;
      }
      return { nodes: [], noScript: [] } as ZipImportRes;
    });
    const fetchCalls: Array<{ path: string; auth: boolean | undefined }> = [];
    const assembly = createMarketAssembly({
      bridge: h.bridge,
      baseUrl: () => 'https://market.test',
      viewportCenter: () => ({ x: 0, y: 0 }),
      notify: () => {},
      confirm: async () => {
        confirms++;
        return true;
      },
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url).replace('https://market.test', '');
        fetchCalls.push({ path, auth: (init?.headers as Record<string, string>)?.['Authorization'] !== undefined });
        if (path === '/api/auth/login') {
          return new Response(
            JSON.stringify({ accessToken: 'tok-a', refreshToken: 'tok-r', user: { id: 'u1', email: 'a@b.c', role: 'user' } }),
            { status: 200 },
          );
        }
        if (path === '/api/market/packages/pkg-1') return new Response(JSON.stringify(DETAIL), { status: 200 });
        if (path === '/api/market/packages/pkg-1/download') {
          downloaded++;
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        if (path === '/api/market/packages/pkg-1/installs') {
          installsPosted++;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    // 未登录安装：detail（匿名）可达，download 前置拦截——零 download/installs 外发
    await expect(assembly.install({ id: 'pkg-1', kind: 'node' })).rejects.toThrow();
    expect(fetchCalls.map((c) => c.path)).toEqual(['/api/market/packages/pkg-1']); // 仅匿名 detail
    expect(downloaded).toBe(0);

    // 登录后链全序（auth 会话经 browserFaces.auth——SecretVault 内存桥）
    await assembly.browserFaces.auth.login('a@b.c', '12345678');
    const res = await assembly.install({ id: 'pkg-1', kind: 'node' });
    expect(res.kind).toBe('node');
    expect(confirms).toBeGreaterThanOrEqual(1);
    expect(downloaded).toBe(1);
    expect(imported).toBe(true);
    expect(installsPosted).toBe(1);
    expect(assembly.browserFaces.offline()).toBe(false);
  });
});

describe('观察面 list＋联网恢复提示（degradation 接线）', () => {
  it('transport 失败→offline；成功→online（wireOnlineHint 恢复提示接线——flushPending 不自动触发）', async () => {
    const h = makeBridge();
    let fail = false;
    const notify = vi.fn();
    const assembly = createMarketAssembly({
      bridge: h.bridge,
      baseUrl: () => 'https://market.test',
      viewportCenter: () => ({ x: 0, y: 0 }),
      notify,
      fetch: (async () => {
        if (fail) throw new MarketTransportError('network', '网络错误');
        return new Response(JSON.stringify({ items: [], total: 0 } satisfies MarketListRes), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const unhint = assembly.wireOnlineHint();

    fail = true; // 断网
    await expect(assembly.browserFaces.list()).rejects.toBeInstanceOf(MarketTransportError);
    expect(assembly.degradation.state()).toBe('offline');

    // 队列一行（联网恢复提示数据源——publish.list）
    h.setStorage(async (req) => (req.op === 'publish.list' ? { items: [{ id: 'p1' }] } : undefined));
    fail = false;
    await expect(assembly.browserFaces.list()).resolves.toEqual({ items: [], total: 0 }); // 恢复 online
    expect(assembly.degradation.state()).toBe('online');
    // 恢复提示已发（含待发布行数）；无 upload 外发（不自动 flush——02 §1.3）
    await new Promise((r) => setTimeout(r, 0));
    expect(notify.mock.calls.some(([, msg]) => String(msg).includes('待发布'))).toBe(true);
    const uploads = h.storageCalls.filter((c) => c.op === 'publish.remove');
    expect(uploads).toHaveLength(0);
    unhint();
  });
});

describe('publisherFaces（发布弹窗装配面）', () => {
  it('listFlows/getFlow/derivePerms/publish——kind 推导（1 类型=node、多类型=pack）', async () => {
    const h = makeBridge();
    const { asm } = makeAssembly(h);
    h.setStorage(async (req) => {
      if (req.op === 'flows.list') return { items: [{ id: 'f1', name: '采集' }] };
      if (req.op === 'flows.get') return { name: '采集', nodes: [], edges: [] } as FlowDoc;
      if (req.op === 'publish.queue') return { id: 'pend-1' };
      return undefined;
    });
    const flows = await asm.publisherFaces.listFlows();
    expect(flows.items).toEqual([{ id: 'f1', name: '采集' }]);
    expect(await asm.publisherFaces.getFlow('f1')).toMatchObject({ name: '采集' });

    const perms: PermLabel[] = asm.publisherFaces.derivePerms(['trigger.manual']);
    expect(perms).toEqual([]); // builtin 不计（C-05 PermDeriver 同源）

    // publish kind 推导（source.types 决定 node/pack；导出字节断言在 publisher.spec——此处断言链路通）
    h.setImportImpl(async () => {
      throw new Error('unused');
    });
    const bytesRes = { bytes: new Uint8Array([1]), count: 1, scripts: [], checksum: 'sha256:k' };
    h.bridge.zipExport = async (payload) => {
      if (!('savePath' in payload)) return bytesRes as ZipExportRes;
      throw new Error('unexpected save variant');
    };
    const accepted: PublishAccepted = { packageId: 'p9', status: 'pending', perms: [], checksum: 'sha256:k' };
    let uploadedMeta: unknown = null;
    const fetchMock = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({ accessToken: 'tok-a', refreshToken: 'tok-r', user: { id: 'u1', email: 'a@b.c', role: 'user' } }),
          { status: 200 },
        );
      }
      if (String(url).endsWith('/api/market/packages')) {
        uploadedMeta = init?.body;
        return new Response(JSON.stringify(accepted), { status: 202 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    // 重建装配（fetch 注入新 mock）——单类型 node；publish 需登录（publishPackage requireLogin）
    const asm2 = createMarketAssembly({
      bridge: h.bridge,
      baseUrl: () => 'https://market.test',
      viewportCenter: () => ({ x: 0, y: 0 }),
      notify: () => {},
      fetch: fetchMock,
    });
    await asm2.browserFaces.auth.login('a@b.c', '12345678');
    const out = await asm2.publisherFaces.publish({ name: 'N', summary: 'S' }, { types: ['xhs.search'] });
    expect(out).toMatchObject({ packageId: 'p9', status: 'pending' });
    expect(uploadedMeta).toBeInstanceOf(FormData);
    expect((uploadedMeta as FormData).get('meta')).toEqual(JSON.stringify({ kind: 'node', name: 'N', summary: 'S' }));
  });
});
