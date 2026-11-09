// CookieSemantics —— C-04 cookie 语义规格（T4-05；TDD-C-04 §3 CookieSemantics 行——接口=—〔文档＋测试锚〕）。
//
// 【S-3 坑③ 文档锚】`Network.setCookie` 不带 expires 生成**会话 cookie**：仅进程内、不落盘，
// 进程退出即失（spikes/s3-cdp REPORT.md 发现 3）。跨进程持久必须显式 expires（Unix 秒）。
// 适用面：内置 cdp.* 语义与沙箱脚本作者（ctx.browser 文档同锚）；partition=persist:<flowId>·<laneLabel>
// 的跨进程落盘（S-3 判据 1）以显式 expires 为前提。
//
// 本件交付=显式 expires 构造器（输出必含 expires——缺省补 1 天，spike main.js 同源）＋测试锚。

/** 缺省存活期=86400 秒（1 天；spike s3-cdp main.js setCookie 同源值） */
export const COOKIE_EXPIRES_SECONDS = 86_400;

/** Network.setCookie params（桥白名单内 method；expires 恒显式——坑③构造保证） */
export interface CookieParams {
  readonly name: string;
  readonly value: string;
  readonly url?: string;
  readonly expires: number;
}

/** 显式 expires 构造：缺省=now+COOKIE_EXPIRES_SECONDS；expiresAt（Unix 秒）显式覆盖不被覆写 */
export function cookieParamsOf(
  name: string,
  value: string,
  opts?: { url?: string; expiresAt?: number },
): CookieParams {
  const expires = opts?.expiresAt ?? Math.floor(Date.now() / 1000) + COOKIE_EXPIRES_SECONDS;
  return { name, value, ...(opts?.url !== undefined ? { url: opts.url } : {}), expires };
}
