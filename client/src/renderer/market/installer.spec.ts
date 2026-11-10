// Installer 用例（T5-10 / TDD-C-09 §3 Installer 行＋§6.3 验收——C-08 mock 注入）。
//
// 覆盖：确认前零下载零导入零计量（12.2#2）/确认后 download→importArchive→installs 各恰一次/
// kind 三分支（node 单条·pack 批量·flow 转 FlowInstaller）/UNAUTHORIZED→登录引导（LoginDialog
// 复用装配位）/计量尽力（失败不回滚安装）。download 大 timeoutMs（S-05 预签名 300s 对齐——
// 评审转交项）以注入面断言。
import { describe, expect, it, vi } from 'vitest';
import type { PackageDetail } from '@constella/shared/dto';
import type { ImportArchiveOpts, ImportInspectOutcome, ImportResult } from '../zip/import-orchestrator';
import { FlowDirtyRefusedError } from './flow-installer';
import type { InstallConfirmData } from './install-confirm';
import { createInstaller, MARKET_DOWNLOAD_TIMEOUT_MS, type InstallerDeps } from './installer';
import { MarketApiError, MarketUnauthorizedError } from './market-error';

const DETAIL: PackageDetail = {
  id: 'pkg-1',
  kind: 'node',
  name: '小红书搜索',
  author: { id: 'u1', name: 'yeager' },
  perms: ['社媒'],
  downloadCount: 0,
  installCount: 0,
  starCount: 0,
  version: '1.0.0',
  updatedAt: '2026-11-08T02:11:00Z',
  versions: [],
};

const BYTES = new Uint8Array([1, 2, 3]);
const TOKEN = 't'.repeat(64);

const FLOW_SUMMARY: ImportInspectOutcome['summary'] = {
  nodes: [
    { type: 'trigger.manual', name: '手动触发', params: {}, noScript: false },
    { type: 'http.request', name: '请求', params: { url: 'https://x' }, noScript: false },
  ],
  noScript: [],
  categories: [],
  manifest: { kind: 'flow', name: '示例流程', version: '1.0.0' },
};

interface Harness {
  install: ReturnType<typeof createInstaller>['install'];
  calls: {
    detail: string[];
    download: Array<{ path: string; timeoutMs?: number }>;
    installs: string[];
    importArchiveBytes: Array<{ bytes: Uint8Array; opts?: ImportArchiveOpts }>;
    inspectBytes: Uint8Array[];
    commitBytes: Array<{ bytes: Uint8Array; token: string }>;
    installFlow: Array<{ steps: unknown[][]; name: string }>;
    confirm: InstallConfirmData[];
    notify: Array<[string, string]>;
    unauthorized: number;
  };
  setImportResult(r: ImportResult): void;
}

function makeHarness(
  kind: 'node' | 'pack' | 'flow',
  opts: { confirmSeq?: boolean[]; downloadErr?: unknown; installsErr?: unknown; flowErr?: unknown } = {},
): Harness {
  const calls: Harness['calls'] = {
    detail: [],
    download: [],
    installs: [],
    importArchiveBytes: [],
    inspectBytes: [],
    commitBytes: [],
    installFlow: [],
    confirm: [],
    notify: [],
    unauthorized: 0,
  };
  const confirmSeq = [...(opts.confirmSeq ?? [true, true])];
  let importResult: ImportResult = {
    nodes: [{ id: 'n1', type: 'xhs.search', name: '小红书搜索', position: { x: 0, y: 0 }, params: {} }],
    noScript: [],
  };
  const deps: InstallerDeps = {
    client: {
      detail: vi.fn(async (id: string) => {
        calls.detail.push(id);
        return { ...DETAIL, kind };
      }),
      request: async <T,>(path: string, init?: { timeoutMs?: number }): Promise<T> => {
        if (path.endsWith('/download')) {
          if (opts.downloadErr !== undefined) throw opts.downloadErr;
          calls.download.push({ path, timeoutMs: init?.timeoutMs });
          return { data: BYTES, contentType: 'application/zip' } as unknown as T;
        }
        throw new Error(`unexpected request: ${path}`);
      },
      recordInstall: vi.fn(async (id: string) => {
        if (opts.installsErr !== undefined) throw opts.installsErr;
        calls.installs.push(id);
        return { ok: true };
      }),
    },
    importer: {
      importArchiveBytes: vi.fn(async (bytes: Uint8Array, optsArg?: ImportArchiveOpts) => {
        calls.importArchiveBytes.push({ bytes, opts: optsArg });
        // 模拟真实编排：confirm 注入在 inspect 后被调（框2——共用一框）
        if (optsArg?.confirm !== undefined) await optsArg.confirm(FLOW_SUMMARY);
        return importResult;
      }),
      inspectBytes: vi.fn(async (bytes: Uint8Array) => {
        calls.inspectBytes.push(bytes);
        return { summary: FLOW_SUMMARY, token: TOKEN };
      }),
      commitBytes: vi.fn(async (bytes: Uint8Array, token: string) => {
        calls.commitBytes.push({ bytes, token });
        return { nodes: [], noScript: [] };
      }),
    },
    flowInstaller: {
      installFlow: async (steps: readonly (readonly unknown[])[], name: string) => {
        calls.installFlow.push({ steps: steps.map((s) => [...s]), name });
        if (opts.flowErr !== undefined) throw opts.flowErr;
        return { flowId: 'flow-new', nodeCount: steps.length, edgeCount: Math.max(0, steps.length - 1) };
      },
    },
    confirm: vi.fn(async (data: InstallConfirmData) => {
      calls.confirm.push(data);
      return confirmSeq.shift() ?? true;
    }),
    derivePerms: (cats) => (cats.includes('社媒') ? (['社媒'] as const) : []),
    notify: (level, msg) => calls.notify.push([level, msg]),
    onUnauthorized: () => {
      calls.unauthorized += 1;
    },
  };
  return {
    install: createInstaller(deps).install,
    calls,
    setImportResult: (r) => {
      importResult = r;
    },
  };
}

