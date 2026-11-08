/**
 * 用户序列化（T2-01/T2-03/T2-04 公共件）：
 * Prisma 枚举（USER/ADMIN/ACTIVE/BANNED）→ X-01 小写字面量口径
 * （shared ./dto/user.ts：role 'user'|'admin'，由 server 序列化层映射）。
 */
import type { UserProfile } from "@constella/shared/dto";
import type { User } from "../../generated/prisma/client.js";

/** 最小用户档案（register/login 响应：02 §6.2 {user:{id,email,role}}） */
export function toUserProfile(user: Pick<User, "id" | "email" | "role">): UserProfile {
  return {
    id: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "admin" : "user",
  };
}
