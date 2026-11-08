/**
 * AdminSeed（TDD-S-04 §1 ⚠ b / §3；T2-11）：首个 ADMIN 账号引导。
 * env ADMIN_EMAIL/ADMIN_PASSWORD 首建（bcrypt 同 auth 域口径 cost=10）；同 email 已存在 → 幂等跳过
 * （不覆盖角色/密码——连续两次启动恰一 admin）；未设 env → noop 跳过。
 * 启动钩子＝src/index.ts bootstrap（entrypoint 迁移后：Docker=docker-entrypoint.sh migrate deploy →
 * node dist/src/index.js；本地 dev=tsx watch 同入口——两形态同生效）。
 * 凭参注入优先（测试/编排可显式传值），缺省回落 process.env（调用时读取——不缓存）。
 */
import bcrypt from "bcryptjs";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../utils/prisma.js";

export interface AdminSeedInput {
  email?: string;
  password?: string;
}

export type AdminSeedResult = "created" | "skipped" | "noop";

/** 启动幂等 seed（失败由调用方决定是否阻断——启动钩子处 log-and-continue，下次启动重试） */
export async function seedAdmin(input: AdminSeedInput = {}): Promise<AdminSeedResult> {
  const email = (input.email ?? process.env.ADMIN_EMAIL)?.trim();
  const password = input.password ?? process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    logger.info("admin.seed", { result: "noop", reason: "ADMIN_EMAIL/ADMIN_PASSWORD not set" });
    return "noop";
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing) {
    // 幂等跳过：不覆盖既有角色/密码（dev 反复 watch 重启不产生重复账号或凭据漂移）
    logger.info("admin.seed", { result: "skipped", userId: existing.id });
    return "skipped";
  }

  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" },
    select: { id: true },
  });
  logger.info("admin.seed", { result: "created", userId: user.id });
  return "created";
}
