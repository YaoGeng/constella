/**
 * admin 域路由（TDD-S-04 §1 端点表；T2-10 users/T2-11 stats）。
 * 鉴权＝装配点注入：T2-09 起 /api/admin/* 子树在 routes/index.ts 统一挂
 * authMiddleware → requireAdmin 后再挂本域与 review 域路由（S-04 §3 admin.routes 行
 * 「自挂」已按 T2-09 去重裁定移除——单一守卫源，避免每请求双次 JWT 验证＋双次查库）。
 * role 不入 JWT：requireAdmin 每请求查库，封禁/降权即时生效。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { ApiError } from "../../kernel/errors.js";
import type { AppEnv } from "../../kernel/kernel.js";
import { banUser, listUsers, unbanUser } from "./user-admin.service.js";
import { overview } from "./stats.service.js";
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

/** GET /admin/stats/overview —— 看板五计数＋daily7d（T2-11） */
const statsHandler = async (c: Context<AppEnv>) => {
  return c.json(await overview(), 200);
};

const adminRoutes = new Hono<AppEnv>();
adminRoutes.get("/users", listHandler);
adminRoutes.post("/users/:id/ban", banHandler);
adminRoutes.post("/users/:id/unban", unbanHandler);
adminRoutes.get("/stats/overview", statsHandler);

export { adminRoutes };
