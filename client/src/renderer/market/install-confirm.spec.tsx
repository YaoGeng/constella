// @vitest-environment jsdom
// InstallConfirm 用例（T5-10 / TDD-C-09 §3 InstallConfirm 行——02 §12.2#2 拦截点组件；
// 01 §8.2#②：节点清单+脚本清单+权限标签+作者/来源+「将执行本机脚本」明示；noScript 包明示
// 不可运行；来源不可信加强提示）。两拦截点（market 安装框/zip 导入链 confirm 注入）共用一框
// ——数据源两映射工厂（detail 面/summary 面）。组件测试栈=仓库惯例（jsdom＋createRoot/act）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PackageDetail } from '@constella/shared/dto';
import type { PackageManifest } from '@constella/shared/manifest';
import type { ImportSummary } from '../zip/import-orchestrator';
import { confirmDataFromDetail, confirmDataFromSummary, InstallConfirm } from './install-confirm';

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

async function mountConfirm(props: Parameters<typeof InstallConfirm>[0]): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<InstallConfirm {...props} />);
  });
  return { container, root };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
    m.container.remove();
  });
}

async function click(el: Element | null): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const DETAIL: PackageDetail = {
  id: 'pkg-1',
  kind: 'node',
  name: '小红书搜索',
  summary: '搜索笔记',
  author: { id: 'u1', name: 'yeager' },
  perms: ['社媒'],
  downloadCount: 3,
  installCount: 2,
  starCount: 0,
  version: '1.0.0',
  updatedAt: '2026-11-08T02:11:00Z',
  versions: [{ semver: '1.0.0', createdAt: '2026-11-08T02:11:00Z', sizeBytes: 1024, checksum: 'sha256:ab' }],
};

const SUMMARY: ImportSummary = {
  nodes: [
    { type: 'xhs.search', name: '小红书搜索', definition: undefined, noScript: false },
    { type: 'xhs.comment', name: '评论采集', definition: undefined, noScript: true },
  ],
  noScript: ['评论采集'],
  categories: ['社媒'],
  manifest: {
    kind: 'node',
    name: '小红书搜索',
    version: '1.0.0',
    scripts: { 小红书搜索: { file: 'scripts/xhs_search.py', lang: 'python', entry: 'run' } },
  } satisfies PackageManifest,
};

describe('InstallConfirm 数据映射（两拦截点共用一框）', () => {
  it('confirmDataFromDetail：market 框（框1）——detail 面（作者/来源/权限标签；清单未知待下载校验）', () => {
    const data = confirmDataFromDetail(DETAIL);
    expect(data).toMatchObject({
      kind: 'node',
      name: '小红书搜索',
      version: '1.0.0',
      author: '@yeager',
      source: 'market',
      trusted: true,
      perms: ['社媒'],
      nodes: [],
      noScript: [],
      scriptFiles: [],
    });
  });

  it('confirmDataFromSummary：zip 导入链框（框2）——inspect 精确清单（节点/脚本/noScript 点名＋perms 同源）', () => {
    const data = confirmDataFromSummary(SUMMARY, { perms: ['社媒'], author: '@yeager', source: 'market', trusted: true });
    expect(data.nodes).toEqual([
      { type: 'xhs.search', name: '小红书搜索', hasScript: true },
      { type: 'xhs.comment', name: '评论采集', hasScript: false },
    ]);
    expect(data.noScript).toEqual(['评论采集']);
    expect(data.scriptFiles).toEqual(['scripts/xhs_search.py']);
    expect(data.kind).toBe('node');
    expect(data.version).toBe('1.0.0');
  });

  it('confirmDataFromSummary 缺省来源=本地文件导入（不可信——加强提示输入）', () => {
    const data = confirmDataFromSummary(SUMMARY);
    expect(data.source).toBe('zip');
    expect(data.trusted).toBe(false);
    expect(data.author).toBe('');
  });
});

describe('InstallConfirm install 确认框（02 §12.2#2 拦截点组件）', () => {
  it('逐项呈现：节点清单+脚本清单+权限标签+作者/来源+「将执行本机脚本」明示＋确认/取消', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const data = confirmDataFromSummary(SUMMARY, { perms: ['社媒'], author: '@yeager', source: 'market', trusted: true });
    const m = await mountConfirm({ data, onConfirm, onCancel });
    const html = m.container.innerHTML;
    // 节点清单（name＋type＋脚本标记）
    expect(html).toContain('小红书搜索');
    expect(html).toContain('xhs.search');
    // 脚本清单（manifest.scripts 文件）
    expect(html).toContain('scripts/xhs_search.py');
    // 权限标签
    expect(html).toContain('社媒');
    // 作者/来源
    expect(html).toContain('@yeager');
    expect(html).toContain('广场（经审核）');
    // 「将执行本机脚本」明示
    expect(html).toContain('将执行本机脚本');
    // noScript 包明示不可运行
    expect(html).toContain('无法运行');
    // 来源可信（market）→无加强提示条
    expect(m.container.querySelector('[data-ic="untrusted"]')).toBeNull();
    // 确认/取消回调
    await click(m.container.querySelector('[data-ic="confirm"]'));
    await click(m.container.querySelector('[data-ic="cancel"]'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it('来源不可信（本地 zip 导入/未知作者）→ 加强提示条（01 §8.2#②）', async () => {
    const data = confirmDataFromSummary(SUMMARY); // 缺省 trusted=false
    const m = await mountConfirm({ data, onConfirm: vi.fn(), onCancel: vi.fn() });
    const bar = m.container.querySelector('[data-ic="untrusted"]');
    expect(bar?.textContent).toContain('来源不可信');
    await unmount(m);
  });

  it('无权限标签→「无特殊权限」（demo L2908 同构）；清单未知（框1）→ 占位说明', async () => {
    const data = confirmDataFromDetail({ ...DETAIL, perms: [] });
    const m = await mountConfirm({ data, onConfirm: vi.fn(), onCancel: vi.fn() });
    const html = m.container.innerHTML;
    expect(html).toContain('无特殊权限');
    expect(html).toContain('下载校验后'); // 框1 清单未知占位（精确清单在框2）
    await unmount(m);
  });

  it('kind=flow→「将执行本机脚本」不恒示（流程包按脚本实况）；无脚本包=仅 noScript 面', async () => {
    const noScriptPkg = confirmDataFromSummary(
      { nodes: [{ type: 'data.transform', name: '转换', noScript: false }], noScript: [], categories: [], manifest: { kind: 'node', name: '纯内置包', version: '1.0.0' } },
      { perms: [], trusted: true },
    );
    const m = await mountConfirm({ data: noScriptPkg, onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(m.container.innerHTML).not.toContain('将执行本机脚本'); // 零脚本零 custom 节点→不明示
    await unmount(m);
  });
});
