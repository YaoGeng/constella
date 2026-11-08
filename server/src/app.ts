/**
 * 应用装配（TDD-S-01 C5；T2-01）：
 * 内核中间件 + /api 前缀路由挂载 + 根路径 healthz。
 * buildApp(opts) 供入口与测试共用——限流/CORS 由装配点注入（测试可传小窗口/无规则实例）。
 */
import { Hono } from "hono";
import { routes } from "./routes/index.js";
import { withKernel } from "./kernel/kernel.js";
import type { AppEnv, KernelOptions } from "./kernel/kernel.js";

export type BuildAppOptions = KernelOptions;

export function buildApp(opts: BuildAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // K3 全局内核（requestId/请求日志/CORS/限流注册点/404/onError）
  withKernel(app, opts);

  // 健康检查（部署标准 §6 接入契约第 3 条）：无鉴权、无数据库依赖，进程存活即 200
  app.get("/healthz", (c) => c.json({ status: "ok" }, 200));

  // C5：业务路由统一挂 /api 前缀（02 §6.1 Base 约定）
  app.route("/api", routes);

  return app;
}
