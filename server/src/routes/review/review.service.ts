/**
 * ReviewService（TDD-S-03 §1/§3；T2-08）：条件更新 + ReviewRecord 同事务留痕 + 409 判定。
 * 并发防护（卡内冻结）：迁移=单条条件更新 updateMany({where:{id,status}})，affected=0 → 查现状 →
 * 404 NOT-FOUND（不存在）/ 409 REVIEW-ALREADY-DONE（状态已翻）；两管理员并发审同包恰一成功
 * （一次性语义，与 S-01 refresh 轮换防护同模式）。
 * offline 条件 status='APPROVED'（防 PENDING 包被下架绕过审核）。
 * 每次决策恰一行 ReviewRecord（幂等由条件更新保证）；OFFLINE 亦留痕。
 */
import type { PackageStatus, Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../kernel/errors.js";
import { prisma } from "../../utils/prisma.js";
import type { OfflineInput, ReviewDecisionInput } from "./review.schemas.js";

/** affected=0 时区分 404 / 409（同事务内查询——快照一致）；恒抛出 */
async function assertExistsOrThrow(tx: Prisma.TransactionClient, packageId: string): Promise<never> {
  const pkg = await tx.package.findUnique({ where: { id: packageId }, select: { id: true } });
  if (!pkg) {
    throw new ApiError("NOT-FOUND");
  }
  throw new ApiError("REVIEW-ALREADY-DONE");
}

export interface DecideResult {
  /** 小写状态字面量（02 §6.4 示例口径；X-01 dto/admin ReviewDecisionRes） */
  status: Lowercase<PackageStatus>;
}

/** 审核决策：PENDING → APPROVED（approve）/ REJECTED（reject + reason 留痕） */
/** 交互事务参数：高延迟链路（如 SSH 隧道开发形态）下默认 5s 起事务窗口不足——放宽到 20s（语义不变） */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

export async function decide(
  packageId: string,
  reviewerId: string,
  input: ReviewDecisionInput,
): Promise<DecideResult> {
  const target: PackageStatus = input.action === "approve" ? "APPROVED" : "REJECTED";
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.package.updateMany({
        where: { id: packageId, status: "PENDING" },
        data: { status: target },
      });
      if (updated.count === 0) {
        await assertExistsOrThrow(tx, packageId);
      }
      await tx.reviewRecord.create({
        data: {
          packageId,
          reviewerId,
          action: input.action === "approve" ? "APPROVE" : "REJECT",
          reason: input.action === "reject" ? (input.reason ?? null) : null,
        },
      });
      return { status: target.toLowerCase() as Lowercase<PackageStatus> };
    },
    TX_OPTIONS,
  );
}

/** 下架：APPROVED → OFFLINE（reason 留痕；V1 终态） */
export async function takeOffline(
  packageId: string,
  reviewerId: string,
  input: OfflineInput,
): Promise<DecideResult> {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.package.updateMany({
        where: { id: packageId, status: "APPROVED" },
        data: { status: "OFFLINE" },
      });
      if (updated.count === 0) {
        await assertExistsOrThrow(tx, packageId);
      }
      await tx.reviewRecord.create({
        data: { packageId, reviewerId, action: "OFFLINE", reason: input.reason },
      });
      return { status: "offline" as const };
    },
    TX_OPTIONS,
  );
}
