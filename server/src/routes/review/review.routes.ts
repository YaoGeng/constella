/**
 * review 域路由（TDD-S-03 §1 端点表；T2-08 出 decide/offline 两端点）。
 * 鉴权由装配点注入：T2-09 在 /api/admin/* 子树统一挂 authMiddleware → requireAdmin 后再挂本域路由
 * （S-03 §2「不 import S-04」——currentUser 由装配链注入；未注入时防御性 401）。
 * 队列/工作台/下载预检端点（GET reviews、GET packages/:id、GET packages/:id/download）归 T2-09。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../kernel/kernel.js";
import { ApiError } from "../../kernel/errors.js";
import { decide, takeOffline } from "./review.service.js";
import { idParamSchema, offlineSchema, reviewDecisionSchema } from "./review.schemas.js";

/** 审阅人=装配链注入的 currentUser（requireAdmin）；组件单测以桩中间件注入 */
function reviewerIdOf(c: Context<AppEnv>): string {
  const user = c.get("currentUser");
  if (!user) {
    throw new ApiError("UNAUTHORIZED");
  }
  return user.id;
}

async function parseJsonOr400<T>(
  c: Context<AppEnv>,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

const reviewRoutes = new Hono<AppEnv>();

/** POST /packages/:id/review —— {action,reason?} → {status} */
reviewRoutes.post("/packages/:id/review", async (c) => {
  const reviewerId = reviewerIdOf(c);
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const input = await parseJsonOr400(c, reviewDecisionSchema);
  return c.json(await decide(id, reviewerId, input), 200);
});

/** POST /packages/:id/offline —— {reason} → {status:'offline'} */
reviewRoutes.post("/packages/:id/offline", async (c) => {
  const reviewerId = reviewerIdOf(c);
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const input = await parseJsonOr400(c, offlineSchema);
  return c.json(await takeOffline(id, reviewerId, input), 200);
});

export { reviewRoutes };
