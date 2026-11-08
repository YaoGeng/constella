/**
 * 结构化 JSON 日志工具。
 * 所有日志均序列化为 JSON 行，便于生产环境日志收集（如 stdout 重定向、日志平台采集）。
 * 不依赖外部日志库，仅用 console 方法输出，保持零依赖。
 */
type LogLevel = "info" | "warn" | "error";

// 统一格式化日志负载：level、message、ISO 时间戳、任意上下文
function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  console[level](JSON.stringify(payload));
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>): void => {
    log("info", message, context);
  },
  warn: (message: string, context?: Record<string, unknown>): void => {
    log("warn", message, context);
  },
  error: (message: string, context?: Record<string, unknown>): void => {
    log("error", message, context);
  },
};
