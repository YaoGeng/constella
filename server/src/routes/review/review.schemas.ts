/**
 * review 域请求校验 Schema（TDD-S-03 §3；T2-08）。
 * ReviewActionReq：action 枚举 + reject 时 reason 条件必填（03 S-03 §1 端点表）。
 * QueueQuery：待审队列分页参数（T2-09 ReviewQueueService 接口位——schema 先行冻结）。
 */
import { z } from "zod";

/** POST /admin/packages/:id/review 请求体 */
export const reviewDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.action !== "reject" || v.reason !== undefined, {
    message: "reason is required when action is reject",
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

/** POST /admin/packages/:id/offline 请求体（reason 必填——下架留痕） */
export const offlineSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type OfflineInput = z.infer<typeof offlineSchema>;

/** GET /admin/reviews 查询参（T2-09 消费） */
export const queueQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "offline"]).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 路径参数 */
export const idParamSchema = z.object({ id: z.string().min(1) });
