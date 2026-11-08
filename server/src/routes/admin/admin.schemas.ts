/**
 * admin 域请求校验 Schema（TDD-S-04 §3；T2-10）。
 * UsersQuery：q=email ILIKE 搜索 + 分页；BanReq：reason 必填（封禁理由留痕）。
 */
import { z } from "zod";

export const usersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;

export const banSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type BanInput = z.infer<typeof banSchema>;

export const idParamSchema = z.object({ id: z.string().min(1) });
