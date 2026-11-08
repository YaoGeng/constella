/**
 * review 域路由（TDD-S-03 §1 端点表五行；T2-08 decide/offline＋T2-09 GET 三端点）。
 * 鉴权由装配点注入：routes/index.ts 在 /api/admin/* 子树统一挂 authMiddleware → requireAdmin
 * 后再挂本域路由（S-03 §2「不 import S-04」——currentUser 由装配链注入；未注入时防御性 401）。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Readable } from "node:stream";
import type { AppEnv } from "../../kernel/kernel.js";
import { ApiError } from "../../kernel/errors.js";
import { decide, takeOffline } from "./review.service.js";
import { inspectPackage, openPackageStream, queue } from "./review-queue.service.js";
import { idParamSchema, offlineSchema, queueQuerySchema, reviewDecisionSchema } from "./review.schemas.js";

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

function parseQueryOr400<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION-FAILED");
  }
  return parsed.data;
}

const reviewRoutes = new Hono<AppEnv>();

/** GET /reviews —— 待审队列分页（status 过滤＋owner 聚合；items 元素形=ReviewQueueItem） */
reviewRoutes.get("/reviews", async (c) => {
  const query = parseQueryOr400(queueQuerySchema, c.req.query());
  return c.json(await queue(query), 200);
});

/** GET /packages/:id —— 工作台包详情聚合（manifest 摘要/脚本清单键集/计量计数） */
reviewRoutes.get("/packages/:id", async (c) => {
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  return c.json(await inspectPackage(id), 200);
});

/** GET /packages/:id/download —— 下载预检流（经 S-05 getStream；attachment——02 §4 预检的 HTTP 形） */
reviewRoutes.get("/packages/:id/download", async (c) => {
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const { stream, semver } = await openPackageStream(id);
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", `attachment; filename="${semver}.zip"`);
  return c.body(Readable.toWeb(stream) as unknown as ReadableStream, 200);
});

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
