/**
 * 应用入口（T2-01）：
 * 装配内核（CORS/限流规则在此注册）+ /api 路由，启动 HTTP 服务与进程信号处理。
 * S-05 StorageFactory 装配点：启动即构造单例（配置错误 fail-fast；T2-06/07/09 依赖注入）。
 */
import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { getStorage } from "./infra/storage/storage.factory.js";
import type { RateRule } from "./kernel/kernel.js";
import { env } from "./utils/env.js";
import { logger } from "./utils/logger.js";
import { registerProcessHandlers } from "./utils/process-handlers.js";

/** K3 限流注册点：auth 三接口 10 次/分/IP（设计值；内存实现——单容器前提） */
const AUTH_RATE_RULES: RateRule[] = [
  { path: "/api/auth/register", limit: 10, windowMs: 60_000 },
  { path: "/api/auth/login", limit: 10, windowMs: 60_000 },
  { path: "/api/auth/refresh", limit: 10, windowMs: 60_000 },
];

function bootstrap(): void {
  // S-05 装配点：读 env 一次性构造存储单例（disk 默认；s3 随 T2-13）
  getStorage();

  const app = buildApp({
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateRules: AUTH_RATE_RULES,
  });

  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  registerProcessHandlers(server);

  logger.info("Server started", { port: env.PORT });
}

// 应用入口
void bootstrap();
