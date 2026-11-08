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
// PORT 默认 4399→8051（部署标准 §2.3）；增 CORS_ORIGINS（K3）与存储项（TDD-S-05 §1 env 表）；
// T2-11 增 ADMIN_EMAIL/ADMIN_PASSWORD（AdminSeed——可选，未设则跳过首建）；
// T2-13 增 S3_*（STORAGE_DRIVER=s3 时条件必填——superRefine）
const envSchema = z
  .object({
    APP_ENV: appEnvSchema.default("dev"),
    NODE_ENV: nodeEnvSchema.default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    PORT: z.coerce.number().default(8051),
    // 逗号分隔来源列表；client HTTP 直连（02 §3.4 注），默认 app://
    CORS_ORIGINS: z.string().min(1).default("app://"),
    // 对象存储（TDD-S-05）：disk 生产默认（03 §7.3#1）；s3＝升级位（T2-13）
    STORAGE_DRIVER: z.enum(["disk", "s3"]).default("disk"),
    // disk 目录（server 工作目录下 storage/，02 §5.3 记法）
    STORAGE_DIR: z.string().min(1).default("storage"),
    // S3 兼容驱动（TDD-S-05 §1 s3 行；MinIO 走 S3_ENDPOINT＋forcePathStyle）。
    // 存储凭据全部 env 注入、不进镜像（部署契约#2）；driver=s3 时必填性由 superRefine 收口
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // 自定义 endpoint 默认路径风格（MinIO）；AWS 原生可显式置 "false"（字面枚举——避 boolean coerce 陷阱）
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    // 首个 ADMIN 引导（TDD-S-04 §1 ⚠ b：AdminSeed env 首建，幂等；未设则跳过）
    ADMIN_EMAIL: z.string().trim().min(4).optional(),
    ADMIN_PASSWORD: z.string().min(8).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.STORAGE_DRIVER !== "s3") {
      return;
    }
    const required = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    for (const key of required) {
      if (!values[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when STORAGE_DRIVER=s3`,
        });
      }
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
