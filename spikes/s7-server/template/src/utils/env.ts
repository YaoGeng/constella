/**
 * 环境变量加载与校验
 * 优先加载 .env.{APP_ENV}，再用 .env 补全；APP_ENV 自动映射为 NODE_ENV
 * 最终通过 Zod schema 统一校验
 */

import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const appEnvSchema = z.enum(["dev", "test", "prod"]);
const nodeEnvSchema = z.enum(["development", "test", "production"]);

// APP_ENV → NODE_ENV 映射关系
const appEnvToNodeEnv: Record<z.infer<typeof appEnvSchema>, z.infer<typeof nodeEnvSchema>> = {
  dev: "development",
  test: "test",
  prod: "production",
};

const appEnv = appEnvSchema.parse(process.env.APP_ENV ?? "dev");

// .env.{APP_ENV} 优先加载，.env 补全缺失项
// 平台/cross-env 注入的变量始终优先（override: false）
const envFile = path.resolve(`.env.${appEnv}`);
if (existsSync(envFile)) {
  dotenv.config({ path: envFile, override: false });
}
dotenv.config({ override: false });

if (!process.env.APP_ENV) {
  process.env.APP_ENV = appEnv;
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = appEnvToNodeEnv[appEnv];
}

// Zod schema：统一校验所有环境变量
const envSchema = z.object({
  APP_ENV: appEnvSchema.default("dev"),
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().default(4399),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
