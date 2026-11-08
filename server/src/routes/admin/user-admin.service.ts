/**
 * UserAdminService（TDD-S-04 §3；T2-10）：用户列表/搜索（email ILIKE + packageCount 聚合）、
 * 封禁/解封 + 审计日志（§1 ⚠ a 从简：封禁留痕=结构化 logger.warn('admin.audit')——
 * 02 §7.2 无 BanRecord 实体，实体化走 00 H 章）。
 * 封禁即时失效三路＝login（BANNED 检查）/既有 refresh（rotate 检查）/Bearer（requireActiveUser 检查）
 * ——三路校验点均在第一批 auth 域/kernel 已落，本域只翻转 User.status。
 */
import type { UserRole } from "@constella/shared/dto";
import type { UserStatus as DtoUserStatus } from "@constella/shared/dto";
import type { AdminUserRow } from "@constella/shared/dto";
import { ApiError } from "../../kernel/errors.js";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../utils/prisma.js";
import type { BanInput, UsersQuery } from "./admin.schemas.js";

/** GET /admin/users → {items:AdminUserRow[],total}（q=email ILIKE；packageCount=owner 包计数聚合） */
export async function listUsers(query: UsersQuery): Promise<{ items: AdminUserRow[]; total: number }> {
  const where = query.q
    ? { email: { contains: query.q, mode: "insensitive" as const } }
    : {};
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { _count: { select: { packages: true } } },
    }),
  ]);
  return {
    total,
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role.toLowerCase() as UserRole,
      status: u.status.toLowerCase() as DtoUserStatus,
      createdAt: u.createdAt.toISOString(),
      packageCount: u._count.packages,
    })),
  };
}

/** 审计留痕（⚠ a 从简：结构化日志承载） */
function audit(action: string, userId: string, operatorId: string, reason?: string): void {
  logger.warn("admin.audit", { action, userId, operatorId, ...(reason ? { reason } : {}) });
}

/** POST /admin/users/:id/ban —— status→BANNED（禁登录/既有 refresh/Bearer 三路即时失效） */
export async function banUser(id: string, operatorId: string, input: BanInput): Promise<{ ok: true }> {
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    throw new ApiError("NOT-FOUND");
  }
  await prisma.user.update({ where: { id }, data: { status: "BANNED" } });
  audit("ban", id, operatorId, input.reason);
  return { ok: true };
}

/** POST /admin/users/:id/unban —— status→ACTIVE */
export async function unbanUser(id: string, operatorId: string): Promise<{ ok: true }> {
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    throw new ApiError("NOT-FOUND");
  }
  await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
  audit("unban", id, operatorId);
  return { ok: true };
}
