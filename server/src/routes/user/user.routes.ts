/**
 * user 域路由（TDD-S-01 §1 端点表 user 行；T2-04）。
 * GET /api/user/profile：requireActiveUser（kernel——JWT sub→prisma 查，不存在/BANNED→401 封禁即时生效）。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../kernel/kernel.js";
import { requireActiveUser } from "../../kernel/auth.middleware.js";
import { toUserProfile } from "../../kernel/user.js";

/** 资料端点：{user:{id,email,role,isAuthor,createdAt}}（S-01 端点表；UserProfile 超集） */
const getProfile = async (c: Context<AppEnv>) => {
  const user = c.get("currentUser");
  return c.json(
    { user: { ...toUserProfile(user), isAuthor: user.isAuthor, createdAt: user.createdAt.toISOString() } },
    200,
  );
};

/** 用户子路由：/profile 需有效且未封禁的 Bearer JWT */
const userRoutes = new Hono<AppEnv>();
userRoutes.get("/profile", requireActiveUser, getProfile);

export { userRoutes };
