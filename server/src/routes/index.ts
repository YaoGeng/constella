/**
 * 路由注册中心。
 * 聚合所有业务模块的子路由，统一挂载路径前缀。
 * index.ts 只需导入这一个模块即可完成路由注册。
 */
import { Hono } from "hono";
import { authRoutes } from "./auth/auth.routes.js";
import { userRoutes } from "./user/user.routes.js";

const routes = new Hono();
// 健康检查（部署标准 §6 接入契约第 3 条）：无鉴权、无数据库依赖，进程存活即 200
routes.get("/healthz", (c) => c.json({ status: "ok" }, 200));
routes.route("/auth", authRoutes);
routes.route("/user", userRoutes);

export { routes };
