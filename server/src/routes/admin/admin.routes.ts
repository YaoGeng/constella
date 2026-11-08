/**
 * admin 域路由（TDD-S-04 §1 端点表；T2-10）——users 三端点（stats/overview 归 T2-11）。
 * 自挂 authMiddleware → requireAdmin（S-04 §3 admin.routes 行）；装配到 /api/admin 子树在 T2-09
 * （届时子树级守卫与本自挂幂余但无害——如需去重由 T2-09 装配时裁定）。
 * role 不入 JWT：requireAdmin 每请求查库，封禁/降权即时生效。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../../kernel/auth.middleware.js";
import { ApiError } from "../../kernel/errors.js";
import type { AppEnv } from "../../kernel/kernel.js";
import { requireAdmin } from "./rbac.middleware.js";
import { banUser, listUsers, unbanUser } from "./user-admin.service.js";
import { banSchema, idParamSchema, usersQuerySchema } from "./admin.schemas.js";

function parseOr400<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

/** GET /admin/users?q=&page= */
const listHandler = async (c: Context<AppEnv>) => {
  const query = parseOr400(usersQuerySchema, c.req.query());
  return c.json(await listUsers(query), 200);
};

/** POST /admin/users/:id/ban {reason} */
const banHandler = async (c: Context<AppEnv>) => {
  const operator = c.get("currentUser");
  const { id } = parseOr400(idParamSchema, { id: c.req.param("id") });
  const input = parseOr400(banSchema, await c.req.json().catch(() => undefined));
  return c.json(await banUser(id, operator.id, input), 200);
};

/** POST /admin/users/:id/unban {} */
const unbanHandler = async (c: Context<AppEnv>) => {
  const operator = c.get("currentUser");
  const { id } = parseOr400(idParamSchema, { id: c.req.param("id") });
  await c.req.json().catch(() => undefined); // body 无业务字段，容忍空/缺失
  return c.json(await unbanUser(id, operator.id), 200);
};

const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", authMiddleware);
adminRoutes.use("*", requireAdmin);
adminRoutes.get("/users", listHandler);
adminRoutes.post("/users/:id/ban", banHandler);
adminRoutes.post("/users/:id/unban", unbanHandler);

export { adminRoutes };
