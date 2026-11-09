// C-04 CookieSemantics 单测（T4-05；TDD-C-04 §3 CookieSemantics 行——S-3 坑③：
// `Network.setCookie` 不带 expires 生成会话 cookie 不落盘，跨进程即失，须显式 expires（Unix 秒）。
// 组件行接口=—（文档＋测试锚）：本套件即测试锚，构造器保证输出必含显式 expires。
import { describe, expect, it } from 'vitest';
import { COOKIE_EXPIRES_SECONDS, cookieParamsOf } from './cookie-semantics';

describe('坑③：setCookie 须显式 expires（S-3 判据 1 跨进程落盘前提）', () => {
  it('缺省补齐 expires=now+86400（spike main.js 同源 1 天），输出必含 expires 字段', () => {
    const before = Math.floor(Date.now() / 1000);
    const params = cookieParamsOf('s3probe', 'a-value');
    const after = Math.floor(Date.now() / 1000);
    expect(params.name).toBe('s3probe');
    expect(params.value).toBe('a-value');
    expect(params.expires).toBeGreaterThanOrEqual(before + COOKIE_EXPIRES_SECONDS);
    expect(params.expires).toBeLessThanOrEqual(after + COOKIE_EXPIRES_SECONDS);
  });

  it('显式 expiresAt（Unix 秒）与 url 原样透传——调用方自定存活期不被覆写', () => {
    const params = cookieParamsOf('k', 'v', { url: 'https://a.b', expiresAt: 1_900_000_000 });
    expect(params).toEqual({ name: 'k', value: 'v', url: 'https://a.b', expires: 1_900_000_000 });
  });
});
