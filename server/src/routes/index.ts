/**
 * 路由聚合装配点（TDD-S-01 C5/§2；T2-01；T2-05/07 增补 market/openapi）。
 * 域路由在此聚合；/api 前缀由 src/app.ts 挂载（域间禁互 import——公共能力走 kernel/infra）。
 * /api/admin 子树（review S-03 + admin S-04 统一挂 authMiddleware→requireAdmin）归 T2-09 装配。
 */
import { Hono } from "hono";
import type { AppEnv } from "../kernel/kernel.js";
import { authRoutes } from "./auth/auth.routes.js";
import { userRoutes } from "./user/user.routes.js";
import { marketRoutes } from "./market/market.routes.js";
import { openApiRoutes } from "./market/openapi.js";

const routes = new Hono<AppEnv>();
routes.route("/auth", authRoutes);
routes.route("/user", userRoutes);
routes.route("/market", marketRoutes);
// OpenAPI 契约聚合（02 §5.2 工程化）：GET /api/openapi.json
routes.route("/", openApiRoutes);

export { routes };
