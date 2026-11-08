/**
 * 内存限流中间件（TDD-S-01 K3；T2-01）。
 * 固定窗口计数；单容器前提（部署标准 §6.1——多实例部署时换共享存储后端，
 * TDD-S-01 §8 扩展点②）。auth 三接口设计值 10 次/分/IP。
 */
import type { MiddlewareHandler } from "hono";
import { errorBody } from "./errors.js";

/** 桶状态（key → 窗口计数） */
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** 窗口内允许的请求数（超出→429 RATE-LIMITED） */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 规则名（进桶 key，避免不同规则互相污染） */
  name: string;
}

/** 取客户端 IP：XFF 首段（反代后）→ node-server remote → unknown */
function clientIpOf(c: Parameters<MiddlewareHandler>[0]): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const remote = (c.env as { info?: { remote?: { address?: string } } } | undefined)?.info?.remote;
  return remote?.address ?? "unknown";
}

/** 内存桶表（进程内单例；机会式清理防无限增长） */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function sweepIfBloat(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { limit, windowMs, name } = opts;
  return async (c, next) => {
    const key = `${name}:${clientIpOf(c)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    sweepIfBloat();

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const requestId = c.get("requestId") ?? "";
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(errorBody("RATE-LIMITED", "Too many requests", requestId), 429);
    }
    await next();
  };
}

/** 仅测试用：清空桶表 */
export function resetRateLimitForTests(): void {
  buckets.clear();
}
