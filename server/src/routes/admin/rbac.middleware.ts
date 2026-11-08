/**
 * RbacMiddleware（TDD-S-04 §1 RBAC 导出段；T2-10）：requireAdmin。
 * 链在 S-01 authMiddleware 之后：JWT sub → prisma 查 {role,status}；
 * 不存在 → 401；BANNED → 401 ADMIN-USER-BANNED（与 requireActiveUser 同口径）；
 * role!=ADMIN → 403 FORBIDDEN ＋ logger.warn('admin.rbac') 审计。
 * role 不入 JWT payload（token.service 签发仅 sub/email/exp）——封禁/降权即时生效，不等 15min 过期。
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../../kernel/kernel.js";
import { ApiError } from "../../kernel/errors.js";
import { prisma } from "../../utils/prisma.js";
import { logger } from "../../utils/logger.js";

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const payload = c.get("jwtPayload");
  const sub = payload && typeof payload["sub"] === "string" ? payload["sub"] : undefined;
  if (!sub) {
    logger.warn("admin.rbac", { sub: undefined, path: c.req.path, reason: "missing-sub" });
    throw new ApiError("UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user) {
    logger.warn("admin.rbac", { sub, path: c.req.path, reason: "user-not-found" });
    throw new ApiError("UNAUTHORIZED");
  }
  if (user.status === "BANNED") {
    logger.warn("admin.rbac", { sub, path: c.req.path, reason: "banned" });
    throw new ApiError("ADMIN-USER-BANNED");
  }
  if (user.role !== "ADMIN") {
    logger.warn("admin.rbac", { sub, path: c.req.path, reason: "not-admin" });
    throw new ApiError("FORBIDDEN");
  }

  c.set("currentUser", user);
  await next();
};
