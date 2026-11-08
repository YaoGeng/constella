/**
 * KernelMiddleware（TDD-S-01 §3/K3；T2-01）：requestId/请求日志/CORS/限流注册点/404/全局 onError。
 * withKernel(app, {corsOrigins, rateRules}) —— src/app.ts 装配，全域生效。
 */
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { User } from "../../generated/prisma/client.js";
import { logger } from "../utils/logger.js";
import { ApiError, defaultMessageOf, errorBody } from "./errors.js";
import type { ErrorCode } from "@constella/shared/dto";
import { rateLimit } from "./rate-limit.js";

/** server 全域 Hono 环境类型（requestId＝K3 内核注入；currentUser＝requireActiveUser 注入；jwtPayload＝hono/jwt 注入） */
export type AppEnv = {
  Variables: {
    requestId: string;
    currentUser: User;
    jwtPayload: Record<string, unknown>;
  };
};

/** 限流注册点规则形（path 支持 hono 路径模式，如 /api/auth/register 或 /api/x/*） */
export interface RateRule {
  path: string;
  limit: number;
  windowMs: number;
}

export interface KernelOptions {
  /** 放行的 Origin 列表（默认 app://——client HTTP 直连，02 §3.4 注） */
  corsOrigins?: string[];
  /** 限流规则（装配点声明；auth 三接口设计值 10/min/IP） */
  rateRules?: RateRule[];
}

/** HTTPException 状态→错误码（hono/jwt 鉴权失败抛 401 HTTPException→统一体） */
const CODE_BY_HTTP_STATUS: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION-FAILED",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT-FOUND",
  409: "CONFLICT",
  429: "RATE-LIMITED",
};

/**
 * 挂载全局内核（顺序＝请求流经顺序）：
 * requestId（首）→ CORS → 限流规则 → 404 → onError。
 */
export function withKernel(app: Hono<AppEnv>, opts: KernelOptions = {}): void {
  const corsOrigins = opts.corsOrigins ?? ["app://"];

  // K3 requestId：uuid → c.set + X-Request-Id 响应头 + 每请求一行日志
  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    const startAt = Date.now();
    await next();
    c.res.headers.set("X-Request-Id", requestId);
    logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startAt,
    });
  });

  // K3 CORS：env 驱动（CORS_ORIGINS，默认 app://）；放行 Authorization/Content-Type
  app.use("*", cors({ origin: corsOrigins, allowHeaders: ["Authorization", "Content-Type"] }));

  // K3 限流注册点：规则在装配点（src/index.ts）声明，此处统一挂载
  for (const rule of opts.rateRules ?? []) {
    app.use(rule.path, rateLimit({ name: rule.path, limit: rule.limit, windowMs: rule.windowMs }));
  }

  // 404 → 统一错误体 NOT-FOUND
  app.notFound((c) => {
    const requestId = c.get("requestId") ?? "";
    return c.json(errorBody("NOT-FOUND", "Not found", requestId), 404);
  });

  // 全局 onError → 统一错误体（02 §6.1）；未知异常不外泄细节
  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "";
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message, requestId), err.status);
    }
    if (err instanceof HTTPException) {
      const code = CODE_BY_HTTP_STATUS[err.status] ?? "INTERNAL";
      return c.json(errorBody(code, err.message || defaultMessageOf(code), requestId), err.status);
    }
    logger.error("unhandled error", { requestId, error: String(err) });
    return c.json(errorBody("INTERNAL", "Internal server error", requestId), 500);
  });
}

/** 便于域路由声明类型的 re-export（域→kernel 单向依赖） */
export type { MiddlewareHandler };
