import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma CLI 独立的环境变量加载（与应用 src/utils/env.ts 互不干扰）
 *
 * Prisma v7 不再自动读取 .env 文件，需在此手动加载。
 * 策略：优先加载 .env.{APP_ENV}，再以 .env 补全缺失项。
 * dotenv 使用 override: false，确保已有环境变量不被文件覆盖。
 */
const appEnv = process.env.APP_ENV ?? "dev";

// 加载 .env.{APP_ENV}（如 .env.dev），不覆盖已有变量
const envFile = path.resolve(`.env.${appEnv}`);
if (existsSync(envFile)) {
  dotenv.config({ path: envFile, override: false });
}
// 加载 .env 补全剩余缺失变量
dotenv.config({ override: false });

export default defineConfig({
  schema: "prisma",  // 多文件 Schema：Prisma 读取 prisma/ 下（含子目录）所有 .prisma 文件
  migrations: {
    path: "prisma/migrations",
  },
  // 数据源 URL 通过 Prisma 内置的 env() 读取 DATABASE_URL
  datasource: {
    url: env("DATABASE_URL"),
  },
});
