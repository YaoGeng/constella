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
// C8（T2-01）：删除 refresh 签名密钥项（refresh 非 JWT、未使用——S-7 剥离）；
// PORT 默认 4399→8051（部署标准 §2.3）；增 CORS_ORIGINS（K3）与存储项（TDD-S-05 §1 env 表）
const envSchema = z.object({
  APP_ENV: appEnvSchema.default("dev"),
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().default(8051),
  // 逗号分隔来源列表；client HTTP 直连（02 §3.4 注），默认 app://
  CORS_ORIGINS: z.string().min(1).default("app://"),
  // 对象存储（TDD-S-05）：disk 生产默认（03 §7.3#1）；s3 随 T2-13 落地
  STORAGE_DRIVER: z.enum(["disk", "s3"]).default("disk"),
  // disk 目录（server 工作目录下 storage/，02 §5.3 记法）
  STORAGE_DIR: z.string().min(1).default("storage"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
