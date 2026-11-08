/**
 * 应用入口文件
 * 初始化 Hono 实例、挂载路由、启动服务，并注册进程信号与异常处理
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { routes } from "./routes/index.js";
import { registerProcessHandlers } from "./utils/process-handlers.js";

import { env } from "./utils/env.js";
import { logger } from "./utils/logger.js";


async function bootstrap(): Promise<void> {
  // 创建 Hono 应用实例
  const app = new Hono();

  // 挂载路由（所有子路由由 routes/index.ts 统一聚合）
  app.route("/", routes);

  // 启动 HTTP 服务
  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  registerProcessHandlers(server);

  logger.info("Server started", { port: env.PORT });
}

// 应用入口
void bootstrap();
