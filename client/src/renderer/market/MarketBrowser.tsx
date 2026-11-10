// MarketBrowser —— 广场弹窗（T5-09；TDD-C-09 §3 MarketBrowser 行）。
//
// 两 tab 节点/流程（demo L817-820 参照非权威）＋搜索/排序/分页 hooks（use-market-list）＋
// 卡片逐字段↔MarketListItem（X-01 DTO 冻结形：名称/简介/作者/下载量/星级〔展示位保留，V1 恒 0〕
// /版本/权限标签；「节点数/📜 含脚本徽标」无 DTO 字段支撑——以 version/kind 徽标代位，偏离已列报告）。
// 鉴权边界（§1 D-1/X-6）：浏览匿名照常；未登录点下载→登录引导弹窗（LoginDialog）且 onDownload
// 零调用（§6.2 前置拦截的 UI 半段）；baseUrl 空→首次使用引导面板（03 §7.3#2）。
// 下载编排本体（InstallConfirm→download→导入链）归 T5-10 Installer——本组件交 onDownload 注入位。
import { useEffect, useState } from 'react';
import type { MarketListItem, MarketListQuery, MarketListRes, UserProfile } from '@constella/shared/dto';
import { isMarketApiError, isMarketTransportError } from './market-error';
import { LoginDialog } from './LoginDialog';
import { useMarketList, useMarketPagination, useMarketSearch, useMarketSort } from './use-market-list';

/** 列表面（MarketApiClient.list 注入位——测试 fake face） */
export interface MarketListFace {
  list(q?: MarketListQuery): Promise<MarketListRes>;
}

/** 账号面（AuthSession/MarketBrowser 装配位注入——登录引导＋态刷新） */
export interface MarketAuthFace {
  isLoggedIn(): boolean;
  onAuthChange(fn: () => void): () => void;
  login(email: string, password: string): Promise<UserProfile>;
  register(email: string, password: string): Promise<UserProfile>;
}

export interface MarketBrowserProps {
  listFace: MarketListFace;
  auth: MarketAuthFace;
  /** 登录态下载接线（T5-10 Installer 装配位；未登录不触发——先登录引导） */
  onDownload(item: MarketListItem): void;
  onClose(): void;
  /** 页大小（默认 20=server listQuerySchema 默认对端） */
  pageSize?: number;
  /** 离线降级态（T5-11 OfflineDegradation 装配位注入）：true→广场 pill「离线」＋下载/安装置灰
   *  （01 §8.3 断网-广场行）；浏览照常（缓存列表只读投影——use-market-list error.last 数据位） */
  offline?: boolean;
}

type MarketTab = 'node' | 'flow';

/** auth 域错误 → 用户可读文案（02 §6.1 错误码） */
function authErrorMessage(err: unknown): string {
  if (isMarketApiError(err)) {
    switch (err.code) {
      case 'AUTH-INVALID-CREDENTIALS':
        return '邮箱或密码错误';
      case 'AUTH-EMAIL-TAKEN':
        return '邮箱已注册，请直接登录';
      case 'ADMIN-USER-BANNED':
        return '账号已被封禁';
      case 'VALIDATION-FAILED':
        return '输入不合法（邮箱/密码格式）';
      default:
        return err.message;
    }
  }
  if (isMarketTransportError(err)) return '网络错误，请检查连接后重试';
  return '登录失败，请重试';
}

