/**
 * 用户业务路由。
 * 当前包含：GET /user/profile — 获取当前登录用户信息（JWT 保护）。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../auth/auth.middleware.js";
import { prisma } from "../../utils/prisma.js";

/** 获取当前用户信息：解析 JWT payload 中的 sub → 查询用户 → 返回（不含 passwordHash） */
const getCurrentUser = async (c: Context) => {
  // 从 JWT 中间件提取已解码的 payload
  const jwtPayload = c.get("jwtPayload") as { sub: string; email: string; exp: number };
  const user = await prisma.user.findUnique({ where: { id: jwtPayload.sub } });

  if (!user) {
    return c.json({ error: "User not found" }, 401);
  }

  return c.json({ id: user.id, email: user.email, createdAt: user.createdAt }, 200);
};

/** 用户子路由：/profile 需要 Bearer JWT 认证 */
const userRoutes = new Hono();
userRoutes.get("/profile", authMiddleware, getCurrentUser);

export { userRoutes };
