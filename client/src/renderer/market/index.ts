// market 域导出面（T5-09；TDD-C-09 §3 组件落位 client/src/renderer/market/）。
//
// createMarketStack=client+auth 装配工厂（P5 应用壳消费位）：client 持 401 单飞（§3 首行
// 组件职责），auth 持会话态（access 内存/refresh SecretVault）；两件经延迟闭包互注——
// bootstrap 静默刷新由装配点在启动序调用。
export { createMarketApiClient } from './market-api-client';
export type {
  MarketApiClient,
  MarketApiClientDeps,
  MarketRequestInit,
  MarketDownloadResult,
  MarketPublishMeta,
} from './market-api-client';
export {
  isMarketApiError,
  isMarketTransportError,
  isMarketUnauthorizedError,
  isMarketUnconfiguredError,
  MarketApiError,
  MarketTransportError,
  MarketUnauthorizedError,
  MarketUnconfiguredError,
} from './market-error';
export type { TransportFailureKind } from './market-error';
export { MARKET_REFRESH_KEY, createAuthSession } from './auth-session';
export type { AuthSessionDeps, ClientAuthSession, SecretBridgeFace } from './auth-session';
export { LoginDialog } from './LoginDialog';
export type { LoginDialogProps } from './LoginDialog';
export { MarketBrowser } from './MarketBrowser';
export type { MarketBrowserProps, MarketAuthFace, MarketListFace } from './MarketBrowser';
export { useMarketList, useMarketPagination, useMarketSearch, useMarketSort } from './use-market-list';
export type { MarketListState, UseMarketList } from './use-market-list';

import { createMarketApiClient } from './market-api-client';
import type { MarketApiClient, MarketApiClientDeps } from './market-api-client';
import { createAuthSession } from './auth-session';
import type { ClientAuthSession, SecretBridgeFace } from './auth-session';

/** market 栈（client＋auth 互注装配） */
export interface MarketStack {
  client: MarketApiClient;
  auth: ClientAuthSession;
}

/** 栈装配依赖（与 MarketApiClientDeps 同源的注入位——fetch/secret 测试 mock 用） */
export interface MarketStackDeps {
  /** settings `market.baseUrl` 读取面（默认空＋首次使用引导——03 §7.3#2） */
  baseUrl(): string;
  secret: SecretBridgeFace;
  fetch?: typeof fetch;
}

export function createMarketStack(deps: MarketStackDeps): MarketStack {
  // 延迟互注：client.refreshAccessToken→auth.doRefresh；auth.send→client.request（匿名原语）
  let authRef: ClientAuthSession | null = null;
  const clientDeps: MarketApiClientDeps = {
    baseUrl: deps.baseUrl,
    getAccessToken: () => authRef?.getAccessToken() ?? null,
    refreshAccessToken: () => {
      if (authRef === null) return Promise.reject(new Error('market stack: auth 未装配'));
      return authRef.doRefresh();
    },
    fetch: deps.fetch,
  };
  const client = createMarketApiClient(clientDeps);
  const auth = createAuthSession({
    send: (path, init) => client.request(path, init),
    secret: deps.secret,
  });
  authRef = auth;
  return { client, auth };
}
