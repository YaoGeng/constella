/**
 * 路由聚合装配点（TDD-S-01 C5/§2；T2-01；T2-05/07 增补 market/openapi；T2-09 增补 /api/admin 子树）。
 * 域路由在此聚合；/api 前缀由 src/app.ts 挂载（域间禁互 import——公共能力走 kernel/infra）。
 * /api/admin 子树（T2-09）：统一挂 authMiddleware → requireAdmin **后**再挂 review(S-03)/admin(S-04)
 * 两域路由（use 先于 route）——S-03 §2「不 import S-04」的装配面：守卫只在装配点出现一次
 * （adminRoutes 原 T2-10 自挂守卫已移除——单一守卫源，避免每请求双次 JWT 验证＋双次查库）。
 */
import { Hono } from "hono";
import { authMiddleware } from "../kernel/auth.middleware.js";
import type { AppEnv } from "../kernel/kernel.js";
import { authRoutes } from "./auth/auth.routes.js";
import { userRoutes } from "./user/user.routes.js";
import { marketRoutes } from "./market/market.routes.js";
import { openApiRoutes } from "./market/openapi.js";
import { adminRoutes } from "./admin/admin.routes.js";
import { requireAdmin } from "./admin/rbac.middleware.js";
import { reviewRoutes } from "./review/review.routes.js";

const routes = new Hono<AppEnv>();

// /api/admin/* 子树：鉴权链先挂（use 先于 route），两域路由随后挂载其下
const adminSubtree = new Hono<AppEnv>();
adminSubtree.use("*", authMiddleware);
adminSubtree.use("*", requireAdmin);
adminSubtree.route("/", reviewRoutes);
adminSubtree.route("/", adminRoutes);
routes.route("/admin", adminSubtree);

routes.route("/auth", authRoutes);
routes.route("/user", userRoutes);
routes.route("/market", marketRoutes);
// OpenAPI 契约聚合（02 §5.2 工程化）：GET /api/openapi.json
routes.route("/", openApiRoutes);

export { routes };