describe('Installer install 链（§6.3：确认前零外发/确认后三步各恰一次/三分支）', () => {
  it('确认前（框1 拒绝）→ 零下载零导入零计量（12.2#2——download/import/installs 全零）', async () => {
    const h = makeHarness('node', { confirmSeq: [false] });
    await expect(h.install({ id: 'pkg-1', kind: 'node' })).rejects.toMatchObject({ name: 'ImportCancelledError' });
    expect(h.calls.detail).toEqual(['pkg-1']); // 匿名详情（确认框数据源）——不计入三零面
    expect(h.calls.download).toHaveLength(0);
    expect(h.calls.importArchiveBytes).toHaveLength(0);
    expect(h.calls.inspectBytes).toHaveLength(0);
    expect(h.calls.installs).toHaveLength(0);
    expect(h.calls.installFlow).toHaveLength(0);
  });

  it('node 安装：确认后 download（大 timeoutMs）→importArchiveBytes（框2 confirm 注入）→installs 各恰一次', async () => {
    const h = makeHarness('node');
    const res = await h.install({ id: 'pkg-1', kind: 'node' });
    expect(h.calls.download).toHaveLength(1);
    expect(h.calls.download[0]!.path).toBe('/api/market/packages/pkg-1/download');
    expect(h.calls.download[0]!.timeoutMs).toBe(MARKET_DOWNLOAD_TIMEOUT_MS); // 大超时（S-05 300s 对齐——评审转交）
    expect(MARKET_DOWNLOAD_TIMEOUT_MS).toBe(300_000);
    expect(h.calls.importArchiveBytes).toHaveLength(1);
    expect(h.calls.importArchiveBytes[0]!.bytes).toBe(BYTES);
    expect(h.calls.installs).toEqual(['pkg-1']);
    expect(res).toMatchObject({ kind: 'node', nodeCount: 1 });
    // 框2 confirm=importArchiveBytes opts 注入（共用一框——两拦截点同组件）
    const opts = h.calls.importArchiveBytes[0]!.opts;
    expect(opts?.source).toBe('user');
    expect(typeof opts?.confirm).toBe('function');
    // 两框数据形（框1=detail 面 nodes 空；框2=summary 面精确清单）
    expect(h.calls.confirm).toHaveLength(2);
    expect(h.calls.confirm[0]!.nodes).toEqual([]);
    expect(h.calls.confirm[1]!.nodes.length).toBeGreaterThan(0);
    expect(h.calls.notify.some(([l]) => l === 'ok')).toBe(true);
  });

  it('pack 安装：整包批量入库（nodeCount=包内全量节点数——demo L3049-3058 语义）', async () => {
    const h = makeHarness('pack');
    h.setImportResult({
      nodes: [1, 2, 3].map((i) => ({ id: `n${i}`, type: 'xhs.search', name: `N${i}`, position: { x: 0, y: 0 }, params: {} })),
      noScript: [],
    });
    const res = await h.install({ id: 'pkg-1', kind: 'pack' });
    expect(res).toMatchObject({ kind: 'pack', nodeCount: 3 });
    expect(h.calls.importArchiveBytes).toHaveLength(1);
    expect(h.calls.installs).toEqual(['pkg-1']);
  });

  it('同日重装（server 幂等 {ok}——S-02 §6.1c 对端）：每次 install 均 POST installs 恰一次', async () => {
    const h = makeHarness('node', { confirmSeq: [true, true, true, true] });
    await h.install({ id: 'pkg-1', kind: 'node' });
    await h.install({ id: 'pkg-1', kind: 'node' });
    expect(h.calls.installs).toEqual(['pkg-1', 'pkg-1']);
    expect(h.calls.download).toHaveLength(2);
  });

  it('flow 安装：download→inspectBytes→框2 确认→commitBytes→FlowInstaller.installFlow(steps,name)→installs', async () => {
    const h = makeHarness('flow');
    const res = await h.install({ id: 'pkg-1', kind: 'flow' });
    expect(h.calls.download).toHaveLength(1);
    expect(h.calls.inspectBytes).toHaveLength(1); // inspect 恰一次
    expect(h.calls.commitBytes).toHaveLength(1); // commit 恰一次（token 透传）
    expect(h.calls.commitBytes[0]!.token).toBe(TOKEN);
    expect(h.calls.commitBytes[0]!.bytes).toBe(BYTES);
    // steps=summary.nodes 三元组回放（BFS 序）；name=detail.name
    expect(h.calls.installFlow).toHaveLength(1);
    expect(h.calls.installFlow[0]!.name).toBe('小红书搜索');
    expect(h.calls.installFlow[0]!.steps).toEqual([
      ['trigger.manual', '手动触发', {}],
      ['http.request', '请求', { url: 'https://x' }],
    ]);
    expect(res).toMatchObject({ kind: 'flow', nodeCount: 2, flowId: 'flow-new' });
    expect(h.calls.installs).toEqual(['pkg-1']);
    expect(h.calls.importArchiveBytes).toHaveLength(0); // flow 不走 node/pack 全链
  });

  it('flow 框2 拒绝 → 零 commit 零 FlowInstaller 零计量（inspect 已发生——下载不可回退但导入零）', async () => {
    const h = makeHarness('flow', { confirmSeq: [true, false] });
    await expect(h.install({ id: 'pkg-1', kind: 'flow' })).rejects.toMatchObject({ name: 'ImportCancelledError' });
    expect(h.calls.download).toHaveLength(1); // 框1 已确认→download 已发生
    expect(h.calls.commitBytes).toHaveLength(0);
    expect(h.calls.installFlow).toHaveLength(0);
    expect(h.calls.installs).toHaveLength(0);
  });

  it('flow 脏闸拒绝（FlowInstaller FlowDirtyRefusedError 透传）→ 零计量', async () => {
    const refused = new FlowDirtyRefusedError();
    const h = makeHarness('flow', { flowErr: refused });
    await expect(h.install({ id: 'pkg-1', kind: 'flow' })).rejects.toBe(refused);
    expect(h.calls.installFlow).toHaveLength(1); // 已到 FlowInstaller
    expect(h.calls.installs).toHaveLength(0); // 安装未成→不计 installs
  });

  it('UNAUTHORIZED（未登录前置拦截）→ 登录引导恰一次＋err 提示＋零导入零计量', async () => {
    const h = makeHarness('node', { downloadErr: new MarketUnauthorizedError() });
    await expect(h.install({ id: 'pkg-1', kind: 'node' })).rejects.toBeInstanceOf(MarketUnauthorizedError);
    expect(h.calls.unauthorized).toBe(1); // 登录引导（LoginDialog 打开——装配位注入）
    expect(h.calls.notify.some(([l]) => l === 'err')).toBe(true);
    expect(h.calls.importArchiveBytes).toHaveLength(0);
    expect(h.calls.installs).toHaveLength(0);
  });

  it('登录态过期（MarketApiError code=UNAUTHORIZED）→ 同登录引导面', async () => {
    const h = makeHarness('node', { downloadErr: new MarketApiError('UNAUTHORIZED', 'token 过期', 401) });
    await expect(h.install({ id: 'pkg-1', kind: 'node' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(h.calls.unauthorized).toBe(1);
    expect(h.calls.installs).toHaveLength(0);
  });

  it('installs 计量失败＝尽力（warn 提示，安装结果照常返回——S-05 §1③ 下载计量在 302 前，此处非安装前提）', async () => {
    const h = makeHarness('node', { installsErr: new Error('网络错误') });
    const res = await h.install({ id: 'pkg-1', kind: 'node' });
    expect(res).toMatchObject({ kind: 'node', nodeCount: 1 });
    expect(h.calls.notify.some(([l]) => l === 'warn')).toBe(true);
  });
});
