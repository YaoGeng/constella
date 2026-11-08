/**
 * Prisma 客户端单例 —— 通过 @prisma/adapter-pg 适配器直连 PostgreSQL。
 * 应用全局共享同一实例，避免热重载时创建多个连接池。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "./env.js";

// 实例化 Pg 适配器：使用集中校验后的 DATABASE_URL

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
// 注入适配器创建客户端，由 Prisma v7 接管连接生命周期
const prisma = new PrismaClient({ adapter });

export { prisma };
