// AuthSession —— client 侧账号会话（T5-09；TDD-C-09 §1 ClientAuthSession＋§3 AuthSession 行）。
//
// 会话存储（§1 冻结）：access=内存；refresh=SecretVault 引用键 key='market.refresh'（经
// secret:* 通道往返——强于 A-01 浏览器端明文存储方案，Electron 具备 safeStorage）；零浏览器端存储。
// bootstrap=静默刷新（启动序：vault 有 refresh→POST /auth/refresh 换新对；失败不弹窗）。
// refresh 失效（AUTH-REFRESH-INVALID/ADMIN-USER-BANNED）→登出＋onAuthChange；
// 断网（MarketTransportError）→不登出（02 §1.3：登录态过期且离线→提示重登、本地功能不受影响）。
// register=201 {user} 无令牌对（S-01 C1）→ client 侧串 /auth/login 自动登录。
//
// 401 单飞刷新的 promise 去重归 MarketApiClient（§3 首行组件职责）；本组件提供刷新原语
// doRefresh（client.refreshAccessToken 注入位）。
import type { LoginRes, RegisterRes, UserProfile } from '@constella/shared/dto';
import type { MarketRequestInit } from './market-api-client';
import { isMarketApiError, isMarketTransportError, MarketApiError } from './market-error';

/** SecretVault 引用键（§1 冻结：key='market.refresh'） */
export const MARKET_REFRESH_KEY = 'market.refresh';

/** secret:* IPC 桥（C-M1 preload 注入位；测试 mock——T4-08 secret-param-binder 同形先例） */
export interface SecretBridgeFace {
  set(req: { key: string; value?: string }): Promise<{ ok: boolean }>;
  get(req: { key: string }): Promise<{ value: string | null }>;
  del(req: { key: string }): Promise<{ ok: boolean }>;
}

/** AuthSession 依赖注入位 */
export interface AuthSessionDeps {
  /** raw transport（MarketApiClient.request 注入——登录/刷新原语匿名直连，无 Bearer/无 401 刷新环） */
  send<T>(path: string, init?: MarketRequestInit): Promise<T>;
  /** secret:* 通道（refresh 往返 SecretVault） */
  secret: SecretBridgeFace;
}

/** client 侧会话面（§1 ClientAuthSession 逐字＋doRefresh（client 401 注入位）/getUser/isLoggedIn 增补） */
export interface ClientAuthSession {
  login(email: string, password: string): Promise<UserProfile>;
  register(email: string, password: string): Promise<UserProfile>;
  bootstrap(): Promise<boolean>;
  logout(): void;
  getAccessToken(): string | null;
  /** 内存 user 档案（未登录 null；mine()/发布弹窗展示用） */
  getUser(): UserProfile | null;
  isLoggedIn(): boolean;
  onAuthChange(fn: () => void): () => void;
  /** 刷新原语（MarketApiClient.refreshAccessToken 注入）：vault 往返＋POST /auth/refresh → 新 access；
   * 失效（AUTH-REFRESH-INVALID/ADMIN-USER-BANNED）→登出＋onAuthChange 后抛原错误。单飞去重在 client。 */
  doRefresh(): Promise<string>;
}

function jsonInit(body: unknown): MarketRequestInit {
  return { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

export function createAuthSession(deps: AuthSessionDeps): ClientAuthSession {
  let accessToken: string | null = null;
  let user: UserProfile | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const fn of [...listeners]) fn();
  }

  /** 新令牌对落位：access/user=内存；refresh=SecretVault（一次性轮换——旧 token 服务端已消费） */
  async function adopt(pair: LoginRes): Promise<void> {
    accessToken = pair.accessToken;
    user = pair.user;
    await deps.secret.set({ key: MARKET_REFRESH_KEY, value: pair.refreshToken });
  }

  async function login(email: string, password: string): Promise<UserProfile> {
    const res = await deps.send<LoginRes>('/api/auth/login', jsonInit({ email, password }));
    await adopt(res);
    notify();
    return res.user;
  }

  async function register(email: string, password: string): Promise<UserProfile> {
    // C1：register 只回 {user}（无令牌对）——自动登录由 client 串 /auth/login（S-01 token.service 留痕）
    await deps.send<RegisterRes>('/api/auth/register', jsonInit({ email, password }));
    return login(email, password);
  }

  /** 登出（§1 void 签名）：内存清空＋vault 引用键清理（fire-and-forget）。
   * notifyWhenCleaned：doRefresh 失效路径置位——内存虽空但 vault 会话确已存在并被清理，须通知。 */
  function logout(notifyWhenCleaned = false): void {
    const hadSession = accessToken !== null || user !== null;
    accessToken = null;
    user = null;
    void deps.secret.del({ key: MARKET_REFRESH_KEY }).catch(() => {
      /* vault 异常不阻塞登出（本地内存态已清；下轮 bootstrap 对 invalid 仍会登出兜底） */
    });
    if (hadSession || notifyWhenCleaned) notify(); // 未登录幂等——不虚发 onAuthChange
  }

  async function doRefresh(): Promise<string> {
    const stored = await deps.secret.get({ key: MARKET_REFRESH_KEY });
    if (stored.value === null) {
      throw new MarketApiError('UNAUTHORIZED', '无刷新令牌——请登录', 401);
    }
    try {
      const pair = await deps.send<LoginRes>('/api/auth/refresh', jsonInit({ refreshToken: stored.value }));
      await adopt(pair);
      notify();
      return pair.accessToken;
    } catch (err) {
      // 失效（AUTH-REFRESH-INVALID/ADMIN-USER-BANNED）→登出＋onAuthChange（§6.1）；
      // 其余（断网 MarketTransportError 等）透传、不登出（02 §1.3：登录态过期且离线→提示重登）
      if (isMarketApiError(err) && (err.code === 'AUTH-REFRESH-INVALID' || err.code === 'ADMIN-USER-BANNED')) {
        logout(true);
      }
      throw err;
    }
  }

  async function bootstrap(): Promise<boolean> {
    const stored = await deps.secret.get({ key: MARKET_REFRESH_KEY });
    if (stored.value === null) return false; // 无会话——零外发
    try {
      await doRefresh();
      return true;
    } catch {
      // 失效已在 doRefresh 内登出；断网保持 vault 原值——静默失败（bootstrap 不弹窗）
      return false;
    }
  }

  return {
    login,
    register,
    bootstrap,
    logout,
    getAccessToken: () => accessToken,
    getUser: () => user,
    isLoggedIn: () => accessToken !== null,
    onAuthChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    doRefresh,
  };
}
