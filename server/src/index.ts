/**
 * 应用入口（T2-01）：
 * 装配内核（CORS/限流规则在此注册）+ /api 路由，启动 HTTP 服务与进程信号处理。
 * S-05 StorageFactory 装配点：启动即构造单例（配置错误 fail-fast；T2-06/07/09 依赖注入）。
 * T2-11 AdminSeed 启动钩子：entrypoint 迁移后注入（Docker=docker-entrypoint.sh migrate deploy →
 * node dist/src/index.js；本地 dev=tsx watch 同入口 bootstrap——两形态同生效）；幂等、失败不阻断启动。
 */
import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { seedAdmin } from "./routes/admin/admin-seed.js";
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

async function bootstrap(): Promise<void> {
  // S-05 装配点：读 env 一次性构造存储单例（disk 默认；s3=T2-13 升级位，缺 S3_* env fail-fast）
  getStorage();

  // AdminSeed（T2-11）：首个 ADMIN 引导——幂等（同 email 跳过），失败 log-and-continue（下次启动重试）
  try {
    await seedAdmin();
  } catch (err) {
    logger.error("AdminSeed failed (server continues; retried on next start)", { error: String(err) });
  }

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
