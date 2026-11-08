/**
 * 内核鉴权中间件（TDD-S-01 §1 内核导出；T2-01 骨架/T2-04 行为）。
 * authMiddleware：hono/jwt HS256（模板语义保留；C7——sign/verify 一律取 hono/jwt 公共入口，不触内部路径）。
 * requireActiveUser：JWT sub → prisma 查 user；不存在/BANNED → 401（封禁即时生效）。
 */
import type { MiddlewareHandler } from "hono";
import { jwt, verify } from "hono/jwt";
import type { User } from "../../generated/prisma/client.js";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";
import { ApiError } from "./errors.js";
import type { AppEnv } from "./kernel.js";

/** JWT 中间件（验证失败自动 401，全局 onError 渲染统一体）；S-02~S-04 域复用 */
export const authMiddleware = jwt({
  secret: env.JWT_SECRET,
  alg: "HS256",
});

/** Authorization: Bearer 验签，返回 payload（无效/缺失 → 401 UNAUTHORIZED） */
async function verifyBearerToken(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<Record<string, unknown>> {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new ApiError("UNAUTHORIZED");
  }
  const token = header.slice("Bearer ".length);
  try {
    return await verify(token, env.JWT_SECRET, "HS256");
  } catch {
    throw new ApiError("UNAUTHORIZED");
  }
}

/**
 * 要求有效且未封禁的用户：JWT sub → prisma 查 user；
 * 用户不存在 → 401 UNAUTHORIZED；BANNED → 401 ADMIN-USER-BANNED（即时生效）。
 * 通过后 c.set('currentUser', user) 供 handler 使用。
 */
export const requireActiveUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const payload = await verifyBearerToken(c);
  const sub = typeof payload["sub"] === "string" ? payload["sub"] : undefined;
  if (!sub) {
    throw new ApiError("UNAUTHORIZED");
  }
  const user: User | null = await prisma.user.findUnique({ where: { id: sub } });
  if (!user) {
    throw new ApiError("UNAUTHORIZED");
  }
  if (user.status === "BANNED") {
    throw new ApiError("ADMIN-USER-BANNED");
  }
  c.set("currentUser", user);
  await next();
};
