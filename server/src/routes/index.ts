/**
 * 路由聚合装配点（TDD-S-01 C5/§2；T2-01）。
 * 域路由在此聚合；/api 前缀由 src/app.ts 挂载（域间禁互 import——公共能力走 kernel/infra）。
 */
import { Hono } from "hono";
import type { AppEnv } from "../kernel/kernel.js";
import { authRoutes } from "./auth/auth.routes.js";
import { userRoutes } from "./user/user.routes.js";

const routes = new Hono<AppEnv>();
routes.route("/auth", authRoutes);
routes.route("/user", userRoutes);

export { routes };
