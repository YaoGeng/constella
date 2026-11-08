/**
 * 进程信号与未捕获异常处理工具。
 * 妥善处理 SIGTERM / SIGINT 优雅关闭，以及 uncaughtException / unhandledRejection 异常捕获。
 */
import type { ServerType } from "@hono/node-server";
import { logger } from "./logger.js";

export function registerProcessHandlers(server: ServerType): void {
  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM, shutting down");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    logger.info("Received SIGINT, shutting down");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: String(error) });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
    process.exit(1);
  });
}