export function MarketBrowser({ listFace, auth, onDownload, onClose, pageSize = 20, offline = false }: MarketBrowserProps) {
  const [tab, setTab] = useState<MarketTab>('node');
  const search = useMarketSearch();
  const sortCtl = useMarketSort();
  const [total, setTotal] = useState(0);
  const pager = useMarketPagination(total, pageSize); // total 由列表态回填（下述 effect）

  const query: MarketListQuery = {
    kind: tab,
    ...(search.committed !== '' ? { q: search.committed } : {}),
    sort: sortCtl.sort,
    page: pager.page,
    pageSize,
  };
  const { state } = useMarketList(listFace.list, query);

  // 登录态变化 → 重渲染（下载按钮/入口态刷新，§1 onAuthChange 用途行）
  const [, setAuthTick] = useState(0);
  useEffect(() => auth.onAuthChange(() => setAuthTick((t) => t + 1)), [auth]);

  // total 回填分页 hook（query 里的 page 取自 pager）
  useEffect(() => {
    if (state.phase === 'ready') setTotal(state.total);
  }, [state]);

  // 切 tab → 页复位（搜索/排序保留）
  const switchTab = (next: MarketTab): void => {
    if (next === tab) return;
    setTab(next);
    pager.setPage(1);
  };

  // —— 登录引导弹窗（未登录下载/安装操作 → 引导）——
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const submitLogin = (email: string, password: string): void => {
    setLoginBusy(true);
    setLoginError(null);
    void auth
      .login(email, password)
      .then(() => setLoginOpen(false))
      .catch((err: unknown) => setLoginError(authErrorMessage(err)))
      .finally(() => setLoginBusy(false));
  };
  const submitRegister = (email: string, password: string): void => {
    setLoginBusy(true);
    setLoginError(null);
    void auth
      .register(email, password)
      .then(() => setLoginOpen(false))
      .catch((err: unknown) => setLoginError(authErrorMessage(err)))
      .finally(() => setLoginBusy(false));
  };

  const requestDownload = (item: MarketListItem): void => {
    if (!auth.isLoggedIn()) {
      setLoginError(null);
      setLoginOpen(true); // 登录引导弹窗（§6.2）——onDownload 零调用
      return;
    }
    onDownload(item); // T5-10 Installer 接线位
  };

  const items: MarketListItem[] =
    state.phase === 'ready' ? state.items : state.phase === 'loading' || state.phase === 'error' ? (state.last?.items ?? []) : [];

  return (
    <div
      data-browser="root"
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(3,6,16,0.72)]"
    >
      <div
        data-browser="panel"
        className="flex h-[80vh] w-[960px] max-w-[92vw] flex-col gap-3 rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <b className="text-base font-semibold text-[var(--tx)]">广场</b>
            {offline && (
              // B-9 广场 pill 离线态（01 A-1.2 经 02 §1.3——OfflineDegradation 状态源）
              <span
                data-browser="offline-pill"
                className="rounded border border-[rgba(150,110,40,0.6)] bg-[rgba(120,80,20,0.22)] px-1.5 py-0.5 text-[10px] leading-3 text-[#e8c37a]"
              >
                离线
              </span>
            )}
          </div>
          <button
            type="button"
            data-browser="close"
            title="关闭广场"
            className="rounded px-2 py-0.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {state.phase === 'unconfigured' ? (
          <div
            data-browser="guide"
            className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--line-2)] p-6 text-center"
          >
            <p className="text-sm font-semibold text-[var(--tx)]">尚未配置广场服务地址</p>
            <p className="max-w-md text-xs leading-5 text-[var(--tx-3)]">
              在设置中填写广场服务基址（settings 键 <code>market.baseUrl</code>，默认留空）后即可浏览节点与流程广场。
              例如自托管部署地址或官方服务地址。
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-md border border-[var(--line-2)] p-1 text-sm">
                <button
                  type="button"
                  data-tab="node"
                  className={`rounded px-3 py-1 ${tab === 'node' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-2)]'}`}
                  onClick={() => switchTab('node')}
                >
                  节点
                </button>
                <button
                  type="button"
                  data-tab="flow"
                  className={`rounded px-3 py-1 ${tab === 'flow' ? 'bg-[var(--accent-tint)] text-[var(--accent-hi)]' : 'text-[var(--tx-2)]'}`}
                  onClick={() => switchTab('flow')}
                >
                  流程
                </button>
              </div>
              <input
                data-browser="search-input"
                type="search"
                placeholder={`搜索${tab === 'node' ? '节点' : '流程'}（回车）`}
                className="min-w-0 flex-1 rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-3 py-1.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent)]"
                value={search.text}
                onChange={(e) => search.setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    search.commit();
                  }
                }}
              />
              <select
                data-browser="sort"
                className="rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.6)] px-2 py-1.5 text-sm text-[var(--tx)] outline-none"
                value={sortCtl.sort}
                onChange={(e) => sortCtl.setSort(e.target.value === 'downloads' ? 'downloads' : 'latest')}
              >
                <option value="latest">最新发布</option>
                <option value="downloads">下载量</option>
              </select>
            </div>

            {state.phase === 'error' && (
              <div
                data-browser="error"
                className="rounded-md border border-[rgba(120,60,60,0.6)] bg-[rgba(120,20,40,0.18)] px-3 py-2 text-xs text-[#ff9db0]"
              >
                {isMarketTransportError(state.error)
                  ? '无法连接广场服务（网络不可用或服务离线）——可继续浏览最近一次列表'
                  : isMarketApiError(state.error)
                    ? `广场请求失败：${state.error.message}${state.error.requestId ? `（requestId: ${state.error.requestId}）` : ''}`
                    : '广场请求失败'}
              </div>
            )}

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {items.length === 0 && state.phase === 'loading' && (
                <p className="p-4 text-center text-sm text-[var(--tx-3)]">加载中…</p>
              )}
              {items.length === 0 && (state.phase === 'ready' || state.phase === 'error') && (
                <p className="p-4 text-center text-sm text-[var(--tx-3)]">暂无内容</p>
              )}
              {items.map((it) => (
                <article
                  key={it.id}
                  data-card={it.id}
                  className="flex items-start gap-3 rounded-md border border-[var(--line-2)] bg-[rgba(3,6,16,0.45)] p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <b data-field="name" className="truncate text-sm font-semibold text-[var(--tx)]">
                        {it.name}
                      </b>
                      <span
                        data-field="version"
                        className="shrink-0 rounded bg-[var(--accent-tint)] px-1.5 font-mono text-[10px] leading-4 text-[var(--accent-hi)]"
                      >
                        v{it.version}
                      </span>
                      <span className="shrink-0 rounded border border-[var(--line-2)] px-1.5 text-[10px] leading-4 text-[var(--tx-3)]">
                        {it.kind === 'flow' ? '流程' : it.kind === 'pack' ? '节点包' : '节点'}
                      </span>
                    </div>
                    <p data-field="summary" className="truncate text-xs text-[var(--tx-2)]">
                      {it.summary ?? '（无简介）'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--tx-3)]">
                      <span data-field="author">{it.author.name}</span>
                      <span data-field="downloads">↓ {it.downloadCount}</span>
                      <span data-field="stars">★ {it.starCount}</span>
                      {it.perms.map((p) => (
                        <span
                          key={p}
                          data-field="perm"
                          className="rounded border border-[var(--line-2)] px-1.5 leading-4 text-[var(--tx-2)]"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-card-download
                    disabled={offline}
                    title={offline ? '离线中——安装不可用（01 §8.3）' : undefined}
                    className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[#04101f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => requestDownload(it)}
                  >
                    {offline ? '离线' : auth.isLoggedIn() ? '下载' : '登录后下载'}
                  </button>
                </article>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--tx-2)]">
              <button
                type="button"
                data-browser="prev"
                disabled={!pager.canPrev}
                className="rounded border border-[var(--line-2)] px-3 py-1 hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={pager.prev}
              >
                上一页
              </button>
              <span data-browser="page" className="font-mono">
                {pager.page} / {pager.pageCount}
              </span>
              <button
                type="button"
                data-browser="next"
                disabled={!pager.canNext}
                className="rounded border border-[var(--line-2)] px-3 py-1 hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={pager.next}
              >
                下一页
              </button>
            </div>
          </>
        )}

        {loginOpen && (
          <LoginDialog
            busy={loginBusy}
            error={loginError}
            onLogin={submitLogin}
            onRegister={submitRegister}
            onClose={() => setLoginOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
