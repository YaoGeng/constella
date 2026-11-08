/**
 * StateMachine（TDD-S-03 §1/§3；T2-08）：审核状态机迁移表 + 非法迁移判定。
 * 迁移表与 03 S-03 §1 mermaid 图逐边一致（scripts/check-review-transitions.mjs 静态断言）：
 * PENDING→APPROVED/REJECTED、APPROVED→OFFLINE；REJECTED 无出边（再发布回 PENDING 由 S-02 置位，
 * 非 review 动作）、OFFLINE 无出边（V1 终态）。
 * Package.status 的迁移写权归本域唯一（S-02 仅 publish/再发布置 PENDING——见 publish-pipeline.ts）。
 */
import type { PackageStatus } from "../../../generated/prisma/client.js";

/** 迁移表（from → 合法 to 全集；空数组=终态无出边） */
export const REVIEW_TRANSITIONS: Readonly<Record<PackageStatus, readonly PackageStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["OFFLINE"],
  REJECTED: [],
  OFFLINE: [],
};

/** 非法迁移判定（REVIEW-ALREADY-DONE 409 的语义源） */
export function canTransition(from: PackageStatus, to: PackageStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}
